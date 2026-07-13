import { createContext, useContext } from 'react';
import type { Doctor, ShiftEntry, Workplace, WorkplaceTimeslot, WorkTimeModel, SystemSetting } from '@/types';
import type { CentralEmployee } from '@/types/master';

// ── ScheduleBoard shared-context types ─────────────────────────────
//
// This context exists to break the closure coupling between ScheduleBoard
// and its extracted sub-units (cell renderers, drag handlers). Step 1
// (this file) introduces the plumbing only — no logic moves. Subsequent
// steps populate the value and move consumers into their own modules.
//
// Every field is optional today so the provider can be introduced without
// wiring up every dependency at once. Fields become required as consumers
// are extracted and the provider fills them in.

export interface DisplayDoc {
  doctor: Doctor;
  shift?: ShiftEntry;
}

export interface ScheduleBoardContextValue {
  // Read-only flags
  isReadOnly?: boolean;

  // Core query data
  doctors?: Doctor[];
  currentWeekShifts?: ShiftEntry[];
  workplaces?: Workplace[];
  workplaceTimeslots?: WorkplaceTimeslot[];
  systemSettings?: SystemSetting[];

  // Lookup maps (computed via useMemo in the provider)
  doctorById?: Map<string, Doctor>;
  workplaceByName?: Map<string, Workplace>;
  centralEmployeesById?: Map<string, CentralEmployee>;
  workTimeModelMap?: Map<string, WorkTimeModel>;
  allDisplayDocsByDate?: Map<string, DisplayDoc[]>;

  // Display sizing
  effectiveGridFontSize?: number;
  shiftBoxSize?: number;

  // Helpers (signatures match the provider-side implementations)
  getDoctorChipLabel?: (doctor: Doctor | undefined) => string;
  getRoleColor?: (doctorId: string) => { backgroundColor: string; color: string };
}

export const ScheduleBoardContext = createContext<ScheduleBoardContextValue | null>(null);

export function useScheduleBoard(): ScheduleBoardContextValue {
  const ctx = useContext(ScheduleBoardContext);
  if (!ctx) {
    throw new Error('useScheduleBoard must be used within a ScheduleBoardContext.Provider');
  }
  return ctx;
}
