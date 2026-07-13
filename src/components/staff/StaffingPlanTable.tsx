import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db, api } from "@/api/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { StickyHorizontalScrollbar } from "@/components/ui/sticky-horizontal-scrollbar";
import { cn } from "@/lib/utils";
import { getMonthlyEffectiveFte, getStatusCodeRatioForMonth } from "@/components/schedule/staffingUtils";
import type { Doctor } from '@/types';

const FTE_CODES = ["EZ", "KO", "MS", "BV", "OU"];
const FTE_CODE_LABELS: Record<string, string> = {
    "EZ": "Elternzeit",
    "MS": "Mutterschutz",
    "KO": "Krank ohne Entgelt",
    "BV": "Beschäftigungsverbot",
    "OU": "Andere Organisationseinheit"
};
const FTE_CODE_COLORS: Record<string, { bg: string; text: string; color: string }> = {
    "EZ": { bg: "bg-orange-50", text: "text-orange-700", color: "rgb(255 247 237)" },
    "MS": { bg: "bg-pink-50", text: "text-pink-700", color: "rgb(253 242 248)" },
    "KO": { bg: "bg-red-50", text: "text-red-700", color: "rgb(254 242 242)" },
    "BV": { bg: "bg-purple-50", text: "text-purple-700", color: "rgb(250 245 255)" },
    "OU": { bg: "bg-blue-50", text: "text-blue-700", color: "rgb(239 246 255)" }
};

interface StaffingPlanInputProps {
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
    className?: string;
}

interface StaffingPlanNoteInputProps {
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
}

interface EditDialogState {
    open: boolean;
    doctorId: string | null;
    doctorName: string;
    month: number | null;
    currentValue: string;
}

interface StaffingPlanTableProps {
    doctors: Doctor[];
    isReadOnly?: boolean;
}

function getStatusColor(value: string, ratio: number): string {
    const base = FTE_CODE_COLORS[value]?.color || "rgb(241 245 249)";
    const alpha = Math.max(0.2, ratio);
    return base.replace("rgb(", "rgba(").replace(")", `, ${alpha})`);
}

// --- Sub-Components ---

const StaffingPlanInput = ({ value: initialValue, onChange, disabled, className }: StaffingPlanInputProps) => {
    // We manage local state for responsiveness
    const [value, setValue] = useState(initialValue);

    // Sync local state when the initialValue (from DB/calc) changes
    useEffect(() => {
        setValue(initialValue);
    }, [initialValue]);

    const handleBlur = () => {
        let formatted = value;
        // Try to format as number if it looks like one (and not a special code)
        // Replace comma with dot for parsing
        const normalized = String(value).replace(',', '.');
        if (value && !isNaN(parseFloat(normalized)) && !FTE_CODES.includes(value)) {
             const num = parseFloat(normalized);
             // Format to always have 2 decimals
             formatted = num.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }
        
        // Update local state if formatting changed it
        if (formatted !== value) {
            setValue(formatted);
        }
        
        // Trigger change only if value effectively changed from prop
        if (formatted !== initialValue) {
            onChange(formatted);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            (e.currentTarget as HTMLElement).blur();
        }
    };

    return (
        <Input 
            className={className}
            value={value}
            onChange={(e) => { setValue(e.target.value); }}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            disabled={disabled}
        />
    );
};

const StaffingPlanNoteInput = ({ value: initialValue, onChange, disabled }: StaffingPlanNoteInputProps) => {
    const [value, setValue] = useState(initialValue);

    useEffect(() => {
        setValue(initialValue);
    }, [initialValue]);

    const handleBlur = () => {
        if (value !== initialValue) {
            onChange(value);
        }
    };

    return (
        <Textarea
            className="h-14 text-xs resize-none border-0 bg-transparent p-1 focus-visible:ring-1 focus-visible:ring-slate-300 shadow-none"
            value={value}
            onChange={(e) => { setValue(e.target.value); }}
            onBlur={handleBlur}
            disabled={disabled}
            placeholder="Notiz..."
        />
    );
};

