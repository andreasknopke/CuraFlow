/**
 * CuraFlow — Query Client
 *
 * Singleton TanStack Query client instance used across the app.
 * Configured with conservative defaults for hospital environments.
 *
 * @module lib/query-client
 */

import { QueryClient } from '@tanstack/react-query';

export const queryClientInstance = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});
