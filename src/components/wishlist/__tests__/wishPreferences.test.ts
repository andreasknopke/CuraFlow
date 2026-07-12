import { describe, expect, it } from 'vitest';
import { resolveWishDefaultPosition } from '@/components/wishlist/wishPreferences';

describe('resolveWishDefaultPosition', () => {
  it('returns the saved position when it is still available', () => {
    expect(resolveWishDefaultPosition(['Dienst Vordergrund', 'Dienst Hintergrund'], 'Dienst Hintergrund')).toBe('Dienst Hintergrund');
  });

  it('falls back to the first service type when the saved position is missing', () => {
    expect(resolveWishDefaultPosition(['Dienst Vordergrund', 'Dienst Hintergrund'], 'Spätdienst')).toBe('Dienst Vordergrund');
  });

  it('returns null when no service types are available', () => {
    expect(resolveWishDefaultPosition([], 'Dienst Hintergrund')).toBeNull();
  });
});