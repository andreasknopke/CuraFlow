# Solution Architect (Planning)

- Ticket: #92377083-89ef-4e08-9578-11f3f1c3c802 — Monatssicht berechnet soll-stunden falsch
- Stage: `planning`
- Status: `done`
- Bearbeiter: Architect-Bot (ai)
- Provider/Modell: `deepseek` / `deepseek-v4-pro`
- Gestartet: 2026-07-14 11:27:14
- Beendet: 2026-07-14 11:29:34
- Dauer: 412 ms

## Bericht

> System: CuraFlow (ID 1) · Repo: andreasknopke/CuraFlow

**Zusammenfassung:** Korrigiere die monatliche Soll-Stunden-Berechnung im StaffingPlanTable, sodass statt des wöchentlichen Werts eine zum Monat passende kumulierte Summe verwendet wird.

**Aufgabe:**
Passe die Logik in StaffingPlanTable.tsx an: Ersetze die Anzeige der wöchentlichen Zielstunden durch einen monatlichen Gesamtwert. Ermittle die Anzahl der Wochen im angezeigten Monat (anhand der Komponenten-Props für Jahr/Monat) und multipliziere damit die wöchentlichen Zielstunden. Verwende das Ergebnis als neuen 'Soll-Stunden'-Wert in der Tabellenzeile.

**Change-Kind:** `extend`

**Allowed Files:**
- `src/components/staff/StaffingPlanTable.tsx`

**Schritte:**
1. **Monatliche Soll-Stunden berechnen**
   - Identifiziere in StaffingPlanTable.tsx die Stelle, an der die Zielstunden pro Mitarbeiter für die Tabellenansicht gesetzt werden. Berechne die Anzahl der Wochen im Monat (z.B. aus Start- und Enddatum des Monats) und multipliziere die wöchentlichen Zielstunden mit diesem Faktor. Setze den so ermittelten Wert anstelle des bisherigen wöchentlichen Werts ein.
   - Dateien: src/components/staff/StaffingPlanTable.tsx

**Constraints:**
- Ändere keine anderen Komponenten oder Utilities.
- Erhalte die bestehende Summierung der geplanten Stunden unverändert.
- Stelle sicher, dass die wöchentliche Berechnung in staffingUtils.ts unangetastet bleibt.

**Symbols to preserve:**
- `src/components/staff/StaffingPlanTable.tsx` :: `StaffingPlanTable`

**Risiken:**
- Falls StaffingPlanTable in anderen Ansichten (z.B. wöchentlich) verwendet wird, könnte die Änderung unbeabsichtigte Seiteneffekte haben. Stelle sicher, dass die Monatslogik nur greift, wenn die Ansicht tatsächlich monatsscharf ist.

**Aufwand:** S

**Verifizierte Fakten (Architect-Tools):**
- WorkingTimeReport.tsx is imported in Statistics.tsx, likely handles working time stats
- staffingUtils.ts has calculateWeeklyTargetHours function
- Monthly totals exist in StaffingPlanTable.tsx, possibly related to monthly aggregation

_Basierend auf 6 Tool-Call(s)._

## Architect-Tool-Trace

**Verifizierte Fakten:**
- WorkingTimeReport.tsx is imported in Statistics.tsx, likely handles working time stats
- staffingUtils.ts has calculateWeeklyTargetHours function
- Monthly totals exist in StaffingPlanTable.tsx, possibly related to monthly aggregation

**Tool-Calls (6):**

### #1 — `grep`
_Identify where monthly target hours are displayed. Search for 'Soll' or 'monthly' in the frontend to find the component._

Args:
```json
{
  "pattern": "Soll|monthly|month",
  "glob": "src/**/*.{ts,tsx}"
}
```
Result (gekuerzt):
```
src/components/staff/StaffingPlanTable.tsx:1: [code-search] // --- Calculations --- const monthlyTotals = useMemo(() => { const totals = Array(12).fill(0);
src/components/staff/StaffingPlanTable.tsx:1: [code-search] const yearlyAverageTotal = monthlyTotals.reduce((a, b) => a + b, 0) / 12;
src/components/ui/calendar.tsx:1: [code-search] className={cn("p-3", className)} classNames={{ months: "flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0", month: "space-y-4", caption: "flex justify-center pt-1 relative items-center", caption_label: "text-sm font-medium", nav…
src/master/pages/MasterDashboard.tsx:1: [code-search] path: '/zeiterfassung', icon: Clock, title: 'Zeiterfassung', description: 'Soll/Ist-Vergleich, Überstunden-Salden und Monatsabschlüsse', color: 'bg-blue-50 text-blue-600', }, ];
src/master/pages/MasterPPUGV.tsx:1: [code-search] ausfall_soll_1: number; ausfall_soll_2: number; ausfall_soll_3: number;
src/master/pages/MasterPPUGV.tsx:1: [code-search] ist: tag.reduce((s: number, r: PPBVRow) => s + Number(r.fachkraefte_ist || 0), 0) / Math.max(tag.length, 1), sollNacht: nacht.reduce((s: number, r: PPBVRow) => s + Number(r.fachkraefte_soll || 0), 0) / Math.max(nacht.length, 1), istNacht: n…
src/master/pages/MasterTimeTracking.tsx:1: [code-search] <p className="text-slate-500 mt-1"> Manuelle Zeiterfassung und Soll/Ist-Vergleich über alle Mandanten </p>
src/master/pages/MasterTimeTracking.tsx:1: [code-search] <StatCard label="Mitarbeiter" value={summary.staffCou
```

