import type { QueryClient } from '@tanstack/react-query';

export const POOL_SHIFT_REFRESH_QUERY_KEYS: string[][] = [
  ['pool', 'visible-shifts'],
  ['pool', 'schedule'],
  ['shifts'],
];

export async function invalidatePoolShiftQueries(queryClient: QueryClient): Promise<void> {
  await Promise.all(
    POOL_SHIFT_REFRESH_QUERY_KEYS.map((queryKey) => queryClient.invalidateQueries({ queryKey }))
  );
}
