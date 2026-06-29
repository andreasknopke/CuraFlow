import { describe, expect, it, vi } from 'vitest';

import {
  invalidatePoolShiftQueries,
  POOL_SHIFT_REFRESH_QUERY_KEYS,
} from '../poolShiftQueries';

describe('invalidatePoolShiftQueries', () => {
  it('refreshes pool and tenant schedule queries after a cross-tenant change', async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);

    await invalidatePoolShiftQueries({ invalidateQueries });

    expect(invalidateQueries).toHaveBeenCalledTimes(POOL_SHIFT_REFRESH_QUERY_KEYS.length);
    expect(invalidateQueries).toHaveBeenNthCalledWith(1, { queryKey: ['pool', 'visible-shifts'] });
    expect(invalidateQueries).toHaveBeenNthCalledWith(2, { queryKey: ['pool', 'ward-demands'] });
    expect(invalidateQueries).toHaveBeenNthCalledWith(3, { queryKey: ['pool', 'schedule'] });
    expect(invalidateQueries).toHaveBeenNthCalledWith(4, { queryKey: ['shifts'] });
  });
});