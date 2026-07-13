import { describe, it, expect } from 'vitest';
import { CostFunction, WEIGHTS } from '../costFunction';
import type { AssignmentContext } from '../costFunction';
import type { Doctor, Workplace } from '@/types';

// ---------------------------------------------------------------------------
// Helper builders
// ---------------------------------------------------------------------------
function makeContext(overrides: Partial<AssignmentContext> = {}): AssignmentContext {
  return {
    usedToday: new Set<string>(),
    posCount: {},
    displacementCount: {},
    rotationImpactScore: {},
    serviceAssignedToday: new Set<string>(),
    soleOccupantDoctors: new Set<string>(),
    phase: 'A',
    ...overrides,
  };
}

function makeDoctor(overrides: Partial<Doctor> = {}): Doctor {
  return {
    id: 'doc1',
    name: 'Test Doctor',
    fte: 1.0,
    exclude_from_staffing_plan: false,
    order: 0,
    is_active: true,
    created_date: '2024-01-01T00:00:00',
    updated_date: '2024-01-01T00:00:00',
    ...overrides,
  };
}

function makeWorkplace(overrides: Partial<Workplace> = {}): Workplace {
  return {
    id: 'wp1',
    name: 'CT',
    category: 'Dienste',
    allows_multiple: false,
    timeslots_enabled: false,
    default_overlap_tolerance_minutes: 0,
    work_time_percentage: 100,
    affects_availability: true,
    min_staff: 1,
    optimal_staff: 1,
    consecutive_days_mode: 'allowed',
    auto_off: false,
    order: 0,
    is_active: true,
    created_date: '2024-01-01T00:00:00',
    updated_date: '2024-01-01T00:00:00',
    ...overrides,
  };
}

