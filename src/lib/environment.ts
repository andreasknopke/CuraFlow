/**
 * CuraFlow — Environment Detection
 *
 * Identifies the test environment origin and production URL.
 * Used for conditional behavior in test vs. production contexts.
 *
 * @module lib/environment
 */

export const TEST_ENVIRONMENT_ORIGIN = 'https://curaflow-production.up.railway.app';
export const PRODUCTION_ENVIRONMENT_URL = 'https://cf.coolify.kliniksued-rostock.de/';

/**
 * Returns true if the current window origin matches the test environment.
 * Safe to call during SSR (no window).
 */
export function isTestEnvironmentOrigin(
  origin: string = typeof window !== 'undefined' ? window.location.origin : '',
): boolean {
  return origin === TEST_ENVIRONMENT_ORIGIN;
}
