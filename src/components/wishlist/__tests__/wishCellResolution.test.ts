import { describe, expect, it } from 'vitest';
import { resolveWishForCell } from '@/components/wishlist/wishCellResolution';
import type { WishRequest } from '@/types';

const makeWish = (overrides: Partial<WishRequest>): WishRequest => ({
    id: 'w-1',
    doctor_id: 'd1',
    date: '2026-10-01',
    type: 'service',
    position: 'Dienst Vordergrund',
    priority: 'medium',
    status: 'pending',
    user_viewed: false,
    created_date: '2026-01-01T00:00:00.000Z',
    updated_date: '2026-01-01T00:00:00.000Z',
    ...overrides,
});

const date = new Date(2026, 9, 1); // 2026-10-01

describe('resolveWishForCell', () => {
    it('returns undefined when the doctor has no wishes on that date', () => {
        expect(resolveWishForCell([], 'd1', date, 'Dienst Vordergrund')).toBeUndefined();
        expect(
            resolveWishForCell([makeWish({ date: '2026-10-02' })], 'd1', date, 'Dienst Vordergrund'),
        ).toBeUndefined();
    });

    it('ignores wishes of other doctors', () => {
        const wish = makeWish({ doctor_id: 'd2' });
        expect(resolveWishForCell([wish], 'd1', date, 'Dienst Vordergrund')).toBeUndefined();
    });

    it('prefers a no_service wish over a service wish on the same day (bug fix)', () => {
        const noService = makeWish({ type: 'no_service', position: 'Dienst Vordergrund' });
        const service = makeWish({ id: 'w-2', type: 'service' });
        expect(resolveWishForCell([service, noService], 'd1', date, 'Dienst Vordergrund')).toBe(noService);
    });

    it('prefers a global no_service wish (no position) over a service wish', () => {
        const noService = makeWish({ type: 'no_service', position: null });
        const service = makeWish({ id: 'w-2', type: 'service' });
        expect(resolveWishForCell([service, noService], 'd1', date, 'Dienst Vordergrund')).toBe(noService);
    });

    it('prefers no_service when no active tab is selected', () => {
        const noService = makeWish({ type: 'no_service', position: 'Dienst Hintergrund' });
        const service = makeWish({ id: 'w-2', type: 'service' });
        expect(resolveWishForCell([service, noService], 'd1', date, null)).toBe(noService);
    });

    it('returns the service wish for the active tab when no_service targets another position', () => {
        const noService = makeWish({ type: 'no_service', position: 'Dienst Hintergrund' });
        const service = makeWish({ id: 'w-2', type: 'service', position: 'Dienst Vordergrund' });
        expect(resolveWishForCell([noService, service], 'd1', date, 'Dienst Vordergrund')).toBe(service);
    });

    it('returns undefined when only a no_service wish for another position exists', () => {
        const noService = makeWish({ type: 'no_service', position: 'Dienst Hintergrund' });
        expect(resolveWishForCell([noService], 'd1', date, 'Dienst Vordergrund')).toBeUndefined();
    });

    it('returns the first wish when only service wishes exist and no active tab is selected', () => {
        const first = makeWish({ id: 'w-1' });
        const second = makeWish({ id: 'w-2', position: 'Dienst Hintergrund' });
        expect(resolveWishForCell([first, second], 'd1', date, null)).toBe(first);
    });
});
