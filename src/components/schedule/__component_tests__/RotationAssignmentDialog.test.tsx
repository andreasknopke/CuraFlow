import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import RotationAssignmentDialog from '@/components/schedule/RotationAssignmentDialog';
import { renderWithProviders } from '@/test-utils/renderWithProviders';

const mocks = vi.hoisted(() => ({
  doctorList: vi.fn(),
  shiftFilter: vi.fn(),
  centralAbsences: vi.fn(),
}));

vi.mock('@/api/client', () => ({
  db: {
    Doctor: { list: mocks.doctorList },
    ShiftEntry: { filter: mocks.shiftFilter },
  },
  api: {
    getGroupCentralAbsences: mocks.centralAbsences,
    createRotationAssignment: vi.fn(),
    updateRotationAssignment: vi.fn(),
    deleteRotationAssignment: vi.fn(),
  },
}));

const DATE = '2026-08-05';

const DOCTORS = [
  { id: 'doc-1', name: 'Anna Meyer', role: 'Assistenzarzt', fte: 1, central_employee_id: 'employee-1' },
  { id: 'doc-2', name: 'Beate Zimmer', role: 'Oberarzt', fte: 1, central_employee_id: null },
];

function renderDialog() {
  return renderWithProviders(
    <RotationAssignmentDialog
      open
      onOpenChange={() => {}}
      workplace={{ id: 'wp-1', name: 'Gyn1', group_id: 7, canWrite: true }}
      date={DATE}
      assignment={null}
      timeslotId={null}
      defaultEmployeeId={null}
    />
  );
}

describe('RotationAssignmentDialog', () => {
  beforeEach(() => {
    mocks.doctorList.mockResolvedValue(DOCTORS);
    mocks.shiftFilter.mockResolvedValue([]);
    mocks.centralAbsences.mockResolvedValue({ absences: [] });
  });

  it('marks a doctor with a local "Nicht verfügbar" shift as not available', async () => {
    mocks.shiftFilter.mockResolvedValue([
      { doctor_id: 'doc-1', date: DATE, position: 'Nicht verfügbar' },
    ]);
    const user = userEvent.setup();

    renderDialog();

    await user.click(await screen.findByRole('combobox'));
    await screen.findByText('Anna Meyer · nicht verfügbar');
    // Der nicht betroffene Mitarbeiter bleibt ohne Suffix
    expect(screen.getByText('Beate Zimmer')).toBeInTheDocument();

    // Der Filter fragt per Gleichheit (kein $eq-Operator) am Zieldatum ab
    expect(mocks.shiftFilter).toHaveBeenCalledWith({ date: DATE });

    // Auswahl zeigt den Warnhinweis
    await user.click(screen.getByText('Anna Meyer · nicht verfügbar'));
    expect(await screen.findByText(/ist am .* als „Nicht verfügbar" eingetragen/)).toBeInTheDocument();
  });

  it('marks a doctor with a central absence as not available (via central_employee_id)', async () => {
    mocks.centralAbsences.mockResolvedValue({
      absences: [{ employee_id: 'employee-1', date: DATE, position: 'nicht verfuegbar' }],
    });
    const user = userEvent.setup();

    renderDialog();

    await user.click(await screen.findByRole('combobox'));
    await screen.findByText('Anna Meyer · nicht verfügbar');
  });

  it('does not mark doctors when no absence exists', async () => {
    const user = userEvent.setup();

    renderDialog();

    await user.click(await screen.findByRole('combobox'));
    await screen.findByText('Anna Meyer');
    expect(screen.queryByText(/· nicht verfügbar/)).toBeNull();
  });
});
