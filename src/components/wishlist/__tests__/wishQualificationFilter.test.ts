import { describe, expect, it } from 'vitest';
import { filterQualifiedWishServiceTypes, isDoctorQualifiedForWishWorkplace } from '@/components/wishlist/wishQualificationFilter';

describe('isDoctorQualifiedForWishWorkplace', () => {
  it('allows workplaces without blocking qualification rules', () => {
    expect(isDoctorQualifiedForWishWorkplace([], [])).toBe(true);
    expect(isDoctorQualifiedForWishWorkplace([], [
      { qualification_id: 'preferred', is_mandatory: false, is_excluded: false },
    ])).toBe(true);
  });

  it('blocks workplaces when a mandatory qualification is missing', () => {
    expect(isDoctorQualifiedForWishWorkplace(['fa'], [
      { qualification_id: 'fa', is_mandatory: true, is_excluded: false },
      { qualification_id: 'hg', is_mandatory: true, is_excluded: false },
    ])).toBe(false);
  });

  it('blocks workplaces when the doctor has an excluded qualification', () => {
    expect(isDoctorQualifiedForWishWorkplace(['rotation'], [
      { qualification_id: 'rotation', is_mandatory: false, is_excluded: true },
    ])).toBe(false);
  });
});

describe('filterQualifiedWishServiceTypes', () => {
  it('returns only workplaces the selected doctor can request', () => {
    const workplaces = [
      { id: 'front', name: 'Dienst Vordergrund' },
      { id: 'back', name: 'Dienst Hintergrund' },
      { id: 'free', name: 'Dienst Frei wählbar' },
    ];

    const result = filterQualifiedWishServiceTypes(workplaces, ['vg'], {
      front: [{ qualification_id: 'vg', is_mandatory: true, is_excluded: false }],
      back: [{ qualification_id: 'hg', is_mandatory: true, is_excluded: false }],
      free: [],
    });

    expect(result.map((entry) => entry.id)).toEqual(['front', 'free']);
  });
});