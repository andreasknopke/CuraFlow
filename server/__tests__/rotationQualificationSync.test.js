import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  resolveCentralEmployeeId,
  loadPoolQualificationNames,
  resolveWardDoctorIds,
  loadWardQualificationsByName,
  ensureDoctorQualifications,
  syncRotationAssignmentQualifications,
} from '../utils/rotationQualificationSync.js';

vi.mock('../utils/rotationGroups.js', () => ({
  resolvePoolTenantId: vi.fn(async () => 'pool-tenant'),
}));

function makePool(handlers) {
  const calls = [];
  return {
    calls,
    async execute(sql, params = []) {
      calls.push({ sql, params });
      for (const handler of handlers) {
        if (handler.match(sql, params)) {
          return handler.result(sql, params);
        }
      }
      return [[], []];
    },
  };
}

describe('resolveCentralEmployeeId', () => {
  it('returns the id when it is a central Employee', async () => {
    const masterDb = {
      execute: vi.fn(async (sql) => {
        if (sql.includes('FROM Employee ')) return [[{ id: 'emp-1' }]];
        return [[]];
      }),
    };
    await expect(resolveCentralEmployeeId(masterDb, 'emp-1')).resolves.toBe('emp-1');
  });

  it('falls back to EmployeeTenantAssignment.tenant_doctor_id', async () => {
    const masterDb = {
      execute: vi.fn(async (sql) => {
        if (sql.includes('FROM Employee ')) return [[]];
        if (sql.includes('EmployeeTenantAssignment')) {
          return [[{ employee_id: 'emp-2' }]];
        }
        return [[]];
      }),
    };
    await expect(resolveCentralEmployeeId(masterDb, 'doc-pool-1')).resolves.toBe('emp-2');
  });

  it('returns null when nothing matches', async () => {
    const masterDb = {
      execute: vi.fn(async () => [[]]),
    };
    await expect(resolveCentralEmployeeId(masterDb, 'unknown')).resolves.toBeNull();
  });
});

describe('loadPoolQualificationNames', () => {
  it('loads distinct qualification names for the pool doctor', async () => {
    const pool = makePool([
      {
        match: (sql) => sql.includes('FROM Doctor WHERE id'),
        result: () => [[{ id: 'doc-pool' }]],
      },
      {
        match: (sql) => sql.includes('FROM DoctorQualification'),
        result: () => [[
          { qname: 'Sekretariat' },
          { qname: '  MRT  ' },
          { qname: null },
        ]],
      },
    ]);

    const names = await loadPoolQualificationNames(pool, {
      employeeId: 'doc-pool',
      centralEmployeeId: null,
    });
    expect(names).toEqual(['Sekretariat', 'MRT']);
  });

  it('also resolves doctors via central_employee_id', async () => {
    const pool = makePool([
      {
        match: (sql) => sql.includes('FROM Doctor WHERE id'),
        result: () => [[]],
      },
      {
        match: (sql) => sql.includes('central_employee_id'),
        result: () => [[{ id: 'doc-via-central' }]],
      },
      {
        match: (sql) => sql.includes('FROM DoctorQualification'),
        result: (_sql, params) => {
          expect(params).toContain('doc-via-central');
          return [[{ qname: 'Sekretariat' }]];
        },
      },
    ]);

    const names = await loadPoolQualificationNames(pool, {
      employeeId: 'emp-uuid',
      centralEmployeeId: 'emp-uuid',
    });
    expect(names).toEqual(['Sekretariat']);
  });
});

describe('resolveWardDoctorIds', () => {
  it('always includes the assignment employee_id and linked local doctors', async () => {
    const pool = makePool([
      {
        match: (sql) => sql.includes('central_employee_id'),
        result: () => [[{ id: 'ward-doc-1' }]],
      },
    ]);
    const masterDb = {
      execute: vi.fn(async () => [[{ tenant_doctor_id: 'ward-doc-eta' }]]),
    };

    const ids = await resolveWardDoctorIds(pool, {
      employeeId: 'emp-or-doc',
      centralEmployeeId: 'emp-1',
      wardTenantId: 'ward-1',
      masterDb,
    });
    expect(ids).toEqual(expect.arrayContaining(['emp-or-doc', 'ward-doc-1', 'ward-doc-eta']));
  });
});

describe('loadWardQualificationsByName', () => {
  it('indexes active qualifications case-insensitively', async () => {
    const pool = makePool([
      {
        match: () => true,
        result: () => [[
          { id: 'q-1', name: 'Sekretariat' },
          { id: 'q-2', name: 'sekretariat' }, // second ignored
          { id: 'q-3', name: 'MRT' },
        ]],
      },
    ]);
    const map = await loadWardQualificationsByName(pool);
    expect(map.get('sekretariat')).toEqual({ id: 'q-1', name: 'Sekretariat' });
    expect(map.get('mrt')).toEqual({ id: 'q-3', name: 'MRT' });
  });
});

