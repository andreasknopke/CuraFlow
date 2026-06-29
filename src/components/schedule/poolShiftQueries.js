export const POOL_SHIFT_REFRESH_QUERY_KEYS = [
  ['pool', 'visible-shifts'],
  ['pool', 'schedule'],
  ['shifts'],
];

export async function invalidatePoolShiftQueries(queryClient) {
  await Promise.all(
    POOL_SHIFT_REFRESH_QUERY_KEYS.map((queryKey) => queryClient.invalidateQueries({ queryKey }))
  );
}