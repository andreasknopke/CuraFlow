import { describe, it, expect } from 'vitest';
import { generateSuggestions } from '../autoFillEngine';
import type { Doctor, Workplace, ShiftEntry, WishRequest } from '@/types';

// ---------------------------------------------------------------------------
// Helper: minimal doctor factory
// ---------------------------------------------------------------------------
function doctor(overrides: Partial<Doctor> = {}): Doctor {
  return {
    id: overrides.id ?? 'doc-1',
    name: overrides.name ?? 'Dr. Test',
    fte: overrides.fte ?? 1.0,
    exclude_from_staffing_plan: false,
    order: 0,
    is_active: true,
    created_date: '2024-01-01T00:00:00',
    updated_date: '2024-01-01T00:00:00',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helper: minimal workplace factory
// ---------------------------------------------------------------------------
function workplace(overrides: Partial<Workplace> = {}): Workplace {
  return {
    id: overrides.id ?? 'wp-1',
    name: overrides.name ?? 'CT',
    category: overrides.category ?? 'Dienste',
    color: null,
    active_days: overrides.active_days ?? [],
    time: null,
    allows_multiple: false,
    timeslots_enabled: overrides.timeslots_enabled ?? false,
    default_overlap_tolerance_minutes: 0,
    work_time_percentage: 100,
    affects_availability: overrides.affects_availability ?? true,
    allows_rotation_concurrently: overrides.allows_rotation_concurrently ?? false,
    min_staff: overrides.min_staff ?? 1,
    optimal_staff: overrides.optimal_staff ?? 1,
    service_type: overrides.service_type ?? null,
    allows_absence_overlap: false,
    consecutive_days_mode: overrides.consecutive_days_mode ?? 'allowed',
    auto_off: overrides.auto_off ?? false,
    order: overrides.order ?? 0,
    is_active: true,
    created_date: '2024-01-01T00:00:00',
    updated_date: '2024-01-01T00:00:00',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helper: minimal shift factory
// ---------------------------------------------------------------------------
function makeShift(overrides: Partial<ShiftEntry> = {}): ShiftEntry {
  return {
    id: overrides.id ?? 'shift-1',
    date: overrides.date ?? '2026-06-15',
    position: overrides.position ?? 'Frei',
    doctor_id: overrides.doctor_id ?? null,
    is_free_text: overrides.is_free_text ?? false,
    order: overrides.order ?? 0,
    created_date: '2024-01-01T00:00:00',
    updated_date: '2024-01-01T00:00:00',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helper: minimal wish factory
// ---------------------------------------------------------------------------
function makeWish(overrides: Partial<WishRequest> = {}): WishRequest {
  return {
    id: overrides.id ?? 'wish-1',
    doctor_id: overrides.doctor_id ?? 'doc-1',
    date: overrides.date ?? '2026-06-15',
    type: overrides.type ?? 'no_service',
    status: overrides.status ?? 'approved',
    priority: overrides.priority ?? 'medium',
    user_viewed: false,
    created_date: '2024-01-01T00:00:00',
    updated_date: '2024-01-01T00:00:00',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helper: default qualification callbacks (all pass = no restrictions)
// ---------------------------------------------------------------------------
function defaultQualFns(overrides: Record<string, unknown> = {}) {
  return {
    isPublicHoliday: (overrides.isPublicHoliday as ((date: Date) => boolean) | undefined) ?? (() => false),
    getDoctorQualIds: (overrides.getDoctorQualIds as ((id: string) => string[]) | undefined) ?? (() => []),
    getWpRequiredQualIds: (overrides.getWpRequiredQualIds as ((id: string) => string[]) | undefined) ?? (() => []),
    getWpOptionalQualIds: (overrides.getWpOptionalQualIds as ((id: string) => string[]) | undefined) ?? (() => []),
    getWpExcludedQualIds: (overrides.getWpExcludedQualIds as ((id: string) => string[]) | undefined) ?? (() => []),
    getWpDiscouragedQualIds: (overrides.getWpDiscouragedQualIds as ((id: string) => string[]) | undefined) ?? (() => []),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('generateSuggestions', () => {
  it('returns an empty array when there are no doctors, no workplaces', () => {
    const result = generateSuggestions({
      weekDays: [new Date(2026, 5, 15)],
      doctors: [],
      workplaces: [],
      existingShifts: [],
      trainingRotations: [],
      categoriesToFill: ['Dienste'],
      systemSettings: [],
      ...defaultQualFns(),
    });
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
  });

  it('handles a single doctor and workplace correctly (smoke test)', () => {
    const doc: any = doctor({ id: 'doc-smoke', name: 'Dr. Smoke' });
    const svc: any = workplace({
      id: 'wp-smoke', name: 'BG', category: 'Dienste', service_type: 2,
      optimal_staff: 1, min_staff: 1,
    });
    const result = generateSuggestions({
      weekDays: [new Date(2026, 5, 15)],
      doctors: [doc],
      workplaces: [svc],
      existingShifts: [],
      trainingRotations: [],
      categoriesToFill: ['Dienste'],
      systemSettings: [],
      ...defaultQualFns(),
    });
    expect(Array.isArray(result)).toBe(true);
    expect(result.filter((s: any) => s.position === 'BG').length).toBeGreaterThanOrEqual(1);
  });

  it('does not assign a doctor who is absent (has an absence shift)', () => {
    const doc: any = doctor({ id: 'doc-1', name: 'Dr. Alpha' });
    const svc: any = workplace({
      id: 'wp-svc',
      name: 'BG',
      category: 'Dienste',
      service_type: 2,
      optimal_staff: 1,
      min_staff: 1,
    });

    const result = generateSuggestions({
      weekDays: [new Date(2026, 5, 15)],
      doctors: [doc],
      workplaces: [svc],
      existingShifts: [
        makeShift({ date: '2026-06-15', position: 'Frei', doctor_id: 'doc-1' }),
      ],
      trainingRotations: [],
      categoriesToFill: ['Dienste'],
      systemSettings: [],
      ...defaultQualFns(),
    });

    // Doctor is absent -> should not be assigned to any service
    const serviceAssignments = result.filter((s: any) => s.position !== 'Frei');
    expect(serviceAssignments).toHaveLength(0);
  });

  it('assigns a doctor to a service when qualified and available', () => {
    const doc: any = doctor({ id: 'doc-1', name: 'Dr. Alpha' });
    const svc: any = workplace({
      id: 'wp-svc',
      name: 'VG',
      category: 'Dienste',
      service_type: 1,
      optimal_staff: 1,
      min_staff: 1,
    });

    const result = generateSuggestions({
      weekDays: [new Date(2026, 5, 15)],
      doctors: [doc],
      workplaces: [svc],
      existingShifts: [],
      trainingRotations: [],
      categoriesToFill: ['Dienste', 'Rotationen'],
      systemSettings: [],
      ...defaultQualFns(),
    });

    const serviceAssignments = result.filter((s: any) => s.position === 'VG');
    expect(serviceAssignments.length).toBeGreaterThanOrEqual(1);
    expect(serviceAssignments[0].doctor_id).toBe('doc-1');
    expect(serviceAssignments[0].isPreview).toBe(true);
    expect(serviceAssignments[0].date).toBe('2026-06-15');
  });

  it('assigns a doctor to a rotation workplace (Phase B)', () => {
    const doc: any = doctor({ id: 'doc-rot', name: 'Dr. Rotation' });
    const rot: any = workplace({
      id: 'wp-rot',
      name: 'CT',
      category: 'Rotationen',
      affects_availability: true,
      optimal_staff: 1,
      min_staff: 1,
    });

    const result = generateSuggestions({
      weekDays: [new Date(2026, 5, 15)],
      doctors: [doc],
      workplaces: [rot],
      existingShifts: [],
      trainingRotations: [],
      categoriesToFill: ['Rotationen'],
      systemSettings: [],
      ...defaultQualFns(),
    });

    const rotAssignments = result.filter((s: any) => s.position === 'CT');
    expect(rotAssignments.length).toBeGreaterThanOrEqual(1);
    expect(rotAssignments[0].doctor_id).toBe('doc-rot');
  });

  it('assigns a non-availability workplace in Phase C', () => {
    const doc: any = doctor({ id: 'doc-demo', name: 'Dr. Demo' });
    const demo: any = workplace({
      id: 'wp-demo',
      name: 'Demo',
      category: 'Demonstrationen & Konsile',
      affects_availability: false,
      optimal_staff: 1,
      min_staff: 1,
    });

    const result = generateSuggestions({
      weekDays: [new Date(2026, 5, 15)],
      doctors: [doc],
      workplaces: [demo],
      existingShifts: [],
      trainingRotations: [],
      categoriesToFill: ['Demonstrationen & Konsile'],
      systemSettings: [],
      ...defaultQualFns(),
    });

    const demoAssignments = result.filter((s: any) => s.position === 'Demo');
    expect(demoAssignments.length).toBeGreaterThanOrEqual(1);
  });

  it('skips workplaces not in categoriesToFill', () => {
    const doc: any = doctor({ id: 'doc-1', name: 'Dr. Alpha' });
    const svc: any = workplace({
      id: 'wp-svc',
      name: 'BG',
      category: 'Dienste',
      service_type: 2,
      optimal_staff: 1,
      min_staff: 1,
    });

    const result = generateSuggestions({
      weekDays: [new Date(2026, 5, 15)],
      doctors: [doc],
      workplaces: [svc],
      existingShifts: [],
      trainingRotations: [],
      categoriesToFill: ['Rotationen'], // Dienste not included!
      systemSettings: [],
      ...defaultQualFns(),
    });

    const assignments = result.filter((s: any) => s.position === 'BG');
    expect(assignments).toHaveLength(0);
  });

  it('respects an approved "kein Dienst" wish (hard block)', () => {
    const doc: any = doctor({ id: 'doc-wish', name: 'Dr. Wunsch' });
    const svc: any = workplace({
      id: 'wp-svc',
      name: 'VG',
      category: 'Dienste',
      service_type: 1,
      optimal_staff: 1,
      min_staff: 1,
    });

    const result = generateSuggestions({
      weekDays: [new Date(2026, 5, 15)],
      doctors: [doc],
      workplaces: [svc],
      existingShifts: [],
      trainingRotations: [],
      categoriesToFill: ['Dienste'],
      systemSettings: [],
      wishes: [
        makeWish({ doctor_id: 'doc-wish', date: '2026-06-15', type: 'no_service', status: 'approved' }),
      ],
      ...defaultQualFns(),
    });

    const serviceAssignments = result.filter((s: any) => s.position === 'VG');
    expect(serviceAssignments).toHaveLength(0);
  });

  it('generates Auto-Frei for a service with auto_off enabled', () => {
    const doc: any = doctor({ id: 'doc-af', name: 'Dr. AutoFrei' });
    const svc: any = workplace({
      id: 'wp-svc',
      name: 'BG',
      category: 'Dienste',
      service_type: 2,
      auto_off: true,
      optimal_staff: 1,
      min_staff: 1,
    });

    const result = generateSuggestions({
      weekDays: [new Date(2026, 5, 15), new Date(2026, 5, 16)],
      doctors: [doc],
      workplaces: [svc],
      existingShifts: [],
      trainingRotations: [],
      categoriesToFill: ['Dienste'],
      systemSettings: [],
      ...defaultQualFns(),
    });

    const freiEntries = result.filter((s: any) => s.position === 'Frei');
    // Doctor was assigned on June 15 -> Auto-Frei on June 16
    expect(freiEntries.length).toBeGreaterThanOrEqual(1);
    const autoFrei = freiEntries.find((f: any) => f.doctor_id === 'doc-af');
    expect(autoFrei).toBeTruthy();
    expect(autoFrei!.note).toContain('Autom. Freizeitausgleich');
  });

  it('respects mandatory qualification requirements', () => {
    const docQualified: any = doctor({ id: 'doc-qual', name: 'Dr. Qualified' });
    const docUnqualified: any = doctor({ id: 'doc-unqual', name: 'Dr. Unqualified' });
    const svc: any = workplace({
      id: 'wp-ct',
      name: 'CT',
      category: 'Dienste',
      service_type: 2,
      optimal_staff: 1,
      min_staff: 1,
    });

    const result = generateSuggestions({
      weekDays: [new Date(2026, 5, 15)],
      doctors: [docQualified, docUnqualified],
      workplaces: [svc],
      existingShifts: [],
      trainingRotations: [],
      categoriesToFill: ['Dienste'],
      systemSettings: [],
      getDoctorQualIds: (id: any) => id === 'doc-qual' ? ['qual-ct'] : [],
      getWpRequiredQualIds: () => ['qual-ct'],
      getWpOptionalQualIds: () => [],
      getWpExcludedQualIds: () => [],
      getWpDiscouragedQualIds: () => [],
      isPublicHoliday: () => false,
    });

    const ctAssignments = result.filter((s: any) => s.position === 'CT');
    expect(ctAssignments.length).toBeGreaterThanOrEqual(1);
    // Only the qualified doctor should be assigned
    expect(ctAssignments.every((s: any) => s.doctor_id === 'doc-qual')).toBe(true);
  });

  it('respects NOT-qualification (exclusion)', () => {
    const docNormal: any = doctor({ id: 'doc-normal', name: 'Dr. Normal' });
    const docExcluded: any = doctor({ id: 'doc-excl', name: 'Dr. Excluded' });
    const svc: any = workplace({
      id: 'wp-svc',
      name: 'VG',
      category: 'Dienste',
      service_type: 1,
      optimal_staff: 1,
      min_staff: 1,
    });

    const result = generateSuggestions({
      weekDays: [new Date(2026, 5, 15)],
      doctors: [docNormal, docExcluded],
      workplaces: [svc],
      existingShifts: [],
      trainingRotations: [],
      categoriesToFill: ['Dienste'],
      systemSettings: [],
      getDoctorQualIds: (id: any) => id === 'doc-excl' ? ['qual-excl'] : ['qual-other'],
      getWpRequiredQualIds: () => [],
      getWpOptionalQualIds: () => [],
      getWpExcludedQualIds: () => ['qual-excl'],
      getWpDiscouragedQualIds: () => [],
      isPublicHoliday: () => false,
    });

    const assignments = result.filter((s: any) => s.position === 'VG');
    expect(assignments.length).toBeGreaterThanOrEqual(1);
    expect(assignments.every((s: any) => s.doctor_id === 'doc-normal')).toBe(true);
  });

  it('skips inactive days for a workplace', () => {
    const doc: any = doctor({ id: 'doc-1', name: 'Dr. Alpha' });
    const svc: any = workplace({
      id: 'wp-svc',
      name: 'VG',
      category: 'Dienste',
      service_type: 1,
      optimal_staff: 1,
      min_staff: 1,
      active_days: [1, 2, 3, 4, 5], // Mo-Fr
    });

    // Saturday (day 6)
    const result = generateSuggestions({
      weekDays: [new Date(2026, 5, 20)],
      doctors: [doc],
      workplaces: [svc],
      existingShifts: [],
      trainingRotations: [],
      categoriesToFill: ['Dienste'],
      systemSettings: [],
      ...defaultQualFns(),
    });

    const assignments = result.filter((s: any) => s.position === 'VG');
    expect(assignments).toHaveLength(0);
  });

  it('sorts suggestions by date', () => {
    const doc: any = doctor({ id: 'doc-1', name: 'Dr. Alpha' });
    const svc: any = workplace({
      id: 'wp-svc',
      name: 'BG',
      category: 'Dienste',
      service_type: 2,
      optimal_staff: 1,
      min_staff: 1,
    });

    const result = generateSuggestions({
      weekDays: [new Date(2026, 5, 15), new Date(2026, 5, 16)],
      doctors: [doc],
      workplaces: [svc],
      existingShifts: [],
      trainingRotations: [],
      categoriesToFill: ['Dienste'],
      systemSettings: [],
      ...defaultQualFns(),
    });

    // Should have entries for both days
    const dates = [...new Set(result.filter((s: any) => s.position === 'BG').map((s: any) => s.date))];
    expect(dates).toContain('2026-06-15');
    expect(dates).toContain('2026-06-16');
  });

  it('does not assign the same doctor twice to the same workplace on the same day', () => {
    const doc: any = doctor({ id: 'doc-1', name: 'Dr. Alpha' });
    const svc: any = workplace({
      id: 'wp-svc',
      name: 'VG',
      category: 'Dienste',
      service_type: 1,
      optimal_staff: 2,
      min_staff: 1,
    });

    const result = generateSuggestions({
      weekDays: [new Date(2026, 5, 15)],
      doctors: [doc],
      workplaces: [svc],
      existingShifts: [],
      trainingRotations: [],
      categoriesToFill: ['Dienste'],
      systemSettings: [],
      ...defaultQualFns(),
    });

    const assignments = result.filter((s: any) => s.position === 'VG');
    const docAssignments = assignments.filter((s: any) => s.doctor_id === 'doc-1');
    // One doctor can only be assigned once per workplace per day
    expect(docAssignments.length).toBeLessThanOrEqual(1);
  });

  it('handles weekends (Saturday = day 6, Sunday = day 0) for active days', () => {
    const doc: any = doctor({ id: 'doc-1', name: 'Dr. Alpha' });
    const svc: any = workplace({
      id: 'wp-svc',
      name: 'VG',
      category: 'Dienste',
      service_type: 1,
      optimal_staff: 1,
      min_staff: 1,
      active_days: [0, 1, 2, 3, 4, 5, 6], // every day
    });

    // Saturday
    const resultSat = generateSuggestions({
      weekDays: [new Date(2026, 5, 20)],
      doctors: [doc],
      workplaces: [svc],
      existingShifts: [],
      trainingRotations: [],
      categoriesToFill: ['Dienste'],
      systemSettings: [],
      ...defaultQualFns(),
    });
    expect(resultSat.filter((s: any) => s.position === 'VG').length).toBeGreaterThanOrEqual(1);

    // Sunday
    const resultSun = generateSuggestions({
      weekDays: [new Date(2026, 5, 21)],
      doctors: [doc],
      workplaces: [svc],
      existingShifts: [],
      trainingRotations: [],
      categoriesToFill: ['Dienste'],
      systemSettings: [],
      ...defaultQualFns(),
    });
    expect(resultSun.filter((s: any) => s.position === 'VG').length).toBeGreaterThanOrEqual(1);
  });

  it('processes multiple doctors fairly (round-robin across days)', () => {
    const docs: any[] = [
      doctor({ id: 'doc-a', name: 'Dr. A' }),
      doctor({ id: 'doc-b', name: 'Dr. B' }),
      doctor({ id: 'doc-c', name: 'Dr. C' }),
    ];
    const svc: any = workplace({
      id: 'wp-svc',
      name: 'BG',
      category: 'Dienste',
      service_type: 2,
      optimal_staff: 1,
      min_staff: 1,
    });

    const result = generateSuggestions({
      weekDays: [
        new Date(2026, 5, 15),
        new Date(2026, 5, 16),
        new Date(2026, 5, 17),
        new Date(2026, 5, 18),
        new Date(2026, 5, 19),
      ],
      doctors: docs,
      workplaces: [svc],
      existingShifts: [],
      trainingRotations: [],
      categoriesToFill: ['Dienste'],
      systemSettings: [],
      ...defaultQualFns(),
    });

    const assignments = result.filter((s: any) => s.position === 'BG');
    // Each day should have exactly one assignment
    // With 3 doctors over 5 days, distribution should be spread
    const assignedDocIds = assignments.map((s: any) => s.doctor_id);
    expect(assignments.length).toBe(5);

    // All doctors should be assigned at least once
    expect(assignedDocIds.filter((id: any) => id === 'doc-a').length).toBeGreaterThanOrEqual(1);
    expect(assignedDocIds.filter((id: any) => id === 'doc-b').length).toBeGreaterThanOrEqual(1);
    expect(assignedDocIds.filter((id: any) => id === 'doc-c').length).toBeGreaterThanOrEqual(1);
  });

  it('skips a doctor who is already assigned to another availability-relevant position', () => {
    const doc: any = doctor({ id: 'doc-1', name: 'Dr. Alpha' });
    const svc: any = workplace({
      id: 'wp-svc',
      name: 'BG',
      category: 'Dienste',
      service_type: 2,
      optimal_staff: 1,
      min_staff: 1,
    });
    const rot: any = workplace({
      id: 'wp-rot',
      name: 'CT',
      category: 'Rotationen',
      affects_availability: true,
      optimal_staff: 1,
      min_staff: 1,
    });

    const result = generateSuggestions({
      weekDays: [new Date(2026, 5, 15)],
      doctors: [doc],
      workplaces: [svc, rot],
      existingShifts: [],
      trainingRotations: [],
      categoriesToFill: ['Dienste', 'Rotationen'],
      systemSettings: [],
      ...defaultQualFns(),
    });

    // Doctor should be assigned to either service (Phase A) or rotation (Phase B),
    // but not both since both affect availability
    const nonFreiAssignments = result.filter((s: any) => s.position !== 'Frei');
    // With only 1 doctor, we can at most fill one availability-relevant slot
    expect(nonFreiAssignments.length).toBe(1);
  });

  it('works with existing shifts in the system', () => {
    const doc: any = doctor({ id: 'doc-existing', name: 'Dr. Existing' });
    const svc: any = workplace({
      id: 'wp-svc',
      name: 'BG',
      category: 'Dienste',
      service_type: 2,
      optimal_staff: 1,
      min_staff: 1,
    });

    const result = generateSuggestions({
      weekDays: [new Date(2026, 5, 15)],
      doctors: [doc],
      workplaces: [svc],
      existingShifts: [
        makeShift({ date: '2026-06-14', position: 'BG', doctor_id: 'doc-existing' }), // yesterday
      ],
      allShifts: [
        makeShift({ date: '2026-06-14', position: 'BG', doctor_id: 'doc-existing' }),
      ],
      trainingRotations: [],
      categoriesToFill: ['Dienste'],
      systemSettings: [],
      ...defaultQualFns(),
    });

    // Should still assign since there's nothing blocking today
    const assignments = result.filter((s: any) => s.position === 'BG');
    expect(assignments.length).toBeGreaterThanOrEqual(1);
  });

  it('returns all suggestion objects with the required shape', () => {
    const doc: any = doctor({ id: 'doc-shape', name: 'Dr. Shape' });
    const svc: any = workplace({
      id: 'wp-svc',
      name: 'VG',
      category: 'Dienste',
      service_type: 1,
      optimal_staff: 1,
      min_staff: 1,
    });

    const result = generateSuggestions({
      weekDays: [new Date(2026, 5, 15)],
      doctors: [doc],
      workplaces: [svc],
      existingShifts: [],
      trainingRotations: [],
      categoriesToFill: ['Dienste'],
      systemSettings: [],
      ...defaultQualFns(),
    });

    for (const suggestion of result) {
      expect(suggestion).toHaveProperty('date');
      expect(suggestion).toHaveProperty('position');
      expect(suggestion).toHaveProperty('doctor_id');
      expect(suggestion).toHaveProperty('isPreview', true);
      expect(typeof suggestion.date).toBe('string');
      expect(typeof suggestion.position).toBe('string');
      expect(typeof suggestion.doctor_id).toBe('string');
    }
  });

  it('does not mutate the input doctors array', () => {
    const docs = [doctor({ id: 'doc-1', name: 'Dr. A' })];
    const svc: any = workplace({ id: 'wp-svc', name: 'BG', category: 'Dienste', service_type: 2 });

    const originalLength = docs.length;
    generateSuggestions({
      weekDays: [new Date(2026, 5, 15)],
      doctors: docs,
      workplaces: [svc],
      existingShifts: [],
      trainingRotations: [],
      categoriesToFill: ['Dienste'],
      systemSettings: [],
      ...defaultQualFns(),
    });

    expect(docs).toHaveLength(originalLength);
  });

  it('handles public holidays correctly (treated as Sunday for active_days)', () => {
    const doc: any = doctor({ id: 'doc-1', name: 'Dr. Alpha' });
    const svc: any = workplace({
      id: 'wp-svc',
      name: 'BG',
      category: 'Dienste',
      service_type: 2,
      optimal_staff: 1,
      min_staff: 1,
      active_days: [1, 2, 3, 4, 5], // weekdays only, Sunday=0 not included
    });

    // A public holiday on a Wednesday
    const result = generateSuggestions({
      weekDays: [new Date(2026, 0, 1)], // Neujahr (public holiday, Thursday)
      doctors: [doc],
      workplaces: [svc],
      existingShifts: [],
      trainingRotations: [],
      categoriesToFill: ['Dienste'],
      systemSettings: [],
      getDoctorQualIds: () => [],
      getWpRequiredQualIds: () => [],
      getWpOptionalQualIds: () => [],
      getWpExcludedQualIds: () => [],
      getWpDiscouragedQualIds: () => [],
      isPublicHoliday: () => true, // Everything is a holiday
    });

    // Since active_days doesn't include 0 (Sunday/holiday), no assignment
    const assignments = result.filter((s: any) => s.position === 'BG');
    expect(assignments).toHaveLength(0);
  });
});

describe('generateSuggestions -- debug mode', () => {
  it('attaches debug info when debug is enabled', () => {
    const debugEntries: any[] = [];
    const doc: any = doctor({ id: 'doc-1', name: 'Dr. Debug' });
    const svc: any = workplace({
      id: 'wp-svc', name: 'BG', category: 'Dienste', service_type: 2,
      optimal_staff: 1, min_staff: 1,
    });

    const result = generateSuggestions({
      weekDays: [new Date(2026, 5, 15)],
      doctors: [doc],
      workplaces: [svc],
      existingShifts: [],
      trainingRotations: [],
      categoriesToFill: ['Dienste'],
      systemSettings: [],
      debug: { enabled: true, entries: debugEntries, requestId: 'test-1' },
      ...defaultQualFns(),
    });

    // The return value should have __debug attached
    expect((result).__debug).toBeDefined();
    expect((result).__debug!.requestId).toBe('test-1');
    expect(Array.isArray((result).__debug!.entries)).toBe(true);
    expect((result).__debug!.entries.length).toBeGreaterThan(0);
    // The original debugEntries array should also have entries pushed
    expect(debugEntries.length).toBeGreaterThan(0);
  });

  it('does not attach debug info when debug is disabled', () => {
    const doc: any = doctor({ id: 'doc-1', name: 'Dr. NoDebug' });
    const svc: any = workplace({
      id: 'wp-svc', name: 'BG', category: 'Dienste', service_type: 2,
      optimal_staff: 1, min_staff: 1,
    });

    const result = generateSuggestions({
      weekDays: [new Date(2026, 5, 15)],
      doctors: [doc],
      workplaces: [svc],
      existingShifts: [],
      trainingRotations: [],
      categoriesToFill: ['Dienste'],
      systemSettings: [],
      ...defaultQualFns(),
    });

    expect((result).__debug).toBeUndefined();
  });
});