describe('ensureDoctorQualifications', () => {
  it('inserts only missing doctor-qualification pairs', async () => {
    const existingKeys = new Set(['doc-1:q-1']);
    const inserts = [];
    const pool = {
      async execute(sql, params = []) {
        if (sql.includes('SELECT id FROM DoctorQualification')) {
          const key = `${params[0]}:${params[1]}`;
          return [existingKeys.has(key) ? [{ id: 'existing' }] : []];
        }
        if (sql.includes('INSERT INTO DoctorQualification')) {
          inserts.push(params);
          return [{ affectedRows: 1 }];
        }
        return [[]];
      },
    };

    const created = await ensureDoctorQualifications(pool, {
      doctorIds: ['doc-1'],
      qualificationIds: ['q-1', 'q-2'],
      createdBy: 'tester',
    });

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      doctor_id: 'doc-1',
      qualification_id: 'q-2',
    });
    expect(inserts).toHaveLength(1);
    expect(inserts[0][1]).toBe('doc-1');
    expect(inserts[0][2]).toBe('q-2');
  });
});

describe('syncRotationAssignmentQualifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips when required params are missing', async () => {
    await expect(syncRotationAssignmentQualifications({})).resolves.toEqual({
      skipped: 'missing_params',
    });
  });

  it('copies matching pool qualifications into the ward tenant by name', async () => {
    const masterCalls = [];
    const masterDb = {
      async execute(sql, params = []) {
        masterCalls.push({ sql, params });
        if (sql.includes('FROM rotation_workplace')) {
          return [[{ id: 'wp-1', group_id: '1', ward_tenant_id: 'ward-tenant' }]];
        }
        if (sql.includes('FROM db_tokens')) {
          const id = params[0];
          return [[{ id, token: `token-${id}`, name: id }]];
        }
        if (sql.includes('FROM Employee ')) {
          return [[{ id: 'emp-1' }]];
        }
        if (sql.includes('FROM EmployeeTenantAssignment') && sql.includes('tenant_id = ?')) {
          // ETA map for pool
          return [[]];
        }
        if (sql.includes('EmployeeTenantAssignment') && sql.includes('employee_id = ?')) {
          return [[{ tenant_doctor_id: 'ward-doc-linked' }]];
        }
        return [[]];
      },
    };

    const poolTenantPool = makePool([
      {
        match: (sql) => sql.includes('FROM Doctor WHERE id'),
        result: () => [[{ id: 'pool-doc' }]],
      },
      {
        match: (sql) => sql.includes('FROM DoctorQualification'),
        result: () => [[{ qname: 'Sekretariat' }, { qname: 'UnknownQual' }]],
      },
    ]);

    const wardInserts = [];
    const wardTenantPool = {
      async execute(sql, params = []) {
        if (sql.includes('FROM Qualification')) {
          return [[{ id: 'ward-q-sek', name: 'Sekretariat' }]];
        }
        if (sql.includes('central_employee_id')) {
          return [[{ id: 'ward-doc-linked' }]];
        }
        if (sql.includes('SELECT id FROM DoctorQualification')) {
          return [[]];
        }
        if (sql.includes('INSERT INTO DoctorQualification')) {
          wardInserts.push(params);
          return [{ affectedRows: 1 }];
        }
        return [[]];
      },
    };

    const withTenantDb = vi.fn(async (token, cb) => {
      if (String(token.id) === 'pool-tenant') return cb(poolTenantPool, token);
      if (String(token.id) === 'ward-tenant') return cb(wardTenantPool, token);
      throw new Error(`unexpected token ${token.id}`);
    });

    const broadcastPlanUpdate = vi.fn();
    const buildRealtimeScope = vi.fn(() => 'tenant:ward');

    const result = await syncRotationAssignmentQualifications({
      masterDb,
      groupId: '1',
      rotationWorkplaceId: 'wp-1',
      employeeId: 'emp-1',
      withTenantDb,
      actor: { email: 'planner@example.com' },
      buildRealtimeScope,
      broadcastPlanUpdate,
    });

    expect(result.skipped).toBeUndefined();
    expect(result.poolQualificationNames).toEqual(['Sekretariat', 'UnknownQual']);
    expect(result.matchedQualificationIds).toEqual(['ward-q-sek']);
    expect(result.created.length).toBeGreaterThan(0);
    expect(result.created.every((row) => row.qualification_id === 'ward-q-sek')).toBe(true);
    // assignment id + linked ward doctor
    const doctorIds = new Set(result.created.map((r) => r.doctor_id));
    expect(doctorIds.has('emp-1')).toBe(true);
    expect(doctorIds.has('ward-doc-linked')).toBe(true);
    expect(broadcastPlanUpdate).toHaveBeenCalled();
    expect(buildRealtimeScope).toHaveBeenCalledWith('token-ward-tenant');
    expect(wardInserts.length).toBe(result.created.length);
  });

  it('skips when pool and ward tenant are the same', async () => {
    const { resolvePoolTenantId } = await import('../utils/rotationGroups.js');
    resolvePoolTenantId.mockResolvedValueOnce('same-tenant');

    const masterDb = {
      async execute(sql) {
        if (sql.includes('FROM rotation_workplace')) {
          return [[{ id: 'wp-1', group_id: '1', ward_tenant_id: 'same-tenant' }]];
        }
        return [[]];
      },
    };

    const result = await syncRotationAssignmentQualifications({
      masterDb,
      groupId: '1',
      rotationWorkplaceId: 'wp-1',
      employeeId: 'emp-1',
    });
    expect(result).toEqual({ skipped: 'pool_equals_ward' });
  });
});
