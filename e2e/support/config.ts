import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadOptionalTestEnv } from '../../scripts/load-test-env.js';

export type SeededRole = 'admin' | 'user' | 'readonly';

loadOptionalTestEnv();

const currentDir = path.dirname(fileURLToPath(import.meta.url));

export const repoRoot = path.resolve(currentDir, '../..');
export const frontendPort = Number(process.env.PLAYWRIGHT_FRONTEND_PORT || '4173');
export const baseURL = process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${frontendPort}`;
export const backendURL = process.env.PLAYWRIGHT_BACKEND_URL || 'http://127.0.0.1:3100';
export const authStateDir = path.join(repoRoot, 'e2e', '.auth');

export const requiredHarnessEnvNames = [
  'TEST_MYSQL_ROOT_PASSWORD',
  'TEST_MYSQL_PASSWORD',
  'TEST_JWT_SECRET',
  'SEED_ADMIN_PASSWORD',
  'SEED_USER_PASSWORD',
  'SEED_READONLY_PASSWORD',
] as const;

export const storageStatePaths = {
  admin: path.join(authStateDir, 'admin.json'),
  user: path.join(authStateDir, 'user.json'),
  readonly: path.join(authStateDir, 'readonly.json'),
} as const;

export const seededUsers = {
  admin: {
    email: 'admin@test.local',
    passwordEnv: 'SEED_ADMIN_PASSWORD',
    storageStatePath: storageStatePaths.admin,
  },
  user: {
    email: 'user@test.local',
    passwordEnv: 'SEED_USER_PASSWORD',
    storageStatePath: storageStatePaths.user,
  },
  readonly: {
    email: 'readonly@test.local',
    passwordEnv: 'SEED_READONLY_PASSWORD',
    storageStatePath: storageStatePaths.readonly,
  },
} as const;

const seededTargetMonth = process.env.TEST_TARGET_MONTH || '2026-05';
const seededTargetMonthMatch = seededTargetMonth.match(/^(\d{4})-(\d{2})$/);

if (!seededTargetMonthMatch) {
  throw new Error(`TEST_TARGET_MONTH must use YYYY-MM format, received "${seededTargetMonth}"`);
}

const seededTargetYear = Number(seededTargetMonthMatch[1]);
const seededTargetMonthNumber = Number(seededTargetMonthMatch[2]);

if (seededTargetMonthNumber < 1 || seededTargetMonthNumber > 12) {
  throw new Error(`TEST_TARGET_MONTH must contain a valid month, received "${seededTargetMonth}"`);
}

const seededMonthLastDay = new Date(Date.UTC(seededTargetYear, seededTargetMonthNumber, 0)).getUTCDate();
const formatSeededMonthDay = (day: number) => `${seededTargetMonth}-${String(day).padStart(2, '0')}`;

export const seededSchedule = {
  targetMonth: seededTargetMonth,
  focusDate: formatSeededMonthDay(5),
  rangeStart: formatSeededMonthDay(1),
  rangeEnd: formatSeededMonthDay(seededMonthLastDay),
  shiftIds: {
    // These IDs are fixed by the deterministic seed script even when TEST_TARGET_MONTH changes.
    foreground: 'shift-2026-05-05-foreground',
    background: 'shift-2026-05-05-background',
    ct: 'shift-2026-05-06-ct',
    mrt: 'shift-2026-05-06-mrt',
  },
} as const;

export function getHarnessEnv() {
  const env = { ...process.env };

  for (const name of requiredHarnessEnvNames) {
    if (!env[name]) {
      throw new Error(`${name} is required to run the Playwright UI harness`);
    }
  }

  return env;
}

export function getUserPassword(role: SeededRole) {
  const envName = seededUsers[role].passwordEnv;
  const password = process.env[envName];

  if (!password) {
    throw new Error(`${envName} is required to run the Playwright smoke tests`);
  }

  return password;
}

export function getTenantId() {
  return process.env.TEST_TENANT_ID || 'tenant-main';
}
