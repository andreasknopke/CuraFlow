import React, { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, db, base44 } from "@/api/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const FTE_CODES = ["EZ", "KO", "MS"];
const FTE_CODE_LABELS = {
    "EZ": "Elternzeit",
    "MS": "Mutterschutz", 
    "KO": "Krank ohne Entgelt"
};

// --- Sub-Components ---

const StaffingPlanInput = ({ value: initialValue, onChange, disabled, className }) => {
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

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') {
            e.target.blur();
        }
    };

    return (
        <Input 
            className={className}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            disabled={disabled}
        />
    );
};

// --- Main Component ---

export default function StaffingPlanTable({ doctors, isReadOnly }) {
    const queryClient = useQueryClient();
    const [year, setYear] = useState(new Date().getFullYear());
    
    // Dialog state for cell editing
    const [editDialog, setEditDialog] = useState({
        open: false,
        doctorId: null,
        doctorName: "",
        month: null,
        currentValue: ""
    });
    const [dialogInputType, setDialogInputType] = useState("number"); // "number" or "code"
    const [dialogValue, setDialogValue] = useState("");
    const [dialogCode, setDialogCode] = useState("EZ");
    const [dialogApplyMode, setDialogApplyMode] = useState("single"); // "single" or "following"

    // --- Data Fetching ---
    const { data: entries = [], isLoading: isLoadingEntries } = useQuery({
        queryKey: ["staffingPlanEntries", year],
        queryFn: () => db.StaffingPlanEntry.filter({ year }),
    });

    const { data: systemSettings = [] } = useQuery({
        queryKey: ["systemSettings"],
        queryFn: () => db.SystemSetting.list(),
    });

    const rawTarget = systemSettings.find(s => s.key === `staffing_target_${year}`)?.value || "0";
    const targetFTE = parseFloat(rawTarget.replace(',', '.'));

    // --- Mutations ---
    const updateEntryMutation = useMutation({
        mutationFn: async ({ doctor_id, month, value, oldValue }) => {
            // Use atomic backend function
            const response = await base44.functions.invoke('atomicOperations', {
                operation: 'upsertStaffing',
                data: {
                    doctor_id,
                    year,
                    month,
                    value,
                    old_value_check: oldValue
                }
            });
            return response.data;
        },
        onSuccess: () => queryClient.invalidateQueries(["staffingPlanEntries", year]),
        onError: (err) => {
            alert("Fehler beim Speichern: " + (err.response?.data?.message || err.message));
            // Force refresh to show current data
            queryClient.invalidateQueries(["staffingPlanEntries", year]);
        }
    });

    const updateTargetMutation = useMutation({
        mutationFn: async (value) => {
            const key = `staffing_target_${year}`;
            const existing = systemSettings.find(s => s.key === key);
            if (existing) {
                return db.SystemSetting.update(existing.id, { value: String(value) });
            } else {
                return db.SystemSetting.create({ key, value: String(value) });
            }
        },
        onSuccess: () => queryClient.invalidateQueries(["systemSettings"]),
    });

    // --- Helpers ---
    const formatNumber = (num) => {
        return num.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    const getEntryValue = (doctorId, month) => {
        const entry = entries.find(e => e.doctor_id === doctorId && e.month === month);
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

        // Default to doctor's FTE
        const defaultFte = doctor.fte !== undefined ? doctor.fte : 1.0;
        return formatNumber(defaultFte);
    };

    const parseFTE = (val) => {
        if (!val) return 0;
        if (FTE_CODES.includes(val)) return 0; 
        const num = parseFloat(String(val).replace(',', '.'));
        return isNaN(num) ? 0 : num;
    };

    const visibleDoctors = useMemo(() => {
        return doctors.filter(d => !d.exclude_from_staffing_plan);
    }, [doctors]);

    // --- Calculations ---
    const monthlyTotals = useMemo(() => {
        const totals = Array(12).fill(0);
        visibleDoctors.forEach(doc => {
            for (let m = 1; m <= 12; m++) {
                const val = getEntryValue(doc.id, m);
                totals[m-1] += parseFTE(val);
            }
        });
        return totals;
    }, [visibleDoctors, entries, year]); // Added year dependency as getEntryValue depends on it

    const yearlyAverageTotal = monthlyTotals.reduce((a, b) => a + b, 0) / 12;

    const handleValueChange = (doctorId, month, newValue) => {
        // Get current known value for optimistic check
        const entry = entries.find(e => e.doctor_id === doctorId && e.month === month);
        const oldValue = entry ? entry.value : undefined; // undefined for new entries implies "expecting nothing"

        updateEntryMutation.mutate({ doctor_id: doctorId, month, value: newValue, oldValue });
    };

    const openEditDialog = (doctorId, doctorName, month, currentValue) => {
        if (isReadOnly) return;
        
        // Determine if current value is a code or number
        const isCode = FTE_CODES.includes(currentValue);
        
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
    };

    const handleDialogSave = async () => {
        const { doctorId, month } = editDialog;
        const valueToSave = dialogInputType === "code" ? dialogCode : dialogValue;
        
        // Format number value
        let formattedValue = valueToSave;
        if (dialogInputType === "number" && valueToSave) {
            const normalized = String(valueToSave).replace(',', '.');
            if (!isNaN(parseFloat(normalized))) {
                const num = parseFloat(normalized);
                formattedValue = num.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            }
        }
        
        if (dialogApplyMode === "single") {
            // Apply only to this cell
            handleValueChange(doctorId, month, formattedValue);
        } else {
            // Apply to this month and all following months until December
            for (let m = month; m <= 12; m++) {
                handleValueChange(doctorId, m, formattedValue);
            }
        }
        
        setEditDialog({ ...editDialog, open: false });
    };

    // "Ges." column per doctor
    const getDoctorAverage = (doctorId) => {
        let sum = 0;
        for (let m = 1; m <= 12; m++) {
            const val = getEntryValue(doctorId, m);
            if (val && !FTE_CODES.includes(val)) {
                sum += parseFTE(val);
            }
            // Treat codes/empty as 0 for sum, divide by 12
        }
        return sum / 12;
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between bg-slate-50 p-4 rounded-lg border">
                <div className="flex items-center gap-4">
                    <h2 className="text-lg font-semibold text-slate-800">Stellenplan {year}</h2>
                    <div className="flex items-center gap-1 bg-white rounded-md border shadow-sm">
                        <Button variant="ghost" size="icon" onClick={() => setYear(y => y - 1)}>
                            <ChevronLeft className="w-4 h-4" />
                        </Button>
                        <span className="px-2 font-medium min-w-[4ch] text-center">{year}</span>
                        <Button variant="ghost" size="icon" onClick={() => setYear(y => y + 1)}>
                            <ChevronRight className="w-4 h-4" />
                        </Button>
                    </div>
                </div>
                <div className="flex items-center gap-4">
                     <div className="text-sm text-slate-500">
                         Legende: <span className="font-medium text-indigo-600">EZ</span> = Elternzeit, <span className="font-medium text-pink-600">MS</span> = Mutterschutz, <span className="font-medium text-red-600">KO</span> = Krank ohne Entgelt
                     </div>
                </div>
            </div>

            {isLoadingEntries ? (
                <div className="flex justify-center p-12">
                    <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
                </div>
            ) : (
                <div className="border rounded-lg overflow-x-auto bg-white shadow-sm">
                    <Table className="text-xs">
                        <TableHeader>
                            <TableRow className="bg-slate-100 hover:bg-slate-100">
                                <TableHead className="w-[200px] font-bold text-slate-700 sticky left-0 bg-slate-100 z-20 border-r">Name</TableHead>
                                <TableHead className="text-center font-bold bg-slate-200 text-slate-900 border-r w-[60px]">Ges.</TableHead>
                                {Array.from({ length: 12 }).map((_, i) => (
                                    <TableHead key={i} className="text-center font-semibold text-slate-600 w-[60px]">{i + 1}</TableHead>
                                ))}
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {visibleDoctors.map(doc => {
                                const avg = getDoctorAverage(doc.id);
                                return (
                                    <TableRow key={doc.id} className="hover:bg-slate-50">
                                        <TableCell className="font-medium border-r sticky left-0 bg-white z-10">
                                            <div className="flex items-center justify-between">
                                                <span className="truncate max-w-[150px]" title={doc.name}>{doc.name}</span>
                                                <span className="text-[10px] text-slate-400 bg-slate-100 px-1 rounded">{doc.role.substring(0, 2).toUpperCase()}</span>
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
                                            if (val === "EZ") { cellBg = "bg-orange-50"; textColor = "text-orange-700"; }
                                            if (val === "MS") { cellBg = "bg-pink-50"; textColor = "text-pink-700"; }
                                            if (val === "KO") { cellBg = "bg-red-50"; textColor = "text-red-700"; }
                                            
                                            // Determine text color for numbers
                                            const numVal = parseFTE(val);
                                            if (!isNaN(numVal) && numVal < 1 && numVal > 0) { textColor = "text-slate-500"; }
                                            if (numVal >= 1) { textColor = "text-slate-900 font-medium"; }

                                            // Determine if this value is a default (auto-filled) or explicit
                                            const entryExists = entries.some(e => e.doctor_id === doc.id && e.month === month);
                                            const isDefault = !entryExists && val !== "";

                                            return (
                                                <TableCell 
                                                    key={month} 
                                                    className={cn(
                                                        "p-0 border-r last:border-r-0 cursor-pointer hover:bg-slate-100 transition-colors", 
                                                        cellBg,
                                                        isReadOnly && "cursor-default hover:bg-transparent"
                                                    )}
                                                    onClick={() => openEditDialog(doc.id, doc.name, month, val)}
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
                                            onChange={(val) => updateTargetMutation.mutate(val)}
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
                            </TableRow>
                        </TableBody>
                    </Table>
                </div>
            )}

            {/* Edit Dialog */}
            <Dialog open={editDialog.open} onOpenChange={(open) => setEditDialog({ ...editDialog, open })}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>
                            Stellenplan bearbeiten
                        </DialogTitle>
                        <p className="text-sm text-slate-500">
                            {editDialog.doctorName} - Monat {editDialog.month}/{year}
                        </p>
                    </DialogHeader>
                    
                    <div className="space-y-6 py-4">
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
                                    onChange={(e) => setDialogValue(e.target.value)}
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
                                                    code === "KO" && "text-red-600"
                                                )}>{code}</span>
                                                <span className="text-slate-500 ml-2">– {FTE_CODE_LABELS[code]}</span>
                                            </Label>
                                        </div>
                                    ))}
                                </RadioGroup>
                                <p className="text-xs text-slate-500">
                                    Alle Statuscodes werden als "nicht verfügbar" gewertet
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
                            </RadioGroup>
                        </div>
                    </div>

                    <DialogFooter className="gap-2">
                        <Button variant="outline" onClick={() => setEditDialog({ ...editDialog, open: false })}>
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