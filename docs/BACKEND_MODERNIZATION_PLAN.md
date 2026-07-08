# Backend Modernization Plan

## Goal

Modernize the CuraFlow backend (`server/`) on two axes that reinforce each other:

1. **Safety** — close the SQL-injection class centrally by routing query construction through a query builder that escapes identifiers in one place (the structural fix for finding S1 of [`SECURITY_REVIEW_SYSTEM.md`](./SECURITY_REVIEW_SYSTEM.md)), and progressively replace the generic "table-name-as-user-input" CRUD gateway with typed repositories.
2. **Type safety + refactor confidence** — port `server/` from JS to TypeScript with `strict: true`, so future refactors (removing the generic proxy, tightening tenant isolation, evolving the permission model) are caught at compile time.

This plan is the backend counterpart to [`TYPESCRIPT_CONVERSION_PLAN.md`](./TYPESCRIPT_CONVERSION_PLAN.md), which covers only `src/`. The two proceed **independently** and must not collide: this plan is scoped to `server/**` and the `@/` alias remains frontend-only.

---

## Current state (grounded in the code as of 2026-07-08)

| Metric | Value |
|---|---|
| Backend source files (`server/**`, excl. tests) | 56 |
| Backend LOC | ~29,500 |
| Largest route | `master.js` (5,260 lines) |
| DB proxy / atomic write routes | `dbProxy.js` (1,499 L), `atomic.js` (580 L) |
| Module system | ESM (`"type": "module"`), `node --watch index.js`, **no build step** |
| Tenant pools | Hand-rolled cache in `index.js` (`getTenantDb`, `tenantDbMiddleware`), 12 internal refs |
| Migration surface | `masterMigrations.js` (73 `run()` blocks), `tenantMigrations.js` (39), `seed-runtime-shared.js` (27 CREATE/ALTER) |
| Permission model | `server/utils/permissions.js` (`requirePermission`, `loadPermissions`) — see [`SECURITY_REVIEW_ADMIN_PERMISSIONS.md`](./SECURITY_REVIEW_ADMIN_PERMISSIONS.md) |
| Existing identifier validation | `server/utils/schema.js` `assertValidIdentifier` (added by [PR #1](https://github.com/knopkem/CuraFlow/pull/1)) — per-site, defence-in-depth |
| TS tooling for server | **None** — `jsconfig.json` excludes `server/`; server `package.json` has no TS deps or build script |

The generic `/api/db` route accepts `entity`/`table` from the request body and interpolates it into backtick-quoted SQL identifiers. `assertValidIdentifier` (PR #1) rejects injection **at the entry point**, but each new query site must remember to call it. The structural fix is to make escaping live in one library, so forgetting is not possible.

---

## Key decisions (read before starting)

### Decision 1 — Query builder: Kysely or Drizzle

Both sit **on top of the existing mysql2 pools** (`index.js` `buildPool`/`getTenantDb`). Neither forces a rewrite of `tenantDbMiddleware` or the auto-migration runner.

| | **Kysely** | **Drizzle** |
|---|---|---|
| Identifier escaping | central, via `sql.ref()` / builtin | central, via `sql.identifier()` |
| Types | TS-first query types, inferred from a schema file | Schema-as-types (generated), strongest end-state |
| Migration system | **None** — query-only, zero migration opinions | Owns `drizzle-kit` / migrations (we **keep ours**, do not adopt) |
| Fit | "Close the injection class + typed queries, least commitment" | "Typed data layer, schemas as source of truth, typed repositories" |
| Risk to our migrations | None | Must actively resist `drizzle-kit` pull |

**Recommendation:** **Kysely** for this codebase. The immediate goal is the security dividend (central identifier escaping) plus typed queries, and CuraFlow's migration surface is large and bespoke (73 + 39 + 27 run/CREATE blocks, multi-tenant auto-run-on-first-request). Drizzle's migration system would duplicate and fight that; Kysely brings no migration opinions and is SQL-shaped. If the long-term vision is "fully typed repositories, schema is the source of truth," Drizzle is defensible — but only if the team commits to *not* adopting `drizzle-kit` and keeping the existing migration runner. Kysely gets most of that value with the least architectural commitment.

### Decision 2 — Sequence: builder first, TS ride-along

The frontend plan is "TS first, no logic changes" because its risk is silent runtime breakage in an untested 7k-line DnD component. **The backend has the opposite risk profile**: its danger is trust-boundary holes and one hand-rolled SQL gateway, not silent type bugs. Therefore the backend plan is **query-builder-first, TS ride-along**:

- The security win comes from routing SQL through the builder, which works whether the file is `.js` or `.ts`.
- TS lands opportunistically on files as they are touched in the builder migration — no separate "port everything to TS" sweep up front.

### Decision 3 — Keep the migration system

`masterMigrations.js`, `tenantMigrations.js`, `seed-runtime-shared.js`, and the per-tenant auto-run-on-first-request mechanism stay exactly as they are. The query builder targets the pools these migrations create. Do not introduce the builder's own migration tooling.

### Decision 4 — Trust-boundary fixes are separate, **earlier** PRs

The builder migration does **not** fix:
- **S2** — `X-DB-Token` trusted with no per-user reauthorization (`tenantDbMiddleware`). Needs a per-request `allowed_tenants` check.
- **S7** — permission gates trust the JWT `role` instead of the DB row (`dbProxy.js`/`atomic.js` guards). Needs the gates to re-read `role`/`is_active` from the row they already query.

These are authorization fixes, not query-construction fixes. They must land **before or alongside** the builder migration so the new typed layer inherits correct enforcement — otherwise we re-type the same broken checks. They are sized as small standalone PRs below.

---

## What can go wrong

**Re-introducing the bug by forgetting a site.** The whole point of the builder migration is that a missed site *cannot* inject — but only if all dynamic identifier SQL goes through the builder. A single residual hand-rolled backtick string reintroduces the hole. The plan verifies "zero `${tableName}` interpolation sites" per PR with a grep gate.

**Optimistic typing hiding runtime nulls.** Same trap the frontend plan calls out (§"Silent null safety mismatches"): `as ShiftEntry` compiles but crashes if the record was deleted. Backend has more of these (every `getRecord`/`getValidColumns` path). Mitigation: type repos return `ShiftEntry | null` explicitly, never `as`.

**Tenant-pool coupling.** The builder must receive the *current request's* pool (`req.db`), not the master pool (`db`). A repo that accidentally imports the master `db` will silently query the wrong tenant. Mitigation: repos take `dbPool`/`kysely` as a parameter; never close over a module-level pool. Add a test that a tenant-scoped repo does not hit the master pool.

**Migration-system drift.** If Drizzle is chosen and `drizzle-kit` creeps in, two migration sources race on schema. Mitigation: Decision 3 — do not install `drizzle-kit`; document this in the repo.

**Bulk-rewrite temptation.** Rewriting `dbProxy.js` (1,499 L) in one PR is high-risk — it is the generic gateway everything funnels through. The plan never bulk-converts a route; it moves one action at a time (create, then update, then delete, then list/filter) behind a shared builder-backed helper, each behind the existing tests.

---

## Phases

### Phase 0 — Trust-boundary fixes (prerequisite, separate PRs)

Land these **before** the builder migration. They are small, independently shippable, and the typed layer depends on them being correct.

#### PR 0.1 — Per-user tenant authorization in `tenantDbMiddleware` (closes S2)

`server/index.js` `tenantDbMiddleware` resolves `req.db` from the `X-DB-Token` header with no check against `app_users.allowed_tenants`. Add a server-side re-check: resolve the token to a tenant id, load the user's `allowed_tenants`, deny (403) on mismatch. Cache the user→tenants mapping with a short TTL (reuse the existing `/my-tenants` query path).

**Risk: Medium.** Touches the hot path of every tenant request. Add an integration test (tenant A token + user restricted to tenant B → 403; same-tenant → 200). Guard the default-token (master) path explicitly.

#### PR 0.2 — Permission gates re-read `role`/`is_active` from DB (closes S7)

`dbProxy.js` and `atomic.js` compute `req.user.role === 'admin'` from the JWT; `loadPermissions` is lockout-safe (null ⇒ all-true), so a deactivated admin (`is_active=0`) keeps write access for up to 24h (`TOKEN_EXPIRY`). Change each guard's single existing DB lookup (`SELECT permissions FROM app_users WHERE id = ? AND is_active = 1`) to `SELECT role, is_active, permissions` and deny when the row is missing or `role !== 'admin'`. See [`SECURITY_REVIEW_ADMIN_PERMISSIONS.md`](./SECURITY_REVIEW_ADMIN_PERMISSIONS.md) Finding 4 for the exact diff.

**Risk: Low.** The guards already do a DB lookup; this adds two columns to the same `SELECT` and a branch. No new queries, no new latency. Test: deactivate an admin in-DB, assert a protected write 403s while their JWT is still valid.

#### PR 0.3 — Privilege-escalation clamp on user register/promote + dialog (closes perm-model F1/F2/F3)

Load the granter's permissions from the DB (by `req.user.sub`) in `POST /register` and `PATCH /users/:userId`, intersect any incoming permissions against the granter's before storing, and make `UserPermissionsDialog.tsx` disable checkboxes for permissions the granter lacks (backend clamp is authoritative; UI is UX). See [`SECURITY_REVIEW_ADMIN_PERMISSIONS.md`](./SECURITY_REVIEW_ADMIN_PERMISSIONS.md) Findings 1–3 for diffs.

**Risk: Low.** Additive `allowed_tenants`-style clamp; backend is the control. Test: restricted granter cannot grant a permission they lack.

---

### Phase 1 — Introduce the query builder, off dynamic `/api/db` (closes S1 structurally)

#### PR 1.0 — Bring in Kysely (spike + wiring)

Add `kysely` to `server/package.json`. Add a thin adapter: a `createKysely(dbPool)` factory wrapping an existing mysql2 pool (Kysely's `mysql2` dialect accepts a pool instance). Prove it on one read path — e.g. the `getValidColumns` `SHOW COLUMNS FROM` in `dbProxy.js` (the exact line that was the injection vector) — rewritten through Kysely.

Deliverable: a running spike PR, merged, with zero behavior change on that one path and a passing identifier test. This de-risks the tenant-pool coupling (Decision "Tenant-pool coupling") before touching write paths.

**Risk: Low.** One read path, fully covered by existing tests. Establishes the pattern + the `createKysely(req.db)` convention.

#### PR 1.1 — `dbProxy` create path through the builder

Move `create` (the `INSERT INTO \`{tableName}\`` path) behind a Kysely-backed helper. Keep `assertValidIdentifier` as defence-in-depth; the builder is now the primary control. The grep gate fires for the first time here: `grep -n '${tableName}' server/routes/dbProxy.js` must show only the builder-asserted entry, no raw interpolation.

**Risk: Medium.** Write path, exercised by E2E + unit tests. Run the full `unit` suite (643 tests) + the renamePosition / atomic / tenant suites.

#### PR 1.2 — `dbProxy` update / delete paths

Same as 1.1 for `update` (`UPDATE \`{tableName}\` SET ...`) and `delete`. These also carry the ShiftEntry partial-update gap (Finding S5 of the system review) — when moving `update`, fix the position lookup to fetch the existing record's `position` when `data.position` is absent (mirror the `delete` path / atomic guard).

**Risk: Medium.** Write paths. The S5 fix is a correctness improvement folded in.

#### PR 1.3 — `dbProxy` list / filter / get paths

Move reads through the builder. The `filter` query operators (`$gte`/`$lte`/`$gt`/`$lt`/`$in`/`$ne`) move into the builder's `where` builder, where Kysely escapes the column identifier (the `$ne`-short-circuits-range edge case noted in the review is naturally resolved by a per-condition `where` chain).

**Risk: Low.** Read-only. Good place to add the tenant-pool-isolation test (Decision "Tenant-pool coupling").

#### PR 1.4 — `atomic.js` through the builder

`atomic.js` interpolates `entity` into `SELECT * FROM`/`UPDATE`/`DELETE FROM` in its `getRecord`/`updateRecord`/`createRecord`/`deleteRecord` helpers. Route them through the same builder helpers 1.1–1.3 introduced. `assertValidIdentifier(entity)` stays as defence-in-depth at the operation entry.

**Risk: Medium.** `atomic` handles optimistic locking (`check.updated_date`); preserve that check exactly — type annotations + builder, **zero logic changes** in the compare-and-set path.

---

### Phase 2 — Typed repositories for the core entities (kills the gateway smell)

Replace generic-proxy entries for the highest-traffic/highest-risk entities with concrete repo functions. After this, those table names are **constants in code**, not user input that must be validated.

Target entities (from the permission-system protected tables + core schedule domain): `ShiftEntry`, `Doctor`, `WishRequest`, `AbsenceRequest`, `Qualification`/`QualificationCertificate`.

Each entity gets a small repo module (`server/repos/shiftEntryRepo.ts`) with typed signatures returning `ShiftEntry | null` / `ShiftEntry[]`. Routes that today hit `/api/db` for these call the repo directly. The generic `/api/db` proxy is narrowed to the long-tail entities that haven't been repo-ified (still safely escaped from Phase 1).

**Risk per entity: Medium.** Behavioral parity is the contract; E2E + unit suites cover it. Do not refactor logic during the move — same columns, same where-clauses, same order-by.

---

### Phase 3 — TypeScript port (ride-along, long tail)

With a builder + typed repos in place, the TS port is mostly mechanical and the types are largely free (Kysely infers from the schema). Port `server/` files to `.ts` opportunistically as touched in Phases 1–2, then sweep remaining files in SLOC order, smallest first (matches the frontend plan's risk ordering).

**Setup PR (3.0):** add `server/tsconfig.json` (`strict: true`, `module: node16`/`nodenext` to match `"type": "module"`), add `tsc` to `server/package.json` scripts, decide runtime (see Decision below). Convert `server/utils/schema.js` first (small, already has tests from PR #1) to prove the toolchain.

**Runtime decision:** the server has **no build step today** (`node --watch index.js`). Two options:
- **`tsx`/`--experimental-strip-types`** run the `.ts` directly (Node 22+ strips types natively) — zero build step, lowest friction, matches "no build" status quo. Recommended.
- A `tsc` build step emitting `dist-server/` — more control, more ceremony. Only if stripping causes issues with the chosen Kysely/Drizzle import shapes.

**Risk: Medium.** Same silent-null trap as the frontend; mitigate with explicit `| null` returns and no `as` casts. Backend has decent unit coverage (643 tests) that the port must keep green throughout.

---

## Per-PR verification

Every PR in this plan must pass:

```bash
# Backend (server is eslint-ignored by config — lint the touched files explicitly)
npx eslint --no-ignore <changed files>
npm run test:unit            # 643+ tests; must stay green throughout
# Integration (tenant DB) for Phase 0 + Phase 1 write paths:
npm run test:db:up && npm run test:db:seed
# Identifier-injection grep gate (Phase 1+):
grep -rn '${' server/routes/dbProxy.js server/routes/atomic.js | grep -E 'FROM `|INTO `|UPDATE `|DELETE FROM `'
# the above must return ONLY builder-asserted sites (entry points), never raw interpolation
```

Phase 1+ additionally: the `schema.test.js` injection suite (from [PR #1](https://github.com/knopkem/CuraFlow/pull/1)) stays green throughout — the builder does not remove that defence-in-depth guard.

---

## Sizing summary

| Phase | PRs | Surface | Closes | Risk |
|---|---|---|---|---|
| 0. Trust-boundary fixes | 3 | `index.js`, `dbProxy.js`, `atomic.js`, `auth.js`, `UserPermissionsDialog.tsx` | S2, S7, perm-model F1–F3 | Low–Med |
| 1. Builder on dynamic paths | 5 (1.0 spike + 1.1–1.4) | `dbProxy.js`, `atomic.js`, new adapter | S1 (structurally), S5 | Med |
| 2. Typed repositories | ~5 (one per core entity) | new `server/repos/*` | removes table-name-as-input for core domain | Med |
| 3. TS port (ride-along) | long tail | remaining `server/**` | DX, refactor safety | Med |

**Out of scope for this plan** (kept as-is): the migration system (73 + 39 + 27 blocks), `tenantDbMiddleware` pool cache, the Tisoware PHP/ODBC proxy (`tisowarePhpProxy.js` — already safe: fixed script path, SQL via stdin, static `exec` strings), certificate upload (already parameterized + MIME-allowlisted + tenant-key scoped).

---

## What this plan does NOT fix (recorded so it isn't conflated)

These are documented in [`SECURITY_REVIEW_SYSTEM.md`](./SECURITY_REVIEW_SYSTEM.md) and are **not** addressed by a query builder or TS:

- **S3** — `db_token` embedded in email reminder links (`certificates.js:278`). Needs short-lived signed token; orthogonal to the data layer.
- **S4** — JWT in SSE `?access_token=` param. Accepted EventSource pattern; hardening optional.
- **S5** — ShiftEntry partial-update bypass. **Is** addressed, folded into Phase 1 PR 1.2.
- **S6** — `rejectUnauthorized: false` on admin-configured DB/SMTP. Env/config hardening, separate.

The trust-boundary trio (S1 builder, S2 tenant authz, S7 JWT-role) are the high-severity items and are all scheduled above.

---

## Relationship to the frontend plan

- **Independent.** This plan touches `server/**`; [`TYPESCRIPT_CONVERSION_PLAN.md`](./TYPESCRIPT_CONVERSION_PLAN.md) touches `src/**`. No shared PRs, no cross-dependency.
- **Shared discipline.** Both follow "type annotations + structural fix, zero unrelated logic changes." The frontend's "refactoring trap" warning (don't rename `handleDragEnd` variables while converting) has a backend analogue: don't reorder columns or change where-clause semantics while moving a query to the builder.
- **Shared types eventually.** Once Phase 3 lands Kysely-generated row types in `server/`, a future step can share domain types with `src/types/` (today these are hand-maintained and duplicated). That is a follow-up, not part of this plan.
