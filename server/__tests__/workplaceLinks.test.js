import { describe, it, expect, vi } from 'vitest';
import {
  listWorkplaceLinkGroups,
  loadLinkedWorkplacesFor,
  loadLinkedWorkplacesForTenant,
} from '../../server/utils/workplaceLinks.js';

function createMockDb(responses) {
  const execute = vi.fn(async (sql) => {
    for (const [pattern, result] of responses) {
      if (pattern.test(sql)) return [result];
    }
    return [[]];
  });
  return { execute };
}

describe('listWorkplaceLinkGroups', () => {
  it('returns empty array when there are no groups', async () => {
    const db = createMockDb([[/FROM workplace_link_group/, []]]);
    const result = await listWorkplaceLinkGroups(db);
    expect(result).toEqual([]);
  });

  it('attaches members to their group and normalizes is_active', async () => {
    const db = createMockDb([
      [/FROM workplace_link_group/, [
        { id: 1, name: 'CT-Link', description: null, is_active: 1 },
      ]],
      [/FROM workplace_link_member/, [
        { id: 'm1', link_group_id: 1, tenant_id: 't1', workplace_name: 'CT', tenant_name: 'Radiologie' },
        { id: 'm2', link_group_id: 1, tenant_id: 't2', workplace_name: 'CT1', tenant_name: 'MTR' },
      ]],
    ]);

    const result = await listWorkplaceLinkGroups(db);
    expect(result).toHaveLength(1);
    expect(result[0].is_active).toBe(true);
    expect(result[0].members).toHaveLength(2);
    expect(result[0].members[0].workplace_name).toBe('CT');
  });
});

describe('loadLinkedWorkplacesFor', () => {
  it('returns empty array when tenantId or workplaceName is missing', async () => {
    const db = createMockDb([]);
    expect(await loadLinkedWorkplacesFor(db, null, 'CT')).toEqual([]);
    expect(await loadLinkedWorkplacesFor(db, 't1', null)).toEqual([]);
  });

  it('returns partner members excluding the queried workplace itself', async () => {
    const db = createMockDb([
      [/FROM workplace_link_member m1/, [
        { tenant_id: 't2', workplace_name: 'CT1', link_group_id: 1, tenant_name: 'MTR' },
        { tenant_id: 't2', workplace_name: 'CT2', link_group_id: 1, tenant_name: 'MTR' },
      ]],
    ]);
    const result = await loadLinkedWorkplacesFor(db, 't1', 'CT');
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.workplace_name)).toEqual(['CT1', 'CT2']);
  });
});

describe('loadLinkedWorkplacesForTenant', () => {
  it('returns an empty Map when tenantId is missing', async () => {
    const db = createMockDb([]);
    const result = await loadLinkedWorkplacesForTenant(db, null);
    expect(result.size).toBe(0);
  });

  it('groups partner workplaces by the tenant\'s own workplace name', async () => {
    const db = createMockDb([
      [/FROM workplace_link_member m1/, [
        { own_workplace_name: 'CT', tenant_id: 't2', workplace_name: 'CT1', link_group_id: 1, tenant_name: 'MTR' },
        { own_workplace_name: 'CT', tenant_id: 't2', workplace_name: 'CT2', link_group_id: 1, tenant_name: 'MTR' },
        { own_workplace_name: 'MRT', tenant_id: 't2', workplace_name: 'MRT1', link_group_id: 2, tenant_name: 'MTR' },
      ]],
    ]);
    const result = await loadLinkedWorkplacesForTenant(db, 't1');
    expect(result.size).toBe(2);
    expect(result.get('CT')).toHaveLength(2);
    expect(result.get('MRT')).toHaveLength(1);
    expect(result.get('MRT')[0].workplace_name).toBe('MRT1');
  });
});
