import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { isWeekend, parseISO, isValid } from 'date-fns';

export default function ComplianceReport({ doctors, shifts }) {
    const stats = useMemo(() => {
        return doctors.map(doc => {
            const docShifts = shifts.filter(s => s.doctor_id === doc.id);
            
            // 1. Weekend Shifts Count
            const weekendShifts = docShifts.filter(s => {
                if (!s.date) return false;
                const d = parseISO(s.date);
                // Exclude all absence types
                return isValid(d) && isWeekend(d) && !["Frei", "Urlaub", "Krank", "Dienstreise", "Nicht verfügbar"].includes(s.position);
            }).length;

            // 2. Consecutive Days (Simple heuristic: sort by date, count streak)
            // Note: this requires shifts to be sorted.
            const sortedShifts = [...docShifts]
                .filter(s => !["Frei", "Urlaub", "Krank", "Dienstreise", "Nicht verfügbar"].includes(s.position)) // Only working shifts
                .sort((a, b) => a.date.localeCompare(b.date));

            let maxStreak = 0;
            let currentStreak = 0;
            let lastDate = null;

            sortedShifts.forEach(shift => {
                if (!lastDate) {
                    currentStreak = 1;
                } else {
                    const curr = new Date(shift.date);
                    const prev = new Date(lastDate);
                    const diffTime = Math.abs(curr - prev);
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
                    
                    if (diffDays === 1) {
                        currentStreak++;
                    } else {
                        maxStreak = Math.max(maxStreak, currentStreak);
                        currentStreak = 1;
                    }
                }
                lastDate = shift.date;
            });
            maxStreak = Math.max(maxStreak, currentStreak);

            // 3. Night/Late Shifts (Spätdienst)
            const lateShifts = docShifts.filter(s => s.position === "Spätdienst").length;

            return {
                name: doc.name,
                role: doc.role,
                weekendShifts,
                maxStreak,
                lateShifts
            };
        }).sort((a, b) => b.weekendShifts - a.weekendShifts);
    }, [doctors, shifts]);

    return (
        <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle>Wochenend-Belastung</CardTitle>
                        <CardDescription>Anzahl der Dienste an Samstagen und Sonntagen</CardDescription>
                    </CardHeader>
                    <CardContent>
                         <div className="space-y-4">
                            {stats.slice(0, 5).map(doc => (
                                <div key={doc.name} className="flex items-center justify-between">
                                    <div className="flex flex-col">
                                        <span className="text-sm font-medium">{doc.name}</span>
                                        <span className="text-xs text-slate-500">{doc.role}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <div className="w-32 h-2 bg-slate-100 rounded-full overflow-hidden">
                                            <div 
                                                className="h-full bg-indigo-500" 
                                                style={{ width: `${Math.min(100, (doc.weekendShifts / 10) * 100)}%` }}
                                            />
                                        </div>
                                        <span className="text-sm font-bold w-8 text-right">{doc.weekendShifts}</span>
                                    </div>
                                </div>
                            ))}
                         </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Längste Arbeitsphasen</CardTitle>
                        <CardDescription>Max. aufeinanderfolgende Arbeitstage</CardDescription>
                    </CardHeader>
                    <CardContent>
                         <div className="space-y-4">
                            {stats.sort((a,b) => b.maxStreak - a.maxStreak).slice(0, 5).map(doc => (
                                <div key={doc.name} className="flex items-center justify-between">
                                    <div className="flex flex-col">
                                        <span className="text-sm font-medium">{doc.name}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {doc.maxStreak > 10 && <Badge variant="destructive">Warnung</Badge>}
                                        <span className={`text-sm font-bold ${doc.maxStreak > 10 ? 'text-red-600' : 'text-slate-700'}`}>
                                            {doc.maxStreak} Tage
                                        </span>
                                    </div>
                                </div>
                            ))}
                         </div>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Compliance Übersicht</CardTitle>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Arzt</TableHead>
                                <TableHead className="text-right">Wochenend-Dienste</TableHead>
                                <TableHead className="text-right">Spätdienste</TableHead>
                                <TableHead className="text-right">Max. Serie (Tage)</TableHead>
                                <TableHead className="text-right">Status</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {stats.map((doc) => {
                                const hasWarning = doc.maxStreak > 12; // Example threshold
                                return (
                                    <TableRow key={doc.name}>
                                        <TableCell className="font-medium">{doc.name}</TableCell>
                                        <TableCell className="text-right">{doc.weekendShifts}</TableCell>
                                        <TableCell className="text-right">{doc.lateShifts}</TableCell>
                                        <TableCell className="text-right">{doc.maxStreak}</TableCell>
                                        <TableCell className="text-right">
                                            {hasWarning ? (
                                                <Badge variant="destructive">Prüfen</Badge>
                                            ) : (
                                                <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">OK</Badge>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    );
}