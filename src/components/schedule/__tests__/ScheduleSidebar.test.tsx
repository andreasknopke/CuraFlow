// @ts-nocheck
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@hello-pangea/dnd', () => ({
  Droppable: ({ children, droppableId }) =>
    children({
      innerRef: () => {},
      droppableProps: { 'data-droppable-id': droppableId },
      placeholder: null,
    }),
}));

vi.mock('../DraggableDoctor', () => ({
  default: ({ doctor, compactLabel, plannedHours }) => (
    <div data-testid="draggable-doctor">
      {doctor.name}:{compactLabel}:{plannedHours}
    </div>
  ),
}));

import ScheduleSidebar from '../ScheduleSidebar';

describe('ScheduleSidebar', () => {
  it('shows weekly hour summary and overplanned warnings for available staff', () => {
    const weeklyPlannedHours = new Map([
      ['doc-1', 45],
      ['doc-2', 30],
    ]);
    const workTimeModelMap = new Map([['model-1', { hours_per_week: 38.5 }]]);

    render(
      <ScheduleSidebar
        sidebarDoctors={[
          { id: 'doc-1', name: 'Dr. Alpha', role: 'Oberarzt', work_time_model_id: 'model-1' },
          { id: 'doc-2', name: 'Dr. Beta', role: 'Assistenzarzt', target_weekly_hours: 30 },
        ]}
        viewMode="week"
        isMonthView={false}
        isReadOnly={false}
        draggingDoctorId={null}
        workTimeModelMap={workTimeModelMap}
        weeklyPlannedHours={weeklyPlannedHours}
        getRoleColor={() => ({ backgroundColor: '#fff', color: '#000' })}
        getDoctorChipLabel={(doctor) => doctor.name.slice(0, 2)}
        shiftBoxSize={49}
        effectiveGridFontSize={14}
      />,
    );

    expect(screen.getByText('Verfügbares Personal')).toBeInTheDocument();
    expect(screen.getByText('Wochenstunden')).toBeInTheDocument();
    expect(screen.getByText('2 Mitarbeiter')).toBeInTheDocument();
    expect(screen.getByText('1 überplant')).toBeInTheDocument();
    expect(screen.getAllByTestId('draggable-doctor')).toHaveLength(2);
  });
});