// --- Main Component ---

export default function StaffingPlanTable({ doctors, isReadOnly }: StaffingPlanTableProps) {
    const queryClient = useQueryClient();
    const [year, setYear] = useState(new Date().getFullYear());

    const getDoctorDisplayName = (doctor: Doctor) => {
        const name = doctor?.name;
        return typeof name === 'string' && name.trim() ? name : 'Unbenannt';
    };

    const getDoctorRoleBadge = (doctor: Doctor) => {
        const role = doctor?.role;
        if (typeof role !== 'string' || !role.trim()) {
            return '--';
        }

        return role.substring(0, 2).toUpperCase();
    };
    
    // Dialog state for cell editing
    const [editDialog, setEditDialog] = useState<EditDialogState>({
        open: false,
        doctorId: null,
        doctorName: "",
        month: null,
        currentValue: ""
    });
    const [dialogInputType, setDialogInputType] = useState<string>("number"); // "number" or "code"
    const [dialogValue, setDialogValue] = useState("");
    const [dialogCode, setDialogCode] = useState("EZ");
    const [dialogApplyMode, setDialogApplyMode] = useState<string>("single"); // "single", "following" or "range"
    const [dialogStartDate, setDialogStartDate] = useState("");
    const [dialogEndDate, setDialogEndDate] = useState("");

    // --- Data Fetching ---
    const { data: entries = [], isLoading: isLoadingEntries } = useQuery({
        queryKey: ["staffingPlanEntries", year],
        queryFn: () => db.StaffingPlanEntry.filter({ year }),
    });

    const { data: notes = [] } = useQuery({
        queryKey: ["staffingPlanNotes", year],
        queryFn: () => db.StaffingPlanNote.filter({ year }),
    });

    const { data: systemSettings = [] } = useQuery({
        queryKey: ["systemSettings"],
        queryFn: () => db.SystemSetting.list(),
    });

    const rawTarget = (systemSettings as any[]).find((s: any) => s.key === `staffing_target_${year}`)?.value || "0";
    const targetFTE = parseFloat(String(rawTarget).replace(',', '.')) || 0;

    // --- Mutations ---
    const updateEntryMutation = useMutation({
        mutationFn: async ({ doctor_id, month, value, oldValue, statusStartDay, statusEndDay }: {
            doctor_id: string;
            month: number;
            value: string;
            oldValue?: string;
            statusStartDay?: number;
            statusEndDay?: number;
        }) => {
            return api.upsertStaffing({
                doctor_id,
                year,
                month,
                value,
                old_value_check: oldValue,
                status_start_day: statusStartDay,
                status_end_day: statusEndDay,
            });
        },
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ["staffingPlanEntries", year] }),
        onError: (err: any) => {
            alert("Fehler beim Speichern: " + (err.response?.data?.message || err.message));
            // Force refresh to show current data
            queryClient.invalidateQueries({ queryKey: ["staffingPlanEntries", year] });
        }
    });

    const updateTargetMutation = useMutation({
        mutationFn: async (value: string) => {
            const key = `staffing_target_${year}`;
            const existing = (systemSettings as any[]).find((s: any) => s.key === key);
            if (existing) {
                return db.SystemSetting.update(existing.id, { value: String(value) });
            } else {
                return db.SystemSetting.create({ key, value: String(value) });
            }
        },
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ["systemSettings"] }),
    });

    const saveNoteMutation = useMutation({
        mutationFn: async ({ doctor_id, year, note }: {
            doctor_id: string;
            year: number;
            note: string;
        }) => {
            const existing = notes.find((n: any) => n.doctor_id === doctor_id && n.year === year);
            if (existing) {
                if (!note || !note.trim()) {
                    await db.StaffingPlanNote.delete(existing.id);
                    return { deleted: true };
                }
                return db.StaffingPlanNote.update(existing.id, { note });
            }
            if (!note || !note.trim()) return { skipped: true };
            return db.StaffingPlanNote.create({ doctor_id, year, note });
        },
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ["staffingPlanNotes", year] }),
        onError: (err: any) => {
            console.error("Fehler beim Speichern der Notiz:", err);
        },
    });

    // --- Helpers ---
    const formatNumber = (num: number) => {
        return num.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    const getEntryValue = (doctorId: string, month: number) => {
        const entry = entries.find((e: any) => e.doctor_id === doctorId && e.month === month);
        if (entry) {
            // Ensure DB values are formatted too if they are simple numbers like "1"
            // But avoid formatting codes like "EZ"
            const val = entry.value;
            if (!isNaN(parseFloat(val.replace(',', '.'))) && !FTE_CODES.includes(val)) {
                 const num = parseFloat(val.replace(',', '.'));
                 return formatNumber(num);
            }
            return val;
        }

        // Auto-fill logic
        const doctor = doctors.find(d => d.id === doctorId);
        if (!doctor) return "";

        // Check contract end date
        if (doctor.contract_end_date) {
            const endDate = new Date(doctor.contract_end_date);
            const monthStart = new Date(year, month - 1, 1); // month is 1-12
            
            // Reset times
            monthStart.setHours(0,0,0,0);
            endDate.setHours(0,0,0,0);

            if (monthStart > endDate) {
                return ""; 
            }
        }

        // Default to doctor's FTE (rounded to 2 decimal places)
        const parsedFte = parseFloat(String(doctor.fte));
        const defaultFte = !isNaN(parsedFte) ? Math.round(parsedFte * 100) / 100 : 1.0;
        return formatNumber(defaultFte);
    };

    const parseFTE = (doc: Doctor, month: number) => {
        if (doc && month !== undefined) {
            return getMonthlyEffectiveFte(doc, year, month, entries);
        }
        return 0;
    };

    const visibleDoctors = useMemo(() => {
        return doctors.filter(d => !d.exclude_from_staffing_plan);
    }, [doctors]);

    // --- Calculations ---
    const monthlyTotals = useMemo(() => {
        const totals = Array(12).fill(0);
        visibleDoctors.forEach(doc => {
            for (let m = 1; m <= 12; m++) {
                totals[m-1] += parseFTE(doc, m);
            }
        });
        return totals;
    }, [visibleDoctors, entries, year]); // Added year dependency as getEntryValue depends on it

    const yearlyAverageTotal = monthlyTotals.reduce((a, b) => a + b, 0) / 12;

    const handleValueChange = (doctorId: string, month: number, newValue: string, statusStartDay?: number, statusEndDay?: number) => {
        // Get current known value for optimistic check
        const entry = entries.find((e: any) => e.doctor_id === doctorId && e.month === month);
        const oldValue = entry ? entry.value : undefined; // undefined for new entries implies "expecting nothing"

        const payload: any = { doctor_id: doctorId, month, value: newValue, oldValue };
        if (statusStartDay !== undefined) payload.statusStartDay = statusStartDay;
        if (statusEndDay !== undefined) payload.statusEndDay = statusEndDay;

        updateEntryMutation.mutate(payload);
    };

    const openEditDialog = (doctorId: string, doctorName: string, month: number, currentValue: string) => {
        if (isReadOnly) return;

        // Determine if current value is a code or number
        const isCode = FTE_CODES.includes(currentValue);
        const entry = entries.find((e: any) => e.doctor_id === doctorId && e.month === month);

        setEditDialog({
            open: true,
            doctorId,
            doctorName,
            month,
            currentValue
        });
        setDialogInputType(isCode ? "code" : "number");
        setDialogValue(isCode ? "" : currentValue);
        setDialogCode(isCode ? currentValue : "EZ");
        setDialogApplyMode("single");
        const startDay = (entry)?.status_start_day || 1;
        const endDay = (entry)?.status_end_day || new Date(year, month, 0).getDate();
        setDialogStartDate(`${year}-${String(month).padStart(2, '0')}-${String(startDay).padStart(2, '0')}`);
        setDialogEndDate(`${year}-12-31`);
    };

    const handleDialogSave = async () => {
        const { doctorId, month } = editDialog;
        const valueToSave = dialogInputType === "code" ? dialogCode : dialogValue;
        const isStatusCode = dialogInputType === "code";

        // Format number value
        let formattedValue = valueToSave;
        if (dialogInputType === "number" && valueToSave) {
            const normalized = String(valueToSave).replace(',', '.');
            if (!isNaN(parseFloat(normalized))) {
                const num = parseFloat(normalized);
                formattedValue = num.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            }
        }

        let startMonth = month!;
        let endMonth = month!;
        let rangeStartDate: Date | null = null;
        let rangeEndDate: Date | null = null;

        if (dialogApplyMode === "range") {
            rangeStartDate = new Date(dialogStartDate);
            rangeEndDate = new Date(dialogEndDate);
            startMonth = rangeStartDate.getMonth() + 1;
            endMonth = rangeEndDate.getMonth() + 1;
        } else if (dialogApplyMode === "following") {
            endMonth = 12;
        }

        for (let m = startMonth; m <= endMonth; m++) {
            const daysInMonth = new Date(year, m, 0).getDate();
            let statusStartDay = undefined;
            let statusEndDay = undefined;

            if (dialogApplyMode === "range") {
                statusStartDay = m === startMonth ? rangeStartDate!.getDate() : 1;
                statusEndDay = m === endMonth ? rangeEndDate!.getDate() : daysInMonth;
            }

            handleValueChange(doctorId!, m, formattedValue, statusStartDay, statusEndDay);
        }

        setEditDialog({ ...editDialog, open: false });
    };

    // "Ges." column per doctor
    const getDoctorAverage = (doctorId: string) => {
        const doc = visibleDoctors.find(d => d.id === doctorId);
        if (!doc) return 0;
        let sum = 0;
        for (let m = 1; m <= 12; m++) {
            sum += parseFTE(doc, m);
        }
        return sum / 12;
    };

    const getNoteForDoctor = (doctorId: string) => {
        const note = notes.find((n: any) => n.doctor_id === doctorId && n.year === year);
        return note ? note.note || "" : "";
    };

    const handleNoteSave = (doctorId: string, value: string) => {
        saveNoteMutation.mutate({ doctor_id: doctorId, year, note: value });
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between bg-slate-50 p-4 rounded-lg border">
                <div className="flex items-center gap-4">
                    <h2 className="text-lg font-semibold text-slate-800">Stellenplan {year}</h2>
                    <div className="flex items-center gap-1 bg-white rounded-md border shadow-sm">
                        <Button variant="ghost" size="icon" onClick={() => { setYear(y => y - 1); }}>
                            <ChevronLeft className="w-4 h-4" />
                        </Button>
                        <span className="px-2 font-medium min-w-[4ch] text-center">{year}</span>
                        <Button variant="ghost" size="icon" onClick={() => { setYear(y => y + 1); }}>
                            <ChevronRight className="w-4 h-4" />
                        </Button>
                    </div>
                </div>
                <div className="flex items-center gap-4">
                     <div className="text-sm text-slate-500">
                         Legende: <span className="font-medium text-indigo-600">EZ</span> = Elternzeit, <span className="font-medium text-pink-600">MS</span> = Mutterschutz, <span className="font-medium text-red-600">KO</span> = Krank ohne Entgelt, <span className="font-medium text-purple-600">BV</span> = Beschäftigungsverbot, <span className="font-medium text-blue-600">OU</span> = Andere Organisationseinheit
                     </div>
                </div>
            </div>

            {isLoadingEntries ? (
                <div className="flex justify-center p-12">
                    <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
                </div>
            ) : (
                <StickyHorizontalScrollbar className="border rounded-lg bg-white shadow-sm">
                    <Table className="text-xs">
                        <TableHeader>
                            <TableRow className="bg-slate-100 hover:bg-slate-100">
                                <TableHead className="w-[200px] font-bold text-slate-700 sticky left-0 bg-slate-100 z-20 border-r">Name</TableHead>
                                <TableHead className="text-center font-bold bg-slate-200 text-slate-900 border-r w-[60px]">Ges.</TableHead>
                                {Array.from({ length: 12 }).map((_, i) => (
                                    <TableHead key={i} className="text-center font-semibold text-slate-600 w-[60px]">{i + 1}</TableHead>
                                ))}
                                <TableHead className="w-[220px] font-semibold text-slate-600 border-l">Notiz</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {visibleDoctors.map(doc => {
                                const avg = getDoctorAverage(doc.id);
                                const doctorName = getDoctorDisplayName(doc);
                                return (
                                    <TableRow key={doc.id} className="hover:bg-slate-50">
                                        <TableCell className="font-medium border-r sticky left-0 bg-white z-10">
                                            <div className="flex items-center justify-between">
                                                <span className="truncate max-w-[150px]" title={doctorName}>{doctorName}</span>
                                                <span className="text-[10px] text-slate-400 bg-slate-100 px-1 rounded">{getDoctorRoleBadge(doc)}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-center font-bold bg-slate-100/50 border-r text-slate-700">
                                            {formatNumber(avg)}
                                        </TableCell>
                                        {Array.from({ length: 12 }).map((_, i) => {
                                            const month = i + 1;
                                            const val = getEntryValue(doc.id, month);
                                            
                                            let cellBg = "";
                                            let textColor = "";
                                            let statusRatio = 0;
                                            if (FTE_CODE_COLORS[val]) {
                                                textColor = FTE_CODE_COLORS[val].text;
                                                statusRatio = getStatusCodeRatioForMonth(doc, year, month, entries);
                                                if (statusRatio === 1) {
                                                    cellBg = FTE_CODE_COLORS[val].bg;
                                                }
                                            }

                                            // Determine text color for numbers
                                            const numVal = parseFTE(doc, month);
                                            if (!isNaN(numVal) && numVal < 1 && numVal > 0) { textColor = "text-slate-500"; }
                                            if (numVal >= 1) { textColor = "text-slate-900 font-medium"; }

                                            // Determine if this value is a default (auto-filled) or explicit
                                            const entryExists = entries.some((e: any) => e.doctor_id === doc.id && e.month === month);
                                            const isDefault = !entryExists && val !== "";

                                            return (
                                                <TableCell
                                                    key={month}
                                                    className={cn(
                                                        "p-0 border-r last:border-r-0 cursor-pointer hover:bg-slate-100 transition-colors",
                                                        cellBg,
                                                        isReadOnly && "cursor-default hover:bg-transparent"
                                                    )}
                                                    style={statusRatio > 0 && statusRatio < 1 ? {
                                                        background: `linear-gradient(to top, ${getStatusColor(val, statusRatio)} 0%, ${getStatusColor(val, statusRatio)} ${Math.round(statusRatio * 100)}%, transparent ${Math.round(statusRatio * 100)}%, transparent 100%)`
                                                    } : undefined}
                                                    onClick={() => { openEditDialog(doc.id, doctorName, month, val); }}
                                                >
                                                    <div className={cn(
                                                        "h-8 w-full flex items-center justify-center text-xs",
                                                        textColor,
                                                        isDefault && "text-slate-400 italic"
                                                    )}>
                                                        {val || "-"}
                                                    </div>
                                                </TableCell>
                                            );
                                        })}
                                        <TableCell className="border-l p-1 bg-white max-w-[220px] min-w-[220px]">
                                            <StaffingPlanNoteInput
                                                value={getNoteForDoctor(doc.id)}
                                                onChange={(val) => { handleNoteSave(doc.id, val); }}
                                                disabled={isReadOnly}
                                            />
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                            
                            {/* Summary Rows */}
                            <TableRow className="bg-slate-100 font-bold border-t-2 border-slate-200">
                                <TableCell className="sticky left-0 bg-slate-100 border-r">Gesamtergebnis</TableCell>
                                <TableCell className="text-center border-r">{formatNumber(yearlyAverageTotal)}</TableCell>
                                {monthlyTotals.map((total, i) => (
                                    <TableCell key={i} className="text-center text-slate-800">
                                        {formatNumber(total)}
                                    </TableCell>
                                ))}
                                <TableCell className="border-l"></TableCell>
                            </TableRow>
                            <TableRow className="bg-slate-50 font-medium text-slate-600">
                                <TableCell className="sticky left-0 bg-slate-50 border-r">Stellenplan (Soll)</TableCell>
                                <TableCell className="text-center border-r p-0">
                                    {isReadOnly ? (
                                        <div className="flex items-center justify-center h-8 font-bold">{formatNumber(targetFTE)}</div>
                                    ) : (
                                        <StaffingPlanInput 
                                            className="h-8 w-full border-0 bg-transparent text-center text-xs px-0 focus-visible:ring-0 shadow-none font-bold"
                                            value={formatNumber(targetFTE)}
                                            onChange={(val) => { updateTargetMutation.mutate(val); }}
                                        />
                                    )}
                                </TableCell>
                                {Array.from({ length: 12 }).map((_, i) => (
                                    <TableCell key={i} className="text-center p-0">
                                        <div className="flex items-center justify-center h-8 text-slate-500">
                                            {formatNumber(targetFTE)}
                                        </div>
                                    </TableCell>
                                ))}
                                <TableCell className="border-l"></TableCell>
                            </TableRow>
                            <TableRow className={cn("font-bold border-t", yearlyAverageTotal - targetFTE < 0 ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700")}>
                                <TableCell className="sticky left-0 bg-inherit border-r">Differenz</TableCell>
                                <TableCell className="text-center border-r">
                                    {formatNumber(yearlyAverageTotal - targetFTE)}
                                </TableCell>
                                {monthlyTotals.map((total, i) => {
                                    const diff = total - targetFTE;
                                    return (
                                        <TableCell key={i} className={cn("text-center", diff < 0 ? "text-red-600" : "text-green-600")}>
                                            {formatNumber(diff)}
                                        </TableCell>
                                    );
                                })}
                                <TableCell className="border-l"></TableCell>
                            </TableRow>
                        </TableBody>
                    </Table>
                </StickyHorizontalScrollbar>
            )}

            {/* Edit Dialog */}
            <Dialog open={editDialog.open} onOpenChange={(open) => { setEditDialog({ ...editDialog, open }); }}>
                <DialogContent className="sm:max-w-md max-h-[90vh] flex flex-col p-0">
                    <DialogHeader className="px-6 pt-6">
                        <DialogTitle>
                            Stellenplan bearbeiten
                        </DialogTitle>
                        <p className="text-sm text-slate-500">
                            {editDialog.doctorName} - Monat {editDialog.month}/{year}
                        </p>
                    </DialogHeader>

                    <div className="space-y-6 py-4 px-6 overflow-y-auto">
                        {/* Input Type Selection */}
                        <div className="space-y-3">
                            <Label className="text-sm font-medium">Eingabeart</Label>
                            <RadioGroup value={dialogInputType} onValueChange={setDialogInputType} className="flex gap-4">
                                <div className="flex items-center space-x-2">
                                    <RadioGroupItem value="number" id="input-number" />
                                    <Label htmlFor="input-number" className="cursor-pointer">Zahlenwert (FTE)</Label>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <RadioGroupItem value="code" id="input-code" />
                                    <Label htmlFor="input-code" className="cursor-pointer">Statuscode</Label>
                                </div>
                            </RadioGroup>
                        </div>

                        {/* Value Input */}
                        {dialogInputType === "number" ? (
                            <div className="space-y-2">
                                <Label htmlFor="fte-value">FTE-Wert (0.00 - 1.00)</Label>
                                <Input
                                    id="fte-value"
                                    value={dialogValue}
                                    onChange={(e) => { setDialogValue(e.target.value); }}
                                    placeholder="z.B. 1,00 oder 0,50"
                                    className="text-center"
                                />
                                <p className="text-xs text-slate-500">
                                    Hinweis: 0,00 wird als "nicht verfügbar" gewertet
                                </p>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                <Label>Statuscode auswählen</Label>
                                <RadioGroup value={dialogCode} onValueChange={setDialogCode} className="grid gap-2">
                                    {FTE_CODES.map(code => (
                                        <div key={code} className="flex items-center space-x-2 border rounded-lg p-3 hover:bg-slate-50">
                                            <RadioGroupItem value={code} id={`code-${code}`} />
                                            <Label htmlFor={`code-${code}`} className="cursor-pointer flex-1">
                                                <span className={cn(
                                                    "font-bold",
                                                    code === "EZ" && "text-orange-600",
                                                    code === "MS" && "text-pink-600",
                                                    code === "KO" && "text-red-600",
                                                    code === "BV" && "text-purple-600",
                                                    code === "OU" && "text-blue-600"
                                                )}>{code}</span>
                                                <span className="text-slate-500 ml-2">– {FTE_CODE_LABELS[code]}</span>
                                            </Label>
                                        </div>
                                    ))}
                                </RadioGroup>
                                <p className="text-xs text-slate-500">
                                    EZ, MS, KO und BV werden als "nicht verfügbar" gewertet. BV (Beschäftigungsverbot) zählt dabei als besetzte Stelle mit dem letzten FTE-Wert. OU (Andere Organisationseinheit) bleibt verfügbar, zählt aber nicht als FTE.
                                </p>
                            </div>
                        )}

                        {/* Apply Mode Selection */}
                        <div className="space-y-3 border-t pt-4">
                            <Label className="text-sm font-medium">Anwenden auf</Label>
                            <RadioGroup value={dialogApplyMode} onValueChange={setDialogApplyMode} className="grid gap-2">
                                <div className="flex items-center space-x-2 border rounded-lg p-3 hover:bg-slate-50">
                                    <RadioGroupItem value="single" id="apply-single" />
                                    <Label htmlFor="apply-single" className="cursor-pointer flex-1">
                                        <span className="font-medium">Nur diesen Monat</span>
                                        <span className="text-slate-500 ml-2">({editDialog.month}/{year})</span>
                                    </Label>
                                </div>
                                <div className="flex items-center space-x-2 border rounded-lg p-3 hover:bg-slate-50">
                                    <RadioGroupItem value="following" id="apply-following" />
                                    <Label htmlFor="apply-following" className="cursor-pointer flex-1">
                                        <span className="font-medium">Alle folgenden Monate</span>
                                        <span className="text-slate-500 ml-2">({editDialog.month} - 12/{year})</span>
                                    </Label>
                                </div>
                                <div className="flex items-center space-x-2 border rounded-lg p-3 hover:bg-slate-50">
                                    <RadioGroupItem value="range" id="apply-range" />
                                    <Label htmlFor="apply-range" className="cursor-pointer flex-1">
                                        <span className="font-medium">Von – Bis</span>
                                    </Label>
                                </div>
                            </RadioGroup>
                        </div>

                        {dialogApplyMode === "range" && (
                            <div className="space-y-3 border-t pt-4">
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1">
                                        <Label className="text-xs text-slate-500">Von</Label>
                                        <Input
                                            type="date"
                                            value={dialogStartDate}
                                            onChange={(e) => { setDialogStartDate(e.target.value); }}
                                            className="text-center"
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <Label className="text-xs text-slate-500">Bis</Label>
                                        <Input
                                            type="date"
                                            value={dialogEndDate}
                                            onChange={(e) => { setDialogEndDate(e.target.value); }}
                                            className="text-center"
                                        />
                                    </div>
                                </div>
                                <p className="text-xs text-slate-500">
                                    Der Wert wird für alle betroffenen Monate anteilig gespeichert.
                                </p>
                            </div>
                        )}
                    </div>

                    <DialogFooter className="gap-2 px-6 py-4 border-t">
                        <Button variant="outline" onClick={() => { setEditDialog({ ...editDialog, open: false }); }}>
                            Abbrechen
                        </Button>
                        <Button onClick={handleDialogSave} disabled={updateEntryMutation.isPending}>
                            {updateEntryMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                            Speichern
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