### #2 — `grep`
_I need to locate the component that displays 'Soll-Stunden' (target hours) for a monthly view. The prompt suggests a weekly value is incorrectly used. I'll grep for 'Soll-Stunden' to find occurrences and then read the relevant component._

Args:
```json
{
  "pattern": "Soll-Stunden",
  "glob": "src/**/*.{ts,tsx}"
}
```
Result (gekuerzt):
```
src/components/staff/DoctorForm.tsx:1: [code-search] </Label> <p className="text-xs text-slate-500 -mt-1"> Daten aus der zentralen Mitarbeiterverwaltung übernehmen. Bei Auswahl werden Name, E-Mail, Soll-Stunden und Funktion automatisch ausgefüllt. </p> {/* Kostenstellen-Filter, wenn der Manda…
src/master/pages/MasterTimeTracking.tsx:1: [code-search] {summary && ( <div className="grid grid-cols-1 md:grid-cols-4 gap-4"> <StatCard label="Mitarbeiter" value={summary.staffCount} /> <StatCard label="Soll-Stunden" value={`${summary.totalTargetHours}h`} color="blue" /> <StatCard label="Ist-Stu…
```

### #3 — `grep`
_We need to identify the component that displays monthly target hours, currently incorrectly showing weekly values. 'Soll-Stunden' appears in MasterTimeTracking, but that's master-level. Could also be in schedule or statistics. Let's grep for 'targetHours' to locate the calculation logic._

Args:
```json
{
  "pattern": "targetHours",
  "glob": "src/**/*.{ts,tsx}"
}
```
Result (gekuerzt):
```
src/master/pages/MasterTimeTracking.tsx:1: [code-search] {entries.map((entry, i) => { const delta = (entry.actualHours - entry.targetHours).toFixed(1); const deltaNum = parseFloat(delta);
src/master/pages/MasterTimeTracking.tsx:1: [code-search] <TableCell className="text-slate-500 text-sm">{entry.role}</TableCell> <TableCell className="text-right">{entry.targetHours}</TableCell> <TableCell className="text-right font-semibold">{entry.actualHours}</TableCell>
src/components/schedule/staffingUtils.ts:1: [code-search] * @param workDaysPerWeek - Number of working days per week (default: 5) * @returns Adjusted target weekly hours */ export function calculateWeeklyTargetHours( fte: number, weekStart: Date, holidays: string[] = [],
src/types/master.ts:1: [code-search] role?: string | null; targetHours: number; actualHours: number;
src/types/master.ts:1: [code-search] staffCount: number; totalTargetHours: number; totalActualHours: number;
src/components/schedule/__tests__/staffingUtils.test.ts:1: [code-search] isDoctorAvailable, calculateWeeklyTargetHours, getAvailabilityBlockingDoctorIdsByDate,
src/components/schedule/__tests__/staffingUtils.test.ts:1: [code-search] // --------------------------------------------------------------------------- // calculateWeeklyTargetHours // ---------------------------------------------------------------------------
```

### #4 — `read_file`
_The prompt mentions 'monthly view' incorrectly showing weekly target hours. Likely in working time report. Let's examine WorkingTimeReport.tsx to see how target hours are calculated and displayed._

Args:
```json
{
  "path": "src/components/statistics/WorkingTimeReport.tsx",
  "start_line": 1,
  "end_line": 100
}
```
Result (gekuerzt):
```
# src/components/statistics/WorkingTimeReport.tsx (Zeilen 1-100)
    1: import { useState, useMemo } from 'react';
    2: import { useQuery } from '@tanstack/react-query';
    3: import { db } from "@/api/client";
    4: import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear, parseISO, isWithinInterval } from 'date-fns';
    5: import { de } from 'date-fns/locale';
    6: import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
    7: import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
    8: import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
    9: import { ScrollArea } from "@/components/ui/scroll-area";
   10: import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
   11: import { Badge } from "@/components/ui/badge";
   12: import { Clock, Info } from "lucide-react";
   13: import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
   14: import { timeToMinutes } from '@/utils/timeslotUtils';
   15: import { isNonWorkingShiftPosition } from '@/utils/shiftPositionUtils';
   16: import { useTeamRoles } from '@/components/settings/TeamRoleSettings';
   17: import type { Doctor, ShiftEntry, Workplace, WorkplaceTimeslot } from '@/types';
   18: 
   19: interface DoctorWorkStats {
   20:     doctor: Doctor;
   21:     totalMinutes: number;
   22:   
```

