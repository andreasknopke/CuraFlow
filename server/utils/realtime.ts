import crypto from 'crypto';
import type { Response } from 'express';

type SseResponse = Response & { flush?: () => void };

interface RealtimeClient {
  res: SseResponse;
  userId: string;
  connectedAt: number;
}

const realtimeClients = new Map<string, Map<string, RealtimeClient>>();

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

function getClientsForScope(scope: string): Map<string, RealtimeClient> {
  if (!realtimeClients.has(scope)) {
    realtimeClients.set(scope, new Map());
  }

  return realtimeClients.get(scope) as Map<string, RealtimeClient>;
}

function writeEvent(res: SseResponse, eventName: string, payload: unknown): void {
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);

  if (typeof res.flush === 'function') {
    res.flush();
  }
}

function removeClient(scope: string, clientId: string): void {
  const clients = realtimeClients.get(scope);
  if (!clients) return;

  clients.delete(clientId);
  if (clients.size === 0) {
    realtimeClients.delete(scope);
  }
}

function pruneDisconnectedClients(clients: Map<string, RealtimeClient>): void {
  for (const [clientId, client] of clients.entries()) {
    if (client.res.writableEnded || client.res.destroyed) {
      clients.delete(clientId);
    }
  }
}

export function buildRealtimeScope(dbToken: string | null | undefined): string {
  if (!dbToken) return 'default';

  const hash = crypto.createHash('sha256').update(dbToken).digest('hex');
  return `tenant:${hash}`;
}

export function isPlanSyncEntity(entityName: string): boolean {
  return PLAN_SYNC_ENTITIES.has(entityName);
}

interface RegisterRealtimeClientOptions {
  scope: string;
  res: Response;
  userId: string;
}

export function registerRealtimeClient({ scope, res, userId }: RegisterRealtimeClientOptions): () => void {
  const sseRes = res as SseResponse;
  const clientId = crypto.randomUUID();
  const clients = getClientsForScope(scope);
  clients.set(clientId, { res: sseRes, userId, connectedAt: Date.now() });

  console.log('[Realtime] Client verbunden', {
    scope,
    clientId,
    userId,
    clientCount: clients.size,
  });

  sseRes.write('retry: 5000\n\n');
  if (typeof sseRes.flush === 'function') {
    sseRes.flush();
  }
  writeEvent(sseRes, 'connected', {
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

interface PlanUpdateEvent {
  scope: string;
  entity: string;
  action: string;
  recordId?: string | null;
  recordCount?: number | null;
  actor?: { id?: string; email?: string } | null;
}

export function broadcastPlanUpdate({ scope, entity, action, recordId = null, recordCount = null, actor = null }: PlanUpdateEvent): void {
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
    actor: actor
      ? {
          id: actor.id || null,
          email: actor.email || null,
        }
      : null,
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

  pruneDisconnectedClients(clients);

  for (const [clientId, client] of clients.entries()) {
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

interface UserEvent {
  eventName: string;
  payload: unknown;
  userIds?: (string | null | undefined)[];
}

export function broadcastUserEvent({ eventName, payload, userIds = [] }: UserEvent): void {
  const targetUserIds = new Set((userIds || []).filter(Boolean) as string[]);
  if (targetUserIds.size === 0) {
    return;
  }

  let deliveredCount = 0;

  for (const [scope, clients] of realtimeClients.entries()) {
    pruneDisconnectedClients(clients);

    for (const [clientId, client] of clients.entries()) {
      if (!targetUserIds.has(client.userId)) {
        continue;
      }

      try {
        writeEvent(client.res, eventName, payload);
        deliveredCount += 1;
      } catch (error) {
        clients.delete(clientId);
      }
    }

    if (clients.size === 0) {
      realtimeClients.delete(scope);
    }
  }

  const userIdArray = Array.from(targetUserIds);
  console.log('[Realtime] Sende User-Event event=' + eventName + ' targets=' + userIdArray.length + ' delivered=' + deliveredCount);
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