function makeCf(overrides = {}) {
  return new CostFunction({
    doctors: [makeDoctor()],
    workplaces: [makeWorkplace()],
    existingShifts: [],
    suggestions: [],
    trainingRotations: [],
    getDoctorQualIds: () => [],
    getWpRequiredQualIds: () => [],
    getWpOptionalQualIds: () => [],
    getWpExcludedQualIds: () => [],
    getWpDiscouragedQualIds: () => [],
    wishes: [],
    serviceHistory: {},
    weeklyCount: {},
    foregroundPosition: undefined,
    backgroundPosition: undefined,
    foregroundPositions: new Set(),
    backgroundPositions: new Set(),
    getServiceType: () => 'other',
    limitFG: undefined,
    limitBG: undefined,
    limitWeekend: undefined,
    isPublicHoliday: () => false,
    autoFreiByDate: {},
    systemSettings: [],
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// WEIGHTS export
// ---------------------------------------------------------------------------
describe('WEIGHTS', () => {
  it('exports the cost weight constants', () => {
    expect(WEIGHTS.QUAL_EXCLUDED).toBe(Infinity);
    expect(WEIGHTS.ROT_MATCH).toBeLessThan(0); // bonus → negative
    expect(WEIGHTS.WISH_APPROVED).toBeLessThan(0); // bonus → negative
    expect(WEIGHTS.WISH_NO_SERVICE_APPROVED).toBe(Infinity);
  });
});

// ---------------------------------------------------------------------------
// Qualification cost dimension
// ---------------------------------------------------------------------------
describe('CostFunction — qualification cost', () => {
  const workplace = makeWorkplace();
  const date = '2024-03-11';

  it('returns Infinity when doctor has an excluded qualification', () => {
    const cf = makeCf({
      getWpExcludedQualIds: () => ['qual-excluded'],
      getDoctorQualIds: () => ['qual-excluded'],
    });
    expect(cf.assignmentCost('doc1', workplace, date, makeContext())).toBe(Infinity);
  });

  it('adds QUAL_MISSING_MANDATORY when doctor lacks a required qualification', () => {
    const cf = makeCf({
      getWpRequiredQualIds: () => ['qual-required'],
      getDoctorQualIds: () => [],
    });
    const cost = cf.assignmentCost('doc1', workplace, date, makeContext());
    expect(cost).toBeGreaterThanOrEqual(WEIGHTS.QUAL_MISSING_MANDATORY);
  });

  it('applies no qualification cost when doctor meets all requirements', () => {
    const cf = makeCf({
      getWpRequiredQualIds: () => ['qual-a'],
      getDoctorQualIds: () => ['qual-a'],
    });
    const cost = cf.assignmentCost('doc1', workplace, date, makeContext());
    expect(cost).toBeLessThan(WEIGHTS.QUAL_MISSING_MANDATORY);
  });

  it('applies QUAL_HAS_OPTIONAL bonus when doctor has all optional quals', () => {
    const cf = makeCf({
      getWpOptionalQualIds: () => ['qual-opt'],
      getDoctorQualIds: () => ['qual-opt'],
    });
    const cost = cf.assignmentCost('doc1', workplace, date, makeContext());
    expect(cost).toBeLessThanOrEqual(WEIGHTS.QUAL_HAS_OPTIONAL);
  });

  it('applies QUAL_MISSING_OPTIONAL when doctor lacks optional quals', () => {
    const cf = makeCf({
      getWpOptionalQualIds: () => ['qual-opt'],
      getDoctorQualIds: () => [],
    });
    const cost = cf.assignmentCost('doc1', workplace, date, makeContext());
    expect(cost).toBeGreaterThanOrEqual(WEIGHTS.QUAL_MISSING_OPTIONAL);
  });

  it('applies QUAL_DISCOURAGED when doctor has a discouraged qualification', () => {
    const cf = makeCf({
      getWpDiscouragedQualIds: () => ['qual-disc'],
      getDoctorQualIds: () => ['qual-disc'],
    });
    const baseCf = makeCf({ getDoctorQualIds: () => [] });
    const discouragedCost = cf.assignmentCost('doc1', workplace, date, makeContext());
    const baseCost = baseCf.assignmentCost('doc1', workplace, date, makeContext());
    expect(discouragedCost - baseCost).toBeGreaterThanOrEqual(WEIGHTS.QUAL_DISCOURAGED);
  });
});

// ---------------------------------------------------------------------------
// Rotation match cost dimension
// ---------------------------------------------------------------------------
describe('CostFunction — rotation match cost', () => {
  const workplace = makeWorkplace();
  const date = '2024-03-11';

  it('applies ROT_MATCH bonus when doctor is on rotation for this workplace', () => {
    const cf = makeCf({
      trainingRotations: [{
        doctor_id: 'doc1',
        modality: 'CT',
        start_date: '2024-03-01',
        end_date: '2024-03-31',
      }],
    });
    const cost = cf.assignmentCost('doc1', workplace, date, makeContext());
    // Rotation bonus is negative → cost is lower than baseline
    const baseline = makeCf().assignmentCost('doc1', workplace, date, makeContext());
    expect(cost).toBeLessThan(baseline);
  });

  it('applies ROT_ELSEWHERE penalty when doctor has rotation at a different workplace', () => {
    const cf = makeCf({
      trainingRotations: [{
        doctor_id: 'doc1',
        modality: 'MRT',
        start_date: '2024-03-01',
        end_date: '2024-03-31',
      }],
    });
    const cost = cf.assignmentCost('doc1', workplace, date, makeContext());
    const baseline = makeCf().assignmentCost('doc1', workplace, date, makeContext());
    expect(cost - baseline).toBeGreaterThanOrEqual(WEIGHTS.ROT_ELSEWHERE);
  });

  it('applies no rotation cost when doctor has no active rotation', () => {
    const cf = makeCf({ trainingRotations: [] });
    const cost = cf.assignmentCost('doc1', workplace, date, makeContext());
    // Should equal baseline (no rotation modifier)
    const baseline = makeCf().assignmentCost('doc1', workplace, date, makeContext());
    expect(cost).toBe(baseline);
  });
});

// ---------------------------------------------------------------------------
// Wish cost dimension
// ---------------------------------------------------------------------------
describe('CostFunction — wish cost', () => {
  const workplace = makeWorkplace();
  const date = '2024-03-11';

  it('returns Infinity for an approved "kein Dienst" wish', () => {
    const cf = makeCf({
      wishes: [{
        id: 'w1',
        doctor_id: 'doc1',
        date: date,
        type: 'no_service',
        priority: 'medium',
        status: 'approved',
        user_viewed: false,
        created_date: '2024-01-01T00:00:00',
        updated_date: '2024-01-01T00:00:00',
      }],
    });
    expect(cf.assignmentCost('doc1', workplace, date, makeContext())).toBe(Infinity);
  });

  it('applies WISH_APPROVED bonus for approved service wish', () => {
    const cf = makeCf({
      wishes: [{
        id: 'w2',
        doctor_id: 'doc1',
        date: date,
        type: 'service',
        position: 'CT',
        priority: 'medium',
        status: 'approved',
        user_viewed: false,
        created_date: '2024-01-01T00:00:00',
        updated_date: '2024-01-01T00:00:00',
      }],
      getServiceType: () => 'other',
    });
    const withWish = cf.assignmentCost('doc1', workplace, date, makeContext());
    const baseline = makeCf().assignmentCost('doc1', workplace, date, makeContext());
    expect(withWish).toBeLessThanOrEqual(baseline + WEIGHTS.WISH_APPROVED);
  });
});
