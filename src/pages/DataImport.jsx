import React, { useState } from 'react';
import { api, db, base44 } from "@/api/client";
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Upload, CheckCircle, AlertTriangle, Loader2 } from 'lucide-react';

export default function DataImportPage() {
    const [status, setStatus] = useState('idle'); // idle, parsing, importing, done, error
    const [progress, setProgress] = useState(0);
    const [log, setLog] = useState([]);
    const [results, setResults] = useState(null);

    // Fetch current doctors to build name->id mapping
    const { data: doctors = [] } = useQuery({
        queryKey: ['doctors'],
        queryFn: () => base44.entities.Doctor.list()
    });

    const addLog = (msg, type = 'info') => {
        setLog(prev => [...prev, { msg, type, time: new Date().toLocaleTimeString() }]);
    };

    const delay = (ms) => new Promise(r => setTimeout(r, ms));

    const handleFileUpload = async (event) => {
        const file = event.target.files[0];
        if (!file) return;

        setStatus('parsing');
        setLog([]);
        setProgress(0);
        addLog('Datei wird gelesen...');

        try {
            const text = await file.text();
            const data = JSON.parse(text);
            addLog(`JSON erfolgreich geparst`);

            if (!data.data) {
                throw new Error('Ungültiges Format - kein "data" Objekt gefunden');
            }

            // Build doctor name -> new ID mapping
            const doctorNameToNewId = {};
            doctors.forEach(d => {
                doctorNameToNewId[d.name] = d.id;
            });
            addLog(`${doctors.length} Personen für ID-Mapping geladen`);

            // Build old doctor ID -> name mapping from import data
            const oldIdToName = {};
            if (data.data.Doctor) {
                data.data.Doctor.forEach(d => {
                    oldIdToName[d.id] = d.name;
                });
                addLog(`${data.data.Doctor.length} Personen in Import-Datei gefunden`);
            }

            // Build old ID -> new ID mapping
            const oldToNewDoctorId = {};
            Object.entries(oldIdToName).forEach(([oldId, name]) => {
                if (doctorNameToNewId[name]) {
                    oldToNewDoctorId[oldId] = doctorNameToNewId[name];
                }
            });
            addLog(`${Object.keys(oldToNewDoctorId).length} ID-Zuordnungen erstellt`);

            setStatus('importing');
            const importResults = {};

            // Import ShiftEntry
            if (data.data.ShiftEntry && data.data.ShiftEntry.length > 0) {
                const shifts = data.data.ShiftEntry.filter(s => s.date && oldToNewDoctorId[s.doctor_id]);
                addLog(`${shifts.length} gültige ShiftEntries gefunden (von ${data.data.ShiftEntry.length})`);
                
                let imported = 0;
                let skipped = 0;
                const batchSize = 20;
                
                for (let i = 0; i < shifts.length; i += batchSize) {
                    const batch = shifts.slice(i, i + batchSize).map(s => ({
                        date: s.date,
                        position: s.position,
                        doctor_id: oldToNewDoctorId[s.doctor_id],
                        note: s.note || undefined,
                        order: s.order || undefined
                    }));
                    
                    try {
                        await base44.entities.ShiftEntry.bulkCreate(batch);
                        imported += batch.length;
                    } catch (e) {
                        // Try one by one
                        for (const entry of batch) {
                            try {
                                await base44.entities.ShiftEntry.create(entry);
                                imported++;
                            } catch {
                                skipped++;
                            }
                        }
                    }
                    
                    setProgress(Math.round((i / shifts.length) * 50));
                    if (i % 100 === 0) {
                        addLog(`ShiftEntry: ${imported} importiert...`);
                        await delay(300); // Rate limit protection
                    }
                }
                
                importResults.ShiftEntry = { imported, skipped };
                addLog(`ShiftEntry: ${imported} importiert, ${skipped} übersprungen`, imported > 0 ? 'success' : 'warning');
            }

            // Import StaffingPlanEntry
            if (data.data.StaffingPlanEntry && data.data.StaffingPlanEntry.length > 0) {
                const entries = data.data.StaffingPlanEntry.filter(s => oldToNewDoctorId[s.doctor_id]);
                addLog(`${entries.length} StaffingPlanEntries gefunden`);
                
                let imported = 0;
                const batchSize = 20;
                
                for (let i = 0; i < entries.length; i += batchSize) {
                    const batch = entries.slice(i, i + batchSize).map(s => ({
                        doctor_id: oldToNewDoctorId[s.doctor_id],
                        year: s.year,
                        month: s.month,
                        value: s.value
                    }));
                    
                    try {
                        await base44.entities.StaffingPlanEntry.bulkCreate(batch);
                        imported += batch.length;
                    } catch {
                        for (const entry of batch) {
                            try {
                                await base44.entities.StaffingPlanEntry.create(entry);
                                imported++;
                            } catch {}
                        }
                    }
                    
                    setProgress(50 + Math.round((i / entries.length) * 15));
                    await delay(200);
                }
                
                importResults.StaffingPlanEntry = imported;
                addLog(`StaffingPlanEntry: ${imported} importiert`, 'success');
            }

            // Import TrainingRotation
            if (data.data.TrainingRotation && data.data.TrainingRotation.length > 0) {
                const entries = data.data.TrainingRotation.filter(s => 
                    s.start_date && s.end_date && oldToNewDoctorId[s.doctor_id]
                );
                addLog(`${entries.length} TrainingRotations gefunden`);
                
                let imported = 0;
                for (const entry of entries) {
                    try {
                        await base44.entities.TrainingRotation.create({
                            doctor_id: oldToNewDoctorId[entry.doctor_id],
                            modality: entry.modality,
                            start_date: entry.start_date,
                            end_date: entry.end_date
                        });
                        imported++;
                    } catch {}
                    await delay(100);
                }
                
                importResults.TrainingRotation = imported;
                addLog(`TrainingRotation: ${imported} importiert`, 'success');
                setProgress(70);
            }

            // Import ScheduleNote
            if (data.data.ScheduleNote && data.data.ScheduleNote.length > 0) {
                const entries = data.data.ScheduleNote.filter(s => s.date);
                addLog(`${entries.length} ScheduleNotes gefunden`);
                
                let imported = 0;
                for (const entry of entries) {
                    try {
                        await base44.entities.ScheduleNote.create({
                            date: entry.date,
                            position: entry.position,
                            content: entry.content
                        });
                        imported++;
                    } catch {}
                }
                
                importResults.ScheduleNote = imported;
                addLog(`ScheduleNote: ${imported} importiert`, 'success');
                setProgress(80);
            }

            // Import ColorSetting
            if (data.data.ColorSetting && data.data.ColorSetting.length > 0) {
                let imported = 0;
                for (const entry of data.data.ColorSetting) {
                    try {
                        await base44.entities.ColorSetting.create({
                            name: entry.name,
                            category: entry.category,
                            bg_color: entry.bg_color,
                            text_color: entry.text_color
                        });
                        imported++;
                    } catch {}
                }
                importResults.ColorSetting = imported;
                addLog(`ColorSetting: ${imported} importiert`, 'success');
                setProgress(90);
            }

            // Import DemoSetting
            if (data.data.DemoSetting && data.data.DemoSetting.length > 0) {
                let imported = 0;
                for (const entry of data.data.DemoSetting) {
                    try {
                        await base44.entities.DemoSetting.create({
                            name: entry.name,
                            active_days: entry.active_days,
                            time: entry.time
                        });
                        imported++;
                    } catch {}
                }
                importResults.DemoSetting = imported;
                addLog(`DemoSetting: ${imported} importiert`, 'success');
            }

            setProgress(85);

            // Import WishRequest
            if (data.data.WishRequest && data.data.WishRequest.length > 0) {
                const entries = data.data.WishRequest.filter(w => w.date && oldToNewDoctorId[w.doctor_id]);
                addLog(`${entries.length} gültige WishRequests gefunden (von ${data.data.WishRequest.length})`);
                
                let imported = 0;
                let skipped = 0;
                
                for (const entry of entries) {
                    try {
                        await base44.entities.WishRequest.create({
                            doctor_id: oldToNewDoctorId[entry.doctor_id],
                            date: entry.date,
                            type: entry.type || 'no_service',
                            position: entry.position || undefined,
                            priority: entry.priority || 'medium',
                            reason: entry.reason || undefined,
                            status: entry.status || 'pending',
                            admin_comment: entry.admin_comment || undefined,
                            user_viewed: entry.user_viewed !== undefined ? entry.user_viewed : true
                        });
                        imported++;
                    } catch {
                        skipped++;
                    }
                    await delay(50);
                }
                
                importResults.WishRequest = { imported, skipped };
                addLog(`WishRequest: ${imported} importiert, ${skipped} übersprungen`, imported > 0 ? 'success' : 'warning');
            }

            setProgress(100);
            setResults(importResults);
            setStatus('done');
            addLog('Import abgeschlossen!', 'success');

        } catch (err) {
            setStatus('error');
            addLog(`Fehler: ${err.message}`, 'error');
        }
    };

    return (
        <div className="container mx-auto max-w-3xl py-8">
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Upload className="w-6 h-6" />
                        Daten-Import aus MySQL-Export
                    </CardTitle>
                    <CardDescription>
                        Laden Sie die MySQL-Export JSON-Datei hoch. Die Personen-IDs werden automatisch zugeordnet.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    {status === 'idle' && (
                        <div className="border-2 border-dashed border-slate-300 rounded-lg p-8 text-center">
                            <input
                                type="file"
                                accept=".json,.txt"
                                onChange={handleFileUpload}
                                className="hidden"
                                id="file-upload"
                            />
                            <label htmlFor="file-upload" className="cursor-pointer">
                                <Upload className="w-12 h-12 mx-auto text-slate-400 mb-4" />
                                <p className="text-lg font-medium text-slate-700">JSON-Datei auswählen</p>
                                <p className="text-sm text-slate-500 mt-1">mysql_export_*.json oder .txt</p>
                            </label>
                        </div>
                    )}

                    {(status === 'parsing' || status === 'importing') && (
                        <div className="space-y-4">
                            <div className="flex items-center gap-3">
                                <Loader2 className="w-5 h-5 animate-spin text-indigo-600" />
                                <span className="font-medium">
                                    {status === 'parsing' ? 'Datei wird analysiert...' : 'Import läuft...'}
                                </span>
                            </div>
                            <Progress value={progress} className="h-2" />
                        </div>
                    )}

                    {status === 'done' && (
                        <Alert className="bg-green-50 border-green-200">
                            <CheckCircle className="w-5 h-5 text-green-600" />
                            <AlertDescription className="text-green-800">
                                Import erfolgreich abgeschlossen!
                            </AlertDescription>
                        </Alert>
                    )}

                    {status === 'error' && (
                        <Alert className="bg-red-50 border-red-200">
                            <AlertTriangle className="w-5 h-5 text-red-600" />
                            <AlertDescription className="text-red-800">
                                Import fehlgeschlagen. Siehe Log unten.
                            </AlertDescription>
                        </Alert>
                    )}

                    {log.length > 0 && (
                        <div className="bg-slate-900 text-slate-100 rounded-lg p-4 font-mono text-sm max-h-80 overflow-y-auto">
                            {log.map((entry, i) => (
                                <div key={i} className={`py-0.5 ${
                                    entry.type === 'error' ? 'text-red-400' :
                                    entry.type === 'success' ? 'text-green-400' :
                                    entry.type === 'warning' ? 'text-yellow-400' :
                                    'text-slate-300'
                                }`}>
                                    <span className="text-slate-500">[{entry.time}]</span> {entry.msg}
                                </div>
                            ))}
                        </div>
                    )}

                    {results && (
                        <div className="bg-slate-50 rounded-lg p-4">
                            <h4 className="font-semibold mb-2">Ergebnis:</h4>
                            <ul className="space-y-1 text-sm">
                                {Object.entries(results).map(([key, val]) => (
                                    <li key={key} className="flex justify-between">
                                        <span>{key}:</span>
                                        <span className="font-medium">
                                            {typeof val === 'object' ? `${val.imported} (${val.skipped} übersprungen)` : val}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {(status === 'done' || status === 'error') && (
                        <Button onClick={() => { setStatus('idle'); setLog([]); setResults(null); }} variant="outline">
                            Neuen Import starten
                        </Button>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}