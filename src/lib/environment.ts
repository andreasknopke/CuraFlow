export const TEST_ENVIRONMENT_ORIGIN = 'https://curaflow-production.up.railway.app';
export const PRODUCTION_ENVIRONMENT_URL = 'https://cf.coolify.kliniksued-rostock.de/';

export function isTestEnvironmentOrigin(
  origin: string = typeof window !== 'undefined' ? window.location.origin : '',
): boolean {
  return origin === TEST_ENVIRONMENT_ORIGIN;
}