### #5 — `read_file`
_Need to find the component responsible for calculating monthly target hours; likely Statistics.tsx contains monthly view. Will read Statistics.tsx to check for target hours logic._

Args:
```json
{
  "path": "src/pages/Statistics.tsx",
  "start_line": 1,
  "end_line": 200
}
```
Result (gekuerzt):
```
# src/pages/Statistics.tsx (Zeilen 1-200)
    1: import { useState, useMemo } from 'react';
    2: import { useQuery } from '@tanstack/react-query';
    3: import { db } from "@/api/client";
    4: import { useAuth } from '@/components/AuthProvider';
    5: import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
    6: import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
    7: import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
    8: import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
    9: import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
   10: import { ScrollArea } from "@/components/ui/scroll-area";
   11: import { Download, Loader2, BarChart3, Table as TableIcon, User, Clock } from "lucide-react";
   12: import { Button } from "@/components/ui/button";
   13: import ChartCard from "@/components/statistics/ChartCard";
   14: import WishFulfillmentReport from "@/components/statistics/WishFulfillmentReport";
   15: import ComplianceReport from "@/components/statistics/ComplianceReport";
   16: import WorkingTimeReport from "@/components/statistics/WorkingTimeReport";
   17: import { useToast } from '@/components/ui/use-toast';
   18: import { exportStatisticsCsv, exportStatisticsExcel, exportStatisticsPdf } from '@/components/statistics/export
```

### #6 — `grep`
_I need to find the component that displays monthly 'Soll-Stunden' incorrectly. Grep for 'Soll-Stunden' in the main src/ to locate the tenant-level view, excluding master pages._

Args:
```json
{
  "pattern": "Soll-Stunden",
  "glob": "src/**/*.{ts,tsx}",
  "exclude": "src/master/"
}
```
Result (gekuerzt):
```
src/components/staff/DoctorForm.tsx:1: [code-search] </Label> <p className="text-xs text-slate-500 -mt-1"> Daten aus der zentralen Mitarbeiterverwaltung übernehmen. Bei Auswahl werden Name, E-Mail, Soll-Stunden und Funktion automatisch ausgefüllt. </p> {/* Kostenstellen-Filter, wenn der Manda…
src/master/pages/MasterTimeTracking.tsx:1: [code-search] {summary && ( <div className="grid grid-cols-1 md:grid-cols-4 gap-4"> <StatCard label="Mitarbeiter" value={summary.staffCount} /> <StatCard label="Soll-Stunden" value={`${summary.totalTargetHours}h`} color="blue" /> <StatCard label="Ist-Stu…
```

_Tokens: prompt=47711, completion=2789_

## Vollstaendiges Output-Payload

