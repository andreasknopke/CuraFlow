import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { format } from 'date-fns';
import VacationOverview from '@/components/vacation/VacationOverview';
import type { Doctor, ShiftEntry } from '@/types';

/**
 * The Tisoware display rule (mirrors DoctorYearView.getShiftStatus):
 * past/today dates only show absences confirmed by Tisoware ([TISO: marker
 * in the note). Future dates always show. These tests pin that behaviour
 * for the multi-doctor overview grid and its sticky counts column.
 */

const doctor: Doctor & { vacation_days?: number } = {
  id: 'doc-1',
  name: 'Dr. Anna Adler',
  initials: 'AA',
  role: 'Facharzt',
  fte: 1,
  exclude_from_staffing_plan: false,
  order: 1,
  is_active: true,
  created_date: new Date().toISOString(),
  updated_date: new Date().toISOString(),
  vacation_days: 30,
};

function addDaysSafe(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function isWorkday(d: Date): boolean {
  const day = d.getDay();
  return day !== 0 && day !== 6;
}

/** The last `count` workdays strictly before `today`, within the same year. */
function pastWorkdays(today: Date, count: number): Date[] {
  const out: Date[] = [];
  let d = addDaysSafe(today, -1);
  while (out.length < count && d.getFullYear() === today.getFullYear()) {
    if (isWorkday(d)) out.push(d);
    d = addDaysSafe(d, -1);
  }
  return out;
}

/** The first workday strictly after `today`, within the same year. */
function futureWorkday(today: Date): Date | null {
  let d = addDaysSafe(today, 1);
  while (d.getFullYear() === today.getFullYear()) {
    if (isWorkday(d)) return d;
    d = addDaysSafe(d, 1);
  }
  return null;
}

const today = new Date();
const year = today.getFullYear();
const pastDates = pastWorkdays(today, 2); // [0] = nearest past workday, [1] = one more back
const future = futureWorkday(today);
const skip = future === null || pastDates.length < 2;

describe('VacationOverview — Tisoware display rule', () => {
  function renderOverview(shifts: ShiftEntry[]) {
    return render(
      <VacationOverview
        year={year}
        doctors={[doctor]}
        shifts={shifts}
        entitlementByDoctorId={{ 'doc-1': 30 }}
        isSchoolHoliday={() => false}
        isPublicHoliday={() => false}
        onToggle={vi.fn()}
        onRangeSelect={vi.fn()}
        monthsPerRow={12}
      />
    );
  }

  it.skipIf(skip)('shows confirmed past + future Urlaub cells, hides unconfirmed past ones', () => {
    const pastHidden = format(pastDates[0], 'yyyy-MM-dd');
    const pastShown = format(pastDates[1], 'yyyy-MM-dd');
    const futureStr = format(future!, 'yyyy-MM-dd');

    renderOverview([
      // Past, not Tisoware-confirmed → hidden.
      { id: 's-1', date: pastHidden, doctor_id: 'doc-1', position: 'Urlaub', is_free_text: false, order: 1 } as ShiftEntry,
      // Past, Tisoware-confirmed → shown.
      { id: 's-2', date: pastShown, doctor_id: 'doc-1', position: 'Urlaub', is_free_text: false, order: 1, note: '[TISO:900] match' } as ShiftEntry,
      // Future, no marker yet → shown.
      { id: 's-3', date: futureStr, doctor_id: 'doc-1', position: 'Urlaub', is_free_text: false, order: 1 } as ShiftEntry,
    ]);

    // Only the confirmed past + future cells render as "Urlaub".
    expect(screen.getAllByTitle('Urlaub')).toHaveLength(2);

    // The sticky counts column counts exactly those two countable days.
    expect(screen.getByText('/2')).toBeInTheDocument();
    expect(screen.queryByText('/3')).not.toBeInTheDocument();
  });

  it.skipIf(skip)('hides a lone unconfirmed past Urlaub and shows /0 in the counts column', () => {
    const pastHidden = format(pastDates[0], 'yyyy-MM-dd');

    renderOverview([
      { id: 's-1', date: pastHidden, doctor_id: 'doc-1', position: 'Urlaub', is_free_text: false, order: 1 } as ShiftEntry,
    ]);

    expect(screen.queryAllByTitle('Urlaub')).toHaveLength(0);
    expect(screen.getByText('/0')).toBeInTheDocument();
  });
});
