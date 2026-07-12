// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import RotationDemandDialog from '../RotationDemandDialog';

// Mock the API client
vi.mock('@/api/client', () => ({
  api: {
    createRotationDemand: vi.fn().mockResolvedValue({ demand: { id: 'd1' } }),
    updateRotationDemand: vi.fn().mockResolvedValue({ success: true }),
  },
}));

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

function renderWithProviders(ui) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

const baseWorkplace = {
  id: 'wp-gyn1',
  name: 'Gyn 1',
  group_id: 5,
  ward_tenant_id: 'tenant-gyn1',
  timeslots_enabled: true,
  timeslots: [
    { id: 'ts-frueh', label: 'Frühdienst', start_time: '07:00', end_time: '15:00' },
  ],
};

describe('RotationDemandDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when workplace is null (null guard)', () => {
    const { container } = renderWithProviders(
      <RotationDemandDialog open={false} onOpenChange={() => {}} workplace={null} dateStr="2026-07-01" />
    );
    // Dialog content should not render when workplace is null
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('renders create mode with title and workplace name', () => {
    renderWithProviders(
      <RotationDemandDialog
        open={true}
        onOpenChange={() => {}}
        workplace={baseWorkplace}
        dateStr="2026-07-01"
        timeslot={baseWorkplace.timeslots[0]}
        existingDemand={null}
      />
    );
    // Title heading is "Springer-Bedarf anmelden"
    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading.textContent).toContain('Springer-Bedarf anmelden');
    // Workplace name appears in the description
    expect(screen.getByText(/Gyn 1/)).toBeTruthy();
    // Submit button labeled "Bedarf anmelden"
    expect(screen.getByRole('button', { name: /Bedarf anmelden/ })).toBeTruthy();
  });

  it('shows a textarea for the optional note in create mode', () => {
    renderWithProviders(
      <RotationDemandDialog
        open={true}
        onOpenChange={() => {}}
        workplace={baseWorkplace}
        dateStr="2026-07-01"
        timeslot={baseWorkplace.timeslots[0]}
        existingDemand={null}
      />
    );
    const textarea = screen.getByRole('textbox');
    expect(textarea.tagName).toBe('TEXTAREA');
  });

  it('renders cancel mode when an open demand exists', () => {
    renderWithProviders(
      <RotationDemandDialog
        open={true}
        onOpenChange={() => {}}
        workplace={baseWorkplace}
        dateStr="2026-07-01"
        timeslot={baseWorkplace.timeslots[0]}
        existingDemand={{ id: 'd1', status: 'open', note: 'Brauchen dringend Verstärkung' }}
      />
    );
    // Title changes to "Bedarf verwalten"
    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading.textContent).toContain('Bedarf verwalten');
    // Existing note is shown (read-only)
    expect(screen.getByText(/Brauchen dringend Verstärkung/)).toBeTruthy();
    // Withdraw button present
    expect(screen.getByRole('button', { name: /Bedarf zurückziehen/ })).toBeTruthy();
  });

  it('renders fulfilled mode as read-only with info alert', () => {
    renderWithProviders(
      <RotationDemandDialog
        open={true}
        onOpenChange={() => {}}
        workplace={baseWorkplace}
        dateStr="2026-07-01"
        timeslot={baseWorkplace.timeslots[0]}
        existingDemand={{ id: 'd1', status: 'fulfilled', note: 'Erfüllt' }}
      />
    );
    // Title is "Bedarf erfüllt"
    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading.textContent).toContain('Bedarf erfüllt');
    // Info alert about already-assigned springer
    expect(screen.getByText(/bereits ein Springer eingeteilt/)).toBeTruthy();
    // Close button (not cancel)
    expect(screen.getByRole('button', { name: /Schließen/ })).toBeTruthy();
    // No "Bedarf anmelden" submit button in fulfilled mode
    expect(screen.queryByRole('button', { name: /^Bedarf anmelden$/ })).toBeNull();
  });

  it('shows timeslot label in the description', () => {
    renderWithProviders(
      <RotationDemandDialog
        open={true}
        onOpenChange={() => {}}
        workplace={baseWorkplace}
        dateStr="2026-07-01"
        timeslot={baseWorkplace.timeslots[0]}
        existingDemand={null}
      />
    );
    // The dialog description contains workplace name, date and timeslot label.
    // getAllByText because "Frühdienst" may appear in multiple places.
    const matches = screen.getAllByText(/Frühdienst/);
    expect(matches.length).toBeGreaterThan(0);
  });
});