```json
{
  "summary": "Korrigiere die monatliche Soll-Stunden-Berechnung im StaffingPlanTable, sodass statt des wöchentlichen Werts eine zum Monat passende kumulierte Summe verwendet wird.",
  "task": "Passe die Logik in StaffingPlanTable.tsx an: Ersetze die Anzeige der wöchentlichen Zielstunden durch einen monatlichen Gesamtwert. Ermittle die Anzahl der Wochen im angezeigten Monat (anhand der Komponenten-Props für Jahr/Monat) und multipliziere damit die wöchentlichen Zielstunden. Verwende das Ergebnis als neuen 'Soll-Stunden'-Wert in der Tabellenzeile.",
  "affected_areas": [
    "src/components/staff/StaffingPlanTable.tsx"
  ],
  "allowed_files": [
    "src/components/staff/StaffingPlanTable.tsx"
  ],
  "change_kind": "extend",
  "steps": [
    {
      "title": "Monatliche Soll-Stunden berechnen",
      "details": "Identifiziere in StaffingPlanTable.tsx die Stelle, an der die Zielstunden pro Mitarbeiter für die Tabellenansicht gesetzt werden. Berechne die Anzahl der Wochen im Monat (z.B. aus Start- und Enddatum des Monats) und multipliziere die wöchentlichen Zielstunden mit diesem Faktor. Setze den so ermittelten Wert anstelle des bisherigen wöchentlichen Werts ein.",
      "files": [
        "src/components/staff/StaffingPlanTable.tsx"
      ]
    }
  ],
  "symbols_to_preserve": [
    {
      "path": "src/components/staff/StaffingPlanTable.tsx",
      "symbol": "StaffingPlanTable"
    }
  ],
  "constraints": [
    "Ändere keine anderen Komponenten oder Utilities.",
    "Erhalte die bestehende Summierung der geplanten Stunden unverändert.",
    "Stelle sicher, dass die wöchentliche Berechnung in staffingUtils.ts unangetastet bleibt."
  ],
  "risks": [
    "Falls StaffingPlanTable in anderen Ansichten (z.B. wöchentlich) verwendet wird, könnte die Änderung unbeabsichtigte Seiteneffekte haben. Stelle sicher, dass die Monatslogik nur greift, wenn die Ansicht tatsächlich monatsscharf ist."
  ],
  "estimated_effort": "S",
  "open_questions": [],
  "architect_explore": {
    "findings": [
      "WorkingTimeReport.tsx is imported in Statistics.tsx, likely handles working time stats",
      "staffingUtils.ts has calculateWeeklyTargetHours function",
      "Monthly totals exist in StaffingPlanTable.tsx, possibly related to monthly aggregation"
    ],
    "non_existent": [],
    "consistency_violations": [],
    "tree_validation_warnings": [],
    "evidence_probe": {
      "required": false,
      "found": false,
      "terms": [],
      "paths": [],
      "findings": [],
      "trace": []
    },
    "evidence_violations": [],
    "tool_calls": [
      {
        "iteration": 1,
        "thought": "Identify where monthly target hours are displayed. Search for 'Soll' or 'monthly' in the frontend to find the component.",
        "tool": "grep",
        "args": {
          "pattern": "Soll|monthly|month",
          "glob": "src/**/*.{ts,tsx}"
        },
        "result": "src/components/staff/StaffingPlanTable.tsx:1: [code-search] // --- Calculations --- const monthlyTotals = useMemo(() => { const totals = Array(12).fill(0);\nsrc/components/staff/StaffingPlanTable.tsx:1: [code-search] const yearlyAverageTotal = monthlyTotals.reduce((a, b) => a + b, 0) / 12;\nsrc/components/ui/calendar.tsx:1: [code-search] className={cn(\"p-3\", className)} classNames={{ months: \"flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0\", month: \"space-y-4\", caption: \"flex justify-center pt-1 relative items-center\", caption_label: \"text-sm font-medium\", nav…\nsrc/master/pages/MasterDashboard.tsx:1: [code-search] path: '/zeiterfassung', icon: Clock, title: 'Zeiterfassung', description: 'Soll/Ist-Vergleich, Überstunden-Salden und Monatsabschlüsse', color: 'bg-blue-50 text-blue-600', }, ];\nsrc/master/pages/MasterPPUGV.tsx:1: [code-search] ausfall_soll_1: number; ausfall_soll_2: number; ausfall_soll_3: number;\nsrc/master/pages/MasterPPUGV.tsx:1: [code-search] ist: tag.reduce((s: number, r: PPBVRow) => s + Number(r.fachkraefte_ist || 0), 0) / Math.max(tag.length, 1), sollNacht: nacht.reduce((s: number, r: PPBVRow) => s + Number(r.fachkraefte_soll || 0), 0) / Math.max(nacht.length, 1), istNacht: n…\nsrc/master/pages/MasterTimeTracking.tsx:1: [code-search] <p className=\"text-slate-500 mt-1\"> Manuelle Zeiterfassung und Soll/Ist-Vergleich über alle Mandanten </p>\nsrc/master/pages/MasterTimeTracking.tsx:1: [code-search] <StatCard label=\"Mitarbeiter\" value={summary.staffCount} /> <StatCard label=\"Soll-Stunden\" value={`${summary.totalTargetHours}h`} color=\"blue\" /> <StatCard label=\"Ist-Stunden\" value={`${summary.totalActualHours}h`} color=\"emerald\" />\nsrc/pages/Statistics.tsx:1: [code-search] interface MonthlyStat { name: string;\nsrc/pages/Statistics.tsx:1: [code-search] {month === \"all\" && ( <div data-testid=\"statistics-monthly-chart\"> <ChartCard\nsrc/pages/Statistics.tsx:1: [code-search] const { data: wishes = [], isLoading: isLoadingWishes } = useQuery({ queryKey: ['wishes', year, month], enabled: isAdmin,\nsrc/pages/Statistics.tsx:1: [code-search] if (month !== \"all\" && shiftMonth !== parseInt(month)) return;\nsrc/components/schedule/staffingUtils.ts:1: [code-search] return parsedFte; } export function getMonthlyEffectiveFte(doctor: Doctor, year: number, month: number, planEntries: StaffingPlanEntry[]): number { const entry = getMonthEntry(doctor, year, month, planEntries); const value = getEntryValue(e…\nsrc/components/validation/rules/ServiceLimitsRule.ts:1: [code-search] import { ValidationRule, type RuleContext, type RuleViolation } from './ValidationRule'; /** * Checks if the doctor exceeds their monthly service limits. * Warning-only; never blocks. Only applies to Dienste-category positions. * Migrated f…\nsrc/components/training/TrainingMultiYearOverview.tsx:7: const MONTHS = Array.from({ length: 12 }, (_, monthIndex) => monthIndex);\nsrc/components/training/TrainingMultiYearOverview.tsx:65: onMonthClick?: (doctorId: string, year: number, month: number) => void;\nsrc/components/training/TrainingMultiYearOverview.tsx:110: function buildMonthTooltip({ doctorName, year, monthDate, segments, daysInMonth }: BuildMonthTooltipParams): string {\nsrc/components/training/TrainingMultiYearOverview.tsx:119: function isMonthWithinContract(monthDate: Date, contractInfo?: ContractInfo | null): boolean {\nsrc/components/training/TrainingMultiYearOverview.tsx:178: const monthCells = React.useMemo(() => {\nsrc/components/training/TrainingMultiYearOverview.tsx:181: return MONTHS.map((monthIndex) => {\nsrc/components/training/TrainingMultiYearOverview.tsx:233: const isCellInDragSelection = useCallback((cell: MonthCellData, doctorId: string, dragStart: DragCell | null, dragCurrent: DragCell | null): boolean => {\nsrc/components/training/TrainingMultiYearOverview.tsx:269: if (typeof onMonthClick === 'function') {\nsrc/components/training/TrainingMultiYearOverview.tsx:292: MONTHS.map((monthIndex) => (\nsrc/components/training/TrainingMultiYearOverview",
        "error": null
      },
      {
        "iteration": 2,
        "thought": "I need to locate the component that displays 'Soll-Stunden' (target hours) for a monthly view. The prompt suggests a weekly value is incorrectly used. I'll grep for 'Soll-Stunden' to find occurrences and then read the relevant component.",
        "tool": "grep",
        "args": {
          "pattern": "Soll-Stunden",
          "glob": "src/**/*.{ts,tsx}"
        },
        "result": "src/components/staff/DoctorForm.tsx:1: [code-search] </Label> <p className=\"text-xs text-slate-500 -mt-1\"> Daten aus der zentralen Mitarbeiterverwaltung übernehmen. Bei Auswahl werden Name, E-Mail, Soll-Stunden und Funktion automatisch ausgefüllt. </p> {/* Kostenstellen-Filter, wenn der Manda…\nsrc/master/pages/MasterTimeTracking.tsx:1: [code-search] {summary && ( <div className=\"grid grid-cols-1 md:grid-cols-4 gap-4\"> <StatCard label=\"Mitarbeiter\" value={summary.staffCount} /> <StatCard label=\"Soll-Stunden\" value={`${summary.totalTargetHours}h`} color=\"blue\" /> <StatCard label=\"Ist-Stu…",
        "error": null
      },
      {
        "iteration": 3,
        "thought": "We need to identify the component that displays monthly target hours, currently incorrectly showing weekly values. 'Soll-Stunden' appears in MasterTimeTracking, but that's master-level. Could also be in schedule or statistics. Let's grep for 'targetHours' to locate the calculation logic.",
        "tool": "grep",
        "args": {
          "pattern": "targetHours",
          "glob": "src/**/*.{ts,tsx}"
        },
        "result": "src/master/pages/MasterTimeTracking.tsx:1: [code-search] {entries.map((entry, i) => { const delta = (entry.actualHours - entry.targetHours).toFixed(1); const deltaNum = parseFloat(delta);\nsrc/master/pages/MasterTimeTracking.tsx:1: [code-search] <TableCell className=\"text-slate-500 text-sm\">{entry.role}</TableCell> <TableCell className=\"text-right\">{entry.targetHours}</TableCell> <TableCell className=\"text-right font-semibold\">{entry.actualHours}</TableCell>\nsrc/components/schedule/staffingUtils.ts:1: [code-search] * @param workDaysPerWeek - Number of working days per week (default: 5) * @returns Adjusted target weekly hours */ export function calculateWeeklyTargetHours( fte: number, weekStart: Date, holidays: string[] = [],\nsrc/types/master.ts:1: [code-search] role?: string | null; targetHours: number; actualHours: number;\nsrc/types/master.ts:1: [code-search] staffCount: number; totalTargetHours: number; totalActualHours: number;\nsrc/components/schedule/__tests__/staffingUtils.test.ts:1: [code-search] isDoctorAvailable, calculateWeeklyTargetHours, getAvailabilityBlockingDoctorIdsByDate,\nsrc/components/schedule/__tests__/staffingUtils.test.ts:1: [code-search] // --------------------------------------------------------------------------- // calculateWeeklyTargetHours // ---------------------------------------------------------------------------",
        "error": null
      },
      {
        "iteration": 4,
        "thought": "The prompt mentions 'monthly view' incorrectly showing weekly target hours. Likely in working time report. Let's examine WorkingTimeReport.tsx to see how target hours are calculated and displayed.",
        "tool": "read_file",
        "args": {
          "path": "src/components/statistics/WorkingTimeReport.tsx",
          "start_line": 1,
          "end_line": 100
        },
        "result": "# src/components/statistics/WorkingTimeReport.tsx (Zeilen 1-100)\n    1: import { useState, useMemo } from 'react';\n    2: import { useQuery } from '@tanstack/react-query';\n    3: import { db } from \"@/api/client\";\n    4: import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear, parseISO, isWithinInterval } from 'date-fns';\n    5: import { de } from 'date-fns/locale';\n    6: import { Card, CardContent, CardHeader, CardTitle, CardDescription } from \"@/components/ui/card\";\n    7: import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from \"@/components/ui/select\";\n    8: import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from \"@/components/ui/table\";\n    9: import { ScrollArea } from \"@/components/ui/scroll-area\";\n   10: import { Tabs, TabsList, TabsTrigger } from \"@/components/ui/tabs\";\n   11: import { Badge } from \"@/components/ui/badge\";\n   12: import { Clock, Info } from \"lucide-react\";\n   13: import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from \"@/components/ui/tooltip\";\n   14: import { timeToMinutes } from '@/utils/timeslotUtils';\n   15: import { isNonWorkingShiftPosition } from '@/utils/shiftPositionUtils';\n   16: import { useTeamRoles } from '@/components/settings/TeamRoleSettings';\n   17: import type { Doctor, ShiftEntry, Workplace, WorkplaceTimeslot } from '@/types';\n   18: \n   19: interface DoctorWorkStats {\n   20:     doctor: Doctor;\n   21:     totalMinutes: number;\n   22:     totalHours: string;\n   23:     totalDays: number;\n   24:     avgHoursPerDay: string;\n   25:     dailyDetails: Record<string, { minutes: number; hours: string; shifts: number }>;\n   26: }\n   27: \n   28: /**\n   29:  * Berechnet die effektive Arbeitszeit unter Berücksichtigung von Überlappungen\n   30:  * @param {Array} intervals - Array von { start: minutes, end: minutes }\n   31:  * @returns {number} Gesamtminuten ohne Überlappung\n   32:  */\n   33: function mergeTimeIntervals(intervals: { start: number; end: number }[]): number {\n   34:     if (!intervals || intervals.length === 0) return 0;\n   35:     \n   36:     // Sortiere nach Startzeit\n   37:     const sorted = [...intervals].sort((a, b) => a.start - b.start);\n   38:     \n   39:     const merged = [sorted[0]];\n   40:     \n   41:     for (let i = 1; i < sorted.length; i++) {\n   42:         const current = sorted[i];\n   43:         const last = merged[merged.length - 1];\n   44:         \n   45:         if (current.start <= last.end) {\n   46:             // Überlappung: Erweitere das letzte Intervall\n   47:             last.end = Math.max(last.end, current.end);\n   48:         } else {\n   49:             // Keine Überlappung: Neues Intervall\n   50:             merged.push(current);\n   51:         }\n   52:     }\n   53:     \n   54:     // Summiere alle Intervalle\n   55:     return merged.reduce((sum, interval) => sum + (interval.end - interval.start), 0);\n   56: }\n   57: \n   58: /**\n   59:  * Konvertiert eine Schicht in Zeitintervalle (in Minuten seit Mitternacht)\n   60:  */\n   61: function shiftToInterval(shift: ShiftEntry, timeslot: WorkplaceTimeslot | null, workplace: Workplace | null): { start: number; end: number; rawDuration: number; adjustedDuration: number } {\n   62:     const workTimePercentage = (workplace?.work_time_percentage ?? 100) / 100;\n   63:     \n   64:     if (timeslot) {\n   65:         // Timeslot-basierte Arbeitszeit\n   66:         const start = timeToMinutes(timeslot.start_time);\n   67:         let end = timeToMinutes(timeslot.end_time);\n   68:         \n   69:         // Über Mitternacht\n   70:         if (end <= start) {\n   71:             end += 24 * 60;\n   72:         }\n   73:         \n   74:         const duration = (end - start) * workTimePercentage;\n   75:         \n   76:         return {\n   77:             start,\n   78:             end: start + duration,\n   79:             rawDuration: end - start,\n   80:             adjustedDuration: duration\n   81:         };\n   82:     }\n   83",
        "error": null
      },
      {
        "iteration": 5,
        "thought": "Need to find the component responsible for calculating monthly target hours; likely Statistics.tsx contains monthly view. Will read Statistics.tsx to check for target hours logic.",
        "tool": "read_file",
        "args": {
          "path": "src/pages/Statistics.tsx",
          "start_line": 1,
          "end_line": 200
        },
        "result": "# src/pages/Statistics.tsx (Zeilen 1-200)\n    1: import { useState, useMemo } from 'react';\n    2: import { useQuery } from '@tanstack/react-query';\n    3: import { db } from \"@/api/client\";\n    4: import { useAuth } from '@/components/AuthProvider';\n    5: import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';\n    6: import { Card, CardContent, CardHeader, CardTitle, CardDescription } from \"@/components/ui/card\";\n    7: import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from \"@/components/ui/select\";\n    8: import { Tabs, TabsContent, TabsList, TabsTrigger } from \"@/components/ui/tabs\";\n    9: import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from \"@/components/ui/table\";\n   10: import { ScrollArea } from \"@/components/ui/scroll-area\";\n   11: import { Download, Loader2, BarChart3, Table as TableIcon, User, Clock } from \"lucide-react\";\n   12: import { Button } from \"@/components/ui/button\";\n   13: import ChartCard from \"@/components/statistics/ChartCard\";\n   14: import WishFulfillmentReport from \"@/components/statistics/WishFulfillmentReport\";\n   15: import ComplianceReport from \"@/components/statistics/ComplianceReport\";\n   16: import WorkingTimeReport from \"@/components/statistics/WorkingTimeReport\";\n   17: import { useToast } from '@/components/ui/use-toast';\n   18: import { exportStatisticsCsv, exportStatisticsExcel, exportStatisticsPdf } from '@/components/statistics/exportUtils';\n   19: \n   20: const COLORS: Record<string, string> = {\n   21:     // Default colors - used as fallback. Actual colors come from workplace data.\n   22:     \"CT\": \"#10b981\", // emerald-500\n   23:     \"MRT\": \"#06b6d4\", // cyan-500\n   24:     \"Angiographie\": \"#ef4444\", // red-500\n   25:     \"Sonographie\": \"#8b5cf6\", // violet-500\n   26:     \"DL/konv. Rö\": \"#64748b\", // slate-500\n   27:     \"Mammographie\": \"#ec4899\", // pink-500\n   28: };\n   29: \n   30: // Colors assigned by service_type\n   31: const SERVICE_TYPE_COLORS: Record<number, string> = {\n   32:     1: \"#3b82f6\", // blue-500 - Bereitschaftsdienst\n   33:     2: \"#6366f1\", // indigo-500 - Rufbereitschaftsdienst\n   34:     3: \"#f59e0b\", // amber-500 - Schichtdienst\n   35:     4: \"#64748b\", // slate-500 - Andere\n   36: };\n   37: \n   38: const MONTHS = [\n   39:     \"Januar\", \"Februar\", \"März\", \"April\", \"Mai\", \"Juni\", \n   40:     \"Juli\", \"August\", \"September\", \"Oktober\", \"November\", \"Dezember\"\n   41: ];\n   42: \n   43: interface DoctorStat {\n   44:   id: string;\n   45:   name: string;\n   46:   role: string;\n   47:   totalDienste: number;\n   48:   totalRotationen: number;\n   49:   breakdown: Record<string, number>;\n   50: }\n   51: \n   52: interface MonthlyStat {\n   53:   name: string;\n   54:   monthIndex: number;\n   55:   dienste: number;\n   56:   rotationen: number;\n   57: }\n   58: \n   59: export default function StatisticsPage() {\n   60:     const { user } = useAuth();\n   61:     const { toast } = useToast();\n   62:     const isAdmin = user?.role === 'admin';\n   63:     const [year, setYear] = useState(new Date().getFullYear().toString());\n   64:     const [month, setMonth] = useState(\"all\");\n   65:     const [activeTab, setActiveTab] = useState(\"overview\");\n   66: \n   67:     // 1. Fetch Data\n   68:     const { data: doctors = [], isLoading: isLoadingDocs } = useQuery({\n   69:         queryKey: ['doctors'],\n   70:         queryFn: () => db.Doctor.list(),\n   71:         enabled: isAdmin,\n   72:         select: (data) => data.sort((a, b) => (a.order || 0) - (b.order || 0)),\n   73:     });\n   74: \n   75:     const { data: workplaces = [], isLoading: isLoadingWorkplaces } = useQuery({\n   76:         queryKey: ['workplaces'],\n   77:         queryFn: () => db.Workplace.list(),\n   78:         enabled: isAdmin,\n   79:     });\n   80: \n   81:     const { data: shifts = [], isLoading: isLoadingShifts } = useQuery({\n   82:         queryKey: ['shifts', year],\n   83:         enabled: isAdmin,\n   84:         quer",
        "error": null
      },
      {
        "iteration": 6,
        "thought": "I need to find the component that displays monthly 'Soll-Stunden' incorrectly. Grep for 'Soll-Stunden' in the main src/ to locate the tenant-level view, excluding master pages.",
        "tool": "grep",
        "args": {
          "pattern": "Soll-Stunden",
          "glob": "src/**/*.{ts,tsx}",
          "exclude": "src/master/"
        },
        "result": "src/components/staff/DoctorForm.tsx:1: [code-search] </Label> <p className=\"text-xs text-slate-500 -mt-1\"> Daten aus der zentralen Mitarbeiterverwaltung übernehmen. Bei Auswahl werden Name, E-Mail, Soll-Stunden und Funktion automatisch ausgefüllt. </p> {/* Kostenstellen-Filter, wenn der Manda…\nsrc/master/pages/MasterTimeTracking.tsx:1: [code-search] {summary && ( <div className=\"grid grid-cols-1 md:grid-cols-4 gap-4\"> <StatCard label=\"Mitarbeiter\" value={summary.staffCount} /> <StatCard label=\"Soll-Stunden\" value={`${summary.totalTargetHours}h`} color=\"blue\" /> <StatCard label=\"Ist-Stu…",
        "error": null
      }
    ],
    "tokens": {
      "prompt": 47711,
      "completion": 2789
    }
  },
  "markdown": "> System: CuraFlow (ID 1) · Repo: andreasknopke/CuraFlow\n\n**Zusammenfassung:** Korrigiere die monatliche Soll-Stunden-Berechnung im StaffingPlanTable, sodass statt des wöchentlichen Werts eine zum Monat passende kumulierte Summe verwendet wird.\n\n**Aufgabe:**\nPasse die Logik in StaffingPlanTable.tsx an: Ersetze die Anzeige der wöchentlichen Zielstunden durch einen monatlichen Gesamtwert. Ermittle die Anzahl der Wochen im angezeigten Monat (anhand der Komponenten-Props für Jahr/Monat) und multipliziere damit die wöchentlichen Zielstunden. Verwende das Ergebnis als neuen 'Soll-Stunden'-Wert in der Tabellenzeile.\n\n**Change-Kind:** `extend`\n\n**Allowed Files:**\n- `src/components/staff/StaffingPlanTable.tsx`\n\n**Schritte:**\n1. **Monatliche Soll-Stunden berechnen**\n   - Identifiziere in StaffingPlanTable.tsx die Stelle, an der die Zielstunden pro Mitarbeiter für die Tabellenansicht gesetzt werden. Berechne die Anzahl der Wochen im Monat (z.B. aus Start- und Enddatum des Monats) und multipliziere die wöchentlichen Zielstunden mit diesem Faktor. Setze den so ermittelten Wert anstelle des bisherigen wöchentlichen Werts ein.\n   - Dateien: src/components/staff/StaffingPlanTable.tsx\n\n**Constraints:**\n- Ändere keine anderen Komponenten oder Utilities.\n- Erhalte die bestehende Summierung der geplanten Stunden unverändert.\n- Stelle sicher, dass die wöchentliche Berechnung in staffingUtils.ts unangetastet bleibt.\n\n**Symbols to preserve:**\n- `src/components/staff/StaffingPlanTable.tsx` :: `StaffingPlanTable`\n\n**Risiken:**\n- Falls StaffingPlanTable in anderen Ansichten (z.B. wöchentlich) verwendet wird, könnte die Änderung unbeabsichtigte Seiteneffekte haben. Stelle sicher, dass die Monatslogik nur greift, wenn die Ansicht tatsächlich monatsscharf ist.\n\n**Aufwand:** S\n\n**Verifizierte Fakten (Architect-Tools):**\n- WorkingTimeReport.tsx is imported in Statistics.tsx, likely handles working time stats\n- staffingUtils.ts has calculateWeeklyTargetHours function\n- Monthly totals exist in StaffingPlanTable.tsx, possibly related to monthly aggregation\n\n_Basierend auf 6 Tool-Call(s)._",
  "_artifacts": [
    {
      "kind": "implementation_plan",
      "filename": "implementation_plan.md",
      "content": "**Zusammenfassung:** Korrigiere die monatliche Soll-Stunden-Berechnung im StaffingPlanTable, sodass statt des wöchentlichen Werts eine zum Monat passende kumulierte Summe verwendet wird.\n\n**Aufgabe:**\nPasse die Logik in StaffingPlanTable.tsx an: Ersetze die Anzeige der wöchentlichen Zielstunden durch einen monatlichen Gesamtwert. Ermittle die Anzahl der Wochen im angezeigten Monat (anhand der Komponenten-Props für Jahr/Monat) und multipliziere damit die wöchentlichen Zielstunden. Verwende das Ergebnis als neuen 'Soll-Stunden'-Wert in der Tabellenzeile.\n\n**Change-Kind:** `extend`\n\n**Allowed Files:**\n- `src/components/staff/StaffingPlanTable.tsx`\n\n**Schritte:**\n1. **Monatliche Soll-Stunden berechnen**\n   - Identifiziere in StaffingPlanTable.tsx die Stelle, an der die Zielstunden pro Mitarbeiter für die Tabellenansicht gesetzt werden. Berechne die Anzahl der Wochen im Monat (z.B. aus Start- und Enddatum des Monats) und multipliziere die wöchentlichen Zielstunden mit diesem Faktor. Setze den so ermittelten Wert anstelle des bisherigen wöchentlichen Werts ein.\n   - Dateien: src/components/staff/StaffingPlanTable.tsx\n\n**Constraints:**\n- Ändere keine anderen Komponenten oder Utilities.\n- Erhalte die bestehende Summierung der geplanten Stunden unverändert.\n- Stelle sicher, dass die wöchentliche Berechnung in staffingUtils.ts unangetastet bleibt.\n\n**Symbols to preserve:**\n- `src/components/staff/StaffingPlanTable.tsx` :: `StaffingPlanTable`\n\n**Risiken:**\n- Falls StaffingPlanTable in anderen Ansichten (z.B. wöchentlich) verwendet wird, könnte die Änderung unbeabsichtigte Seiteneffekte haben. Stelle sicher, dass die Monatslogik nur greift, wenn die Ansicht tatsächlich monatsscharf ist.\n\n**Aufwand:** S\n\n**Verifizierte Fakten (Architect-Tools):**\n- WorkingTimeReport.tsx is imported in Statistics.tsx, likely handles working time stats\n- staffingUtils.ts has calculateWeeklyTargetHours function\n- Monthly totals exist in StaffingPlanTable.tsx, possibly related to monthly aggregation\n\n_Basierend auf 6 Tool-Call(s)._"
    }
  ]
}
```
