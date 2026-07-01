/**
 * Helpers for workplace_link_group (cross-tenant read-only staffing mirror).
 *
 * Use case: a "CT" workplace in the Radiology tenant and "CT1"/"CT2"
 * workplaces in the MTR tenant describe the same physical room, staffed by
 * different professions in separate tenants. A workplace_link_group bundles
 * these named workplaces (each identified by tenant_id + workplace_name) so
 * that the day view of one tenant can show a read-only staffing summary of
 * the linked workplace(s) in the other tenant(s).
 *
 * This is intentionally NOT built on tenant_group / shared_workplace: there
 * is no shared shift storage and no cross-tenant writing. Each tenant keeps
 * planning its own workplace exactly as before; this feature only reads
 * `ShiftEntry` rows from the linked tenant's DB on demand.
 *
 * All link definitions live in the master DB. Management is master-admin
 * only (no per-user JSON permission columns, unlike tenant_group/rotation_group).
 */

/**
 * Load every active link group, each with its member workplaces
 * (tenant_id + workplace_name), joined with the tenant name for display.
 */
export async function listWorkplaceLinkGroups(masterDb) {
  const [groups] = await masterDb.execute(
    `SELECT id, name, description, is_active, created_at, updated_at
       FROM workplace_link_group
      ORDER BY name ASC`
  );
  if (groups.length === 0) return [];

  const [members] = await masterDb.execute(
    `SELECT m.id, m.link_group_id, m.tenant_id, m.workplace_name, m.created_at,
            t.name AS tenant_name
       FROM workplace_link_member m
       JOIN db_tokens t ON t.id = m.tenant_id
      ORDER BY t.name ASC, m.workplace_name ASC`
  );

  const membersByGroup = new Map();
  for (const member of members) {
    const list = membersByGroup.get(member.link_group_id) || [];
    list.push(member);
    membersByGroup.set(member.link_group_id, list);
  }

  return groups.map((group) => ({
    ...group,
    is_active: Boolean(group.is_active),
    members: membersByGroup.get(group.id) || [],
  }));
}

/**
 * Load the members of every ACTIVE link group that includes the given
 * tenant + workplace name (case-sensitive exact match, matching Workplace.name).
 * Returns the "partner" members only (i.e. excludes the queried tenant's own
 * row), grouped is irrelevant to the caller — a workplace could in theory
 * belong to more than one group, so we return a flat list of partner members
 * plus which group they came from.
 */
export async function loadLinkedWorkplacesFor(masterDb, tenantId, workplaceName) {
  if (!tenantId || !workplaceName) return [];

  const [rows] = await masterDb.execute(
    `SELECT m2.tenant_id, m2.workplace_name, m2.link_group_id, t.name AS tenant_name
       FROM workplace_link_member m1
       JOIN workplace_link_group g ON g.id = m1.link_group_id AND g.is_active = 1
       JOIN workplace_link_member m2 ON m2.link_group_id = m1.link_group_id
       JOIN db_tokens t ON t.id = m2.tenant_id
      WHERE m1.tenant_id = ? AND m1.workplace_name = ?
        AND NOT (m2.tenant_id = m1.tenant_id AND m2.workplace_name = m1.workplace_name)`,
    [String(tenantId), String(workplaceName)]
  );
  return rows;
}

/**
 * Load ALL partner members for EVERY workplace of the given tenant in one
 * query — used by the schedule day view to avoid N+1 lookups per row.
 * Returns a Map keyed by the tenant's own workplace_name -> array of partner
 * members ({ tenant_id, tenant_name, workplace_name, link_group_id }).
 */
export async function loadLinkedWorkplacesForTenant(masterDb, tenantId) {
  if (!tenantId) return new Map();

  const [rows] = await masterDb.execute(
    `SELECT m1.workplace_name AS own_workplace_name,
            m2.tenant_id, m2.workplace_name, m2.link_group_id, t.name AS tenant_name
       FROM workplace_link_member m1
       JOIN workplace_link_group g ON g.id = m1.link_group_id AND g.is_active = 1
       JOIN workplace_link_member m2 ON m2.link_group_id = m1.link_group_id
       JOIN db_tokens t ON t.id = m2.tenant_id
      WHERE m1.tenant_id = ?
        AND NOT (m2.tenant_id = m1.tenant_id AND m2.workplace_name = m1.workplace_name)`,
    [String(tenantId)]
  );

  const map = new Map();
  for (const row of rows) {
    const list = map.get(row.own_workplace_name) || [];
    list.push({
      tenant_id: row.tenant_id,
      tenant_name: row.tenant_name,
      workplace_name: row.workplace_name,
      link_group_id: row.link_group_id,
    });
    map.set(row.own_workplace_name, list);
  }
  return map;
}
