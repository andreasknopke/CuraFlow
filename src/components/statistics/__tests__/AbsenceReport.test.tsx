// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AbsenceReport from '../AbsenceReport';

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('@/components/useHolidays', () => ({
  useHolidays: vi.fn((_year: number) => ({
    isPublicHoliday: (_date: Date) => false,
    isLoading: false,
    calculator: null,
    stateCode: 'MV',
    showSchoolHolidays: false,
    isSchoolHoliday: () => null,
  })),
}));

vi.mock('@/components/settings/TeamRoleSettings', () => ({
  useTeamRoles: vi.fn(() => ({
    statisticsExcludedRoles: [],
    rolePriority: {},
    roleNames: [],
    specialistRoles: [],
    foregroundDutyRoles: [],
    backgroundDutyRoles: [],
    isLoading: false,
    refetch: vi.fn(),
    canDoForegroundDuty: () => true,
    canDoBackgroundDuty: () => false,
    isExcludedFromStatistics: () => false,
  })),
}));

const mockDoctors = [
  {
    id: 'd1', name: 'Dr. Anna Adler', role: 'Oberarzt', initials: null, color: null,
    email: null, google_email: null, fte: 1, target_weekly_hours: 40,
    contract_end_date: null, exclude_from_staffing_plan: false,
    receive_email_notifications: false, central_employee_id: null,
    work_time_model_id: null, part_time_model: null, order: 0, is_active: true,
    created_date: '2026-01-01T00:00:00.000Z', updated_date: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'd2', name: 'Dr. Ben Bauer', role: 'Assistenzarzt', initials: null, color: null,
    email: null, google_email: null, fte: 1, target_weekly_hours: 40,
    contract_end_date: null, exclude_from_staffing_plan: false,
    receive_email_notifications: false, central_employee_id: null,
    work_time_model_id: null, part_time_model: null, order: 0, is_active: true,
    created_date: '2026-01-01T00:00:00.000Z', updated_date: '2026-01-01T00:00:00.000Z',
  },
];

const mockShifts = [
  {
    id: 's1', date: '2026-03-02', doctor_id: 'd1', position: 'Krank',
    order: 0, timeslot_id: null, start_time: null, end_time: null, break_minutes: null,
    is_free_text: false, free_text_value: null, isPreview: false, section: null, note: null,
    created_date: '2026-01-01T00:00:00.000Z', updated_date: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 's2', date: '2026-03-03', doctor_id: 'd1', position: 'Krank',
    order: 0, timeslot_id: null, start_time: null, end_time: null, break_minutes: null,
    is_free_text: false, free_text_value: null, isPreview: false, section: null, note: null,
    created_date: '2026-01-01T00:00:00.000Z', updated_date: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 's3', date: '2026-03-08', doctor_id: 'd2', position: 'Dienstreise',
    order: 0, timeslot_id: null, start_time: null, end_time: null, break_minutes: null,
    is_free_text: false, free_text_value: null, isPreview: false, section: null, note: null,
    created_date: '2026-01-01T00:00:00.000Z', updated_date: '2026-01-01T00:00:00.000Z',
  },
];

vi.mock('@/api/client', () => ({
  db: {
    Doctor: { list: vi.fn(() => Promise.resolve(mockDoctors)) },
    ShiftEntry: {
      filter: vi.fn(() => Promise.resolve(mockShifts)),
      list: vi.fn(() => Promise.resolve([])),
    },
  },
  api: {
    getHolidays: vi.fn(() => Promise.resolve({ school: [], public: [] })),
  },
}));

// ── Helpers ────────────────────────────────────────────────────────────────

function renderAbsenceReport() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AbsenceReport />
    </QueryClientProvider>,
  );
}

/**
 * Gets the first element matching a testid.
 * ScrollArea clones content, so multiple elements may exist.
 */
function getByTestIdOnce(id: string): HTMLElement {
  const elements = screen.getAllByTestId(id);
  return elements[0]!;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('AbsenceReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the card with title', async () => {
    renderAbsenceReport();

    const card = getByTestIdOnce('absence-report');
    expect(card).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText('Fehlzeiten')).toBeTruthy();
    });

    expect(
      screen.getByText(/Krank.*Arbeitstage.*Dienstreise.*Kalendertage/i),
    ).toBeTruthy();
  });

  it('renders summary cards with aggregated totals', async () => {
    renderAbsenceReport();

    await waitFor(() => {
      const krankCards = screen.getAllByText(/Kranktage gesamt/i);
      expect(krankCards.length).toBeGreaterThan(0);
    });

    expect(screen.getAllByText('2').length).toBeGreaterThan(0);
    expect(screen.getAllByText('1').length).toBeGreaterThan(0);
  });

  it('renders doctor rows in the table', async () => {
    renderAbsenceReport();

    await waitFor(() => {
      const table = getByTestIdOnce('absence-report-table');
      expect(table).toBeTruthy();
      expect(table.textContent).toContain('Dr. Anna Adler');
      expect(table.textContent).toContain('Dr. Ben Bauer');
    });
  });

  it('all sortable column headers are present', async () => {
    renderAbsenceReport();

    await waitFor(() => {
      const sickHeader = getByTestIdOnce('absence-report-header-sickDays');
      expect(sickHeader).toBeTruthy();
    });

    const headers = [
      'absence-report-header-name',
      'absence-report-header-role',
      'absence-report-header-sickDays',
      'absence-report-header-businessTripDays',
      'absence-report-header-totalDays',
    ];

    for (const testid of headers) {
      expect(getByTestIdOnce(testid)).toBeTruthy();
    }
  });

  it('shows deviation badges for above/below average', async () => {
    renderAbsenceReport();

    await waitFor(() => {
      const table = getByTestIdOnce('absence-report-table');
      expect(table.textContent).toContain('Dr. Anna Adler');
    });

    const table = getByTestIdOnce('absence-report-table');
    expect(table.textContent).toMatch(/\+1\.0/);
    expect(table.textContent).toMatch(/-1\.0/);
  });

  it('renders monthly trend charts when data is loaded', async () => {
    renderAbsenceReport();

    await waitFor(() => {
      const table = getByTestIdOnce('absence-report-table');
      expect(table.textContent).toContain('Dr. Anna Adler');
    });

    // Both chart panels should be visible
    const krankChart = document.querySelector('.recharts-responsive-container');
    expect(krankChart).toBeTruthy();
  });

  it('shows chart headings for Krank and Dienstreise', async () => {
    renderAbsenceReport();

    await waitFor(() => {
      const table = getByTestIdOnce('absence-report-table');
      expect(table).toBeTruthy();
    });

    // Chart headings
    const krankHeadings = screen.getAllByText(/Ø Kranktage pro Person/);
    expect(krankHeadings.length).toBeGreaterThan(0);
    const tripHeadings = screen.getAllByText(/Ø Dienstreisetage pro Person/);
    expect(tripHeadings.length).toBeGreaterThan(0);
  });

  it('does not show outlier markers when no outliers exist', async () => {
    renderAbsenceReport();

    await waitFor(() => {
      const table = getByTestIdOnce('absence-report-table');
      expect(table).toBeTruthy();
    });

    // "ohne Ausreißer" should not appear anywhere (only 2 doctors, ≤2 disables IQR)
    const outlierTexts = screen.queryAllByText(/ohne Ausreißer/);
    expect(outlierTexts.length).toBe(0);

    // No triangle alert icons should be visible
    const alerts = document.querySelectorAll('.lucide-triangle-alert');
    expect(alerts.length).toBe(0);
  });
});
