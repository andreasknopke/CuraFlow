import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import MasterAbsences from '@/master/pages/MasterAbsences';
import { renderWithProviders } from '@/test-utils/renderWithProviders';
import type { AbsenceStatsData } from '@/types/master';

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
}));

vi.mock('@/api/client', () => ({
  api: {
    request: mocks.apiRequest,
  },
}));

// ── Fixtures ───────────────────────────────────────────────────────────────

const CURRENT_YEAR = new Date().getFullYear();
const CURRENT_MONTH = String(new Date().getMonth() + 1).padStart(2, '0');

function buildStats(): AbsenceStatsData {
  const monthly = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    label: ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'][i],
    days: {
      'Urlaub': i === 0 ? 5 : 0,
      'Krank': i === 0 ? 3 : 0,
      'Frei': 0,
      'Dienstreise': i === 2 ? 2 : 0,
      'Nicht verfügbar': 0,
      'Fortbildung': 0,
      'Kongress': 0,
    },
  }));
  return {
    monthly,
    byType: {
      'Urlaub': 5,
      'Krank': 3,
      'Frei': 0,
      'Dienstreise': 2,
      'Nicht verfügbar': 0,
      'Fortbildung': 0,
      'Kongress': 0,
    },
    staffCount: 4,
  };
}

const MONTH_ENTRIES = [
  {
    tenantName: 'Notaufnahme',
    staffName: 'Mustermann, Max',
    type: 'Krank',
    date: `${CURRENT_YEAR}-${CURRENT_MONTH}-03`,
    note: null,
  },
  {
    tenantName: 'Notaufnahme',
    staffName: 'Schmidt, Anna',
    type: 'Urlaub',
    date: `${CURRENT_YEAR}-${CURRENT_MONTH}-10`,
    note: 'Sommerurlaub',
  },
];

// ── Tests ──────────────────────────────────────────────────────────────────

describe('MasterAbsences', () => {
  beforeEach(() => {
    mocks.apiRequest.mockReset();
  });

  const setupDefaultMocks = () => {
    mocks.apiRequest.mockImplementation(async (url: string) => {
      if (url === '/api/admin/db-tokens') {
        return [{ id: 'tenant-1', name: 'Notaufnahme' }];
      }
      if (url.startsWith('/api/master/absences?')) {
        return {
          entries: MONTH_ENTRIES,
          summary: { 'Urlaub': 1, 'Krank': 1, 'Frei': 0, 'Dienstreise': 0, 'Nicht verfügbar': 0, 'Fortbildung': 0, 'Kongress': 0 },
        };
      }
      if (url.startsWith('/api/master/absence-stats?')) {
        return buildStats();
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
  };

  it('renders yearly absence charts from the absence-stats endpoint', async () => {
    setupDefaultMocks();

    renderWithProviders(<MasterAbsences />, { withAuthProvider: false, withToaster: false });

    const charts = await screen.findByTestId('master-absence-charts');
    expect(within(charts).getByText(`Fehlzeiten im Jahresverlauf ${CURRENT_YEAR}`)).toBeInTheDocument();
    // Stacked bar chart + donut chart render once the stats query resolved
    expect(await within(charts).findByText(/Abwesenheitstage pro Monat/)).toBeInTheDocument();
    expect(charts.querySelectorAll('.recharts-responsive-container').length).toBeGreaterThanOrEqual(2);
    // Staff headcount badge
    expect(within(charts).getByText('4 Mitarbeitende')).toBeInTheDocument();
    // Distribution legend lists types with days
    expect(within(charts).getByText(/Verteilung nach Typ/)).toBeInTheDocument();
  });

  it('requests monthly absence entries and yearly stats for the current month by default', async () => {
    setupDefaultMocks();

    renderWithProviders(<MasterAbsences />, { withAuthProvider: false, withToaster: false });

    await waitFor(() => {
      const urls = mocks.apiRequest.mock.calls.map((c) => c[0] as string);
      expect(urls).toContain(`/api/master/absences?year=${CURRENT_YEAR}&month=${CURRENT_MONTH}`);
      expect(urls).toContain(`/api/master/absence-stats?year=${CURRENT_YEAR}`);
    });
  });

  it('lists absence entries in the detail table', async () => {
    setupDefaultMocks();

    renderWithProviders(<MasterAbsences />, { withAuthProvider: false, withToaster: false });

    expect(await screen.findByText('Mustermann, Max')).toBeInTheDocument();
    expect(screen.getByText('Schmidt, Anna')).toBeInTheDocument();
    expect(screen.getByText('Sommerurlaub')).toBeInTheDocument();
  });

  it('offers the "Ganzes Jahr" filter and drops the month param when selected', async () => {
    const user = userEvent.setup();
    setupDefaultMocks();

    renderWithProviders(<MasterAbsences />, { withAuthProvider: false, withToaster: false });
    await screen.findByTestId('master-absence-charts');

    // Third combobox = month select
    const selects = screen.getAllByRole('combobox');
    await user.click(selects[2]);

    const fullYearOption = await screen.findByRole('option', { name: 'Ganzes Jahr' });
    await user.click(fullYearOption);

    await waitFor(() => {
      const urls = mocks.apiRequest.mock.calls.map((c) => c[0] as string);
      expect(urls).toContain(`/api/master/absences?year=${CURRENT_YEAR}`);
    });

    // Table title switches to full-year label
    expect(await screen.findByText(`Fehlzeiten Gesamtjahr ${CURRENT_YEAR}`)).toBeInTheDocument();
  });

  it('shows the empty state in the charts when there is no absence data', async () => {
    mocks.apiRequest.mockImplementation(async (url: string) => {
      if (url === '/api/admin/db-tokens') return [];
      if (url.startsWith('/api/master/absences?')) return { entries: [], summary: {} };
      if (url.startsWith('/api/master/absence-stats?')) {
        return { monthly: [], byType: {}, staffCount: 0 };
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    renderWithProviders(<MasterAbsences />, { withAuthProvider: false, withToaster: false });

    const charts = await screen.findByTestId('master-absence-charts');
    expect(await within(charts).findByText('Keine Fehlzeiten im ausgewählten Zeitraum.')).toBeInTheDocument();
  });
});
