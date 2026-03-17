import crypto from 'crypto';

const realtimeClients = new Map();

const PLAN_SYNC_ENTITIES = new Set([
  'ShiftEntry',
  'ScheduleNote',
  'StaffingPlanEntry',
  'Doctor',
  'Workplace',
  'WorkplaceTimeslot',
  'TrainingRotation',
  'ScheduleRule',
  'ColorSetting',
  'TeamRole',
  'Qualification',
  'DoctorQualification',
  'WorkplaceQualification',
  'WishRequest',
  'SystemSetting',
]);

function getClientsForScope(scope) {
  if (!realtimeClients.has(scope)) {
    realtimeClients.set(scope, new Map());
  }

  return realtimeClients.get(scope);
}

function writeEvent(res, eventName, payload) {
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);

  if (typeof res.flush === 'function') {
    res.flush();
  }
}

function removeClient(scope, clientId) {
  const clients = realtimeClients.get(scope);
  if (!clients) return;

  clients.delete(clientId);
  if (clients.size === 0) {
    realtimeClients.delete(scope);
  }
}

export function buildRealtimeScope(dbToken) {
  if (!dbToken) return 'default';

  const hash = crypto.createHash('sha256').update(dbToken).digest('hex');
  return `tenant:${hash}`;
}

export function isPlanSyncEntity(entityName) {
  return PLAN_SYNC_ENTITIES.has(entityName);
}

export function registerRealtimeClient({ scope, res, userId }) {
  const clientId = crypto.randomUUID();
  const clients = getClientsForScope(scope);
  clients.set(clientId, { res, userId, connectedAt: Date.now() });

  console.log('[Realtime] Client verbunden', {
    scope,
    clientId,
    userId,
    clientCount: clients.size,
  });

  res.write('retry: 5000\n\n');
  if (typeof res.flush === 'function') {
    res.flush();
  }
  writeEvent(res, 'connected', {
    clientId,
    connectedAt: new Date().toISOString(),
  });

  return () => {
    removeClient(scope, clientId);
    const remainingClients = realtimeClients.get(scope)?.size || 0;
    console.log('[Realtime] Client getrennt', {
      scope,
      clientId,
      userId,
      clientCount: remainingClients,
    });
  };
}

export function broadcastPlanUpdate({ scope, entity, action, recordId = null, recordCount = null, actor = null }) {
  const clients = realtimeClients.get(scope);
  if (!clients || clients.size === 0) {
    console.log('[Realtime] Event ohne Empfänger', {
      scope,
      entity,
      action,
      recordId,
      recordCount,
      actorEmail: actor?.email || null,
    });
    return;
  }

  const payload = {
    entity,
    action,
    recordId,
    recordCount,
    changedAt: new Date().toISOString(),
    actor: actor ? {
      id: actor.id || null,
      email: actor.email || null,
    } : null,
  };

  console.log('[Realtime] Sende Plan-Event', {
    scope,
    entity,
    action,
    recordId,
    recordCount,
    actorEmail: actor?.email || null,
    clientCount: clients.size,
  });

  for (const [clientId, client] of clients.entries()) {
    if (client.res.writableEnded || client.res.destroyed) {
      clients.delete(clientId);
      continue;
    }

    try {
      writeEvent(client.res, 'plan-update', payload);
    } catch (error) {
      clients.delete(clientId);
    }
  }

  if (clients.size === 0) {
    realtimeClients.delete(scope);
  }
}

setInterval(() => {
  for (const [scope, clients] of realtimeClients.entries()) {
    for (const [clientId, client] of clients.entries()) {
      if (client.res.writableEnded || client.res.destroyed) {
        clients.delete(clientId);
        continue;
      }

      try {
        client.res.write(': keepalive\n\n');
        if (typeof client.res.flush === 'function') {
          client.res.flush();
        }
      } catch (error) {
        clients.delete(clientId);
      }
    }

    if (clients.size === 0) {
      realtimeClients.delete(scope);
    }
  }
}, 25000);