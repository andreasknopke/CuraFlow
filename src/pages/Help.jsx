import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
    MousePointerClick, 
    Copy, 
    Trash2, 
    CalendarDays, 
    Users, 
    Keyboard,
    Move,
    AlertTriangle,
    HelpCircle,
    Grab
} from 'lucide-react';

export default function HelpPage() {
    return (
        <div className="container mx-auto max-w-4xl space-y-8 pb-10">
            <div>
                <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
                    <HelpCircle className="w-8 h-8 text-indigo-600" />
                    Hilfe & Dokumentation
                </h1>
                <p className="text-slate-500 mt-2 text-lg">Anleitungen und Profi-Tipps zur Bedienung von RadioPlan.</p>
            </div>

            <Tabs defaultValue="schedule" className="space-y-6">
                <TabsList className="w-full justify-start h-auto p-1 bg-slate-100">
                    <TabsTrigger value="schedule" className="px-6 py-2">Wochenplan</TabsTrigger>
                    <TabsTrigger value="vacation" className="px-6 py-2">Abwesenheiten</TabsTrigger>
                    <TabsTrigger value="staff" className="px-6 py-2">Verwaltung</TabsTrigger>
                </TabsList>

                {/* WOCHENPLAN */}
                <TabsContent value="schedule" className="space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-xl">
                                <Grab className="w-6 h-6 text-indigo-600" />
                                Drag & Drop Funktionen
                            </CardTitle>
                            <CardDescription>
                                Wie Sie Einträge im Wochenplan schnell organisieren können.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="grid gap-6 md:grid-cols-2">
                                <div className="p-5 bg-slate-50 rounded-xl border border-slate-200">
                                    <h3 className="font-bold text-slate-900 mb-2 flex items-center gap-2">
                                        <Move className="w-4 h-4" />
                                        Verschieben
                                    </h3>
                                    <p className="text-sm text-slate-600 leading-relaxed">
                                        Ziehen Sie einen Eintrag mit der Maus von einem Tag zum anderen, um ihn zu verschieben.
                                        Der Eintrag wird am ursprünglichen Ort entfernt und am neuen Ort eingefügt.
                                    </p>
                                </div>
                                <div className="p-5 bg-indigo-50 rounded-xl border border-indigo-100">
                                    <h3 className="font-bold text-indigo-900 mb-2 flex items-center gap-2">
                                        <Copy className="w-4 h-4" />
                                        Kopieren (Profi-Tipp)
                                    </h3>
                                    <p className="text-sm text-indigo-800 leading-relaxed">
                                        Halten Sie die <strong>STRG-Taste</strong> (oder Command auf Mac) gedrückt, während Sie einen Eintrag ziehen.
                                        <br/><br/>
                                        Dadurch wird der Eintrag <strong>dupliziert</strong>: Er bleibt am ursprünglichen Ort erhalten und wird zusätzlich am neuen Ort erstellt.
                                    </p>
                                </div>
                            </div>
                            <div className="p-4 border rounded-lg bg-amber-50 border-amber-100 text-sm text-amber-900">
                                <strong>Hinweis:</strong> Wenn Sie einen Dienst auf eine bereits besetzte Position ziehen, wird der vorherige Eintrag automatisch ersetzt (überschrieben).
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-xl">
                                <Trash2 className="w-6 h-6 text-red-500" />
                                Löschen von Einträgen
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid gap-4 md:grid-cols-3">
                                <div className="space-y-2">
                                    <span className="font-semibold block">Methode 1: Papierkorb</span>
                                    <p className="text-sm text-slate-600">
                                        Ziehen Sie einen Eintrag aus dem Plan in den roten <strong>"Papierkorb"-Bereich</strong> in der linken Seitenleiste (erscheint beim Ziehen).
                                    </p>
                                </div>
                                <div className="space-y-2">
                                    <span className="font-semibold block">Methode 2: Aus der Liste</span>
                                    <p className="text-sm text-slate-600">
                                        Ziehen Sie einen Eintrag aus dem Plan <strong>zurück in die Seitenleiste</strong> zum verfügbaren Personal.
                                    </p>
                                </div>
                                <div className="space-y-2">
                                    <span className="font-semibold block">Methode 3: Tag leeren</span>
                                    <p className="text-sm text-slate-600">
                                        Bewegen Sie die Maus über das Datum im Kopf der Spalte. Klicken Sie auf das kleine <strong>Mülleimer-Symbol</strong> <Trash2 className="w-3 h-3 inline text-red-500" />, um alle Dienste dieses Tages zu entfernen (Abwesenheiten bleiben erhalten).
                                    </p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-xl">
                                <AlertTriangle className="w-6 h-6 text-amber-500" />
                                Intelligente Funktionen & Warnungen
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="space-y-4">
                                <h3 className="font-semibold flex items-center gap-2 text-blue-900">
                                    <span className="bg-blue-100 p-1 rounded">Auto-Frei</span>
                                    Automatischer Freizeitausgleich
                                </h3>
                                <p className="text-sm text-slate-600">
                                    Bestimmte Dienste (wie z.B. "Dienst Vordergrund") lösen automatisch einen Freizeitausgleich am Folgetag aus.
                                    Wenn Sie einen solchen Dienst eintragen, wird für die betroffene Person am nächsten Tag automatisch "Frei" eingetragen (außer an Wochenenden und Feiertagen).
                                </p>
                                <div className="bg-slate-50 p-3 rounded-lg text-xs text-slate-500 border border-slate-200">
                                    Wird ein solcher Dienst verschoben oder gelöscht, wird auch das automatisch erstellte "Frei" korrigiert oder entfernt.
                                </div>
                            </div>

                            <div className="space-y-4 pt-4 border-t">
                                <h3 className="font-semibold flex items-center gap-2 text-amber-900">
                                    <AlertTriangle className="w-4 h-4" />
                                    Warnhinweise im Plan
                                </h3>
                                <div className="grid gap-4 md:grid-cols-2">
                                    <div className="border p-3 rounded-lg bg-amber-50/50 border-amber-100">
                                        <span className="font-medium text-sm block mb-1 text-amber-800">Gelbes Warndreieck (Datum)</span>
                                        <p className="text-xs text-slate-600">
                                            Erscheint neben dem Datum, wenn an einem Werktag alle Pflicht-Arbeitsplätze besetzt sind, aber noch Personal verfügbar wäre, das nirgendwo eingeteilt ist.
                                            Klicken Sie auf das Dreieck, um zu sehen, wer noch "übrig" ist.
                                        </p>
                                    </div>
                                    <div className="border p-3 rounded-lg bg-red-50/50 border-red-100">
                                        <span className="font-medium text-sm block mb-1 text-red-800">Doppelbelegung & Konflikte</span>
                                        <p className="text-xs text-slate-600">
                                            Das System verhindert aktiv ungültige Zuweisungen, z.B. wenn eine Person bereits als "Krank" oder "Urlaub" eingetragen ist.
                                            Bei Versuchen, einen Dienst doppelt zu besetzen, werden Sie gewarnt oder der alte Eintrag wird ersetzt.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>
                
                {/* ABWESENHEITEN */}
                <TabsContent value="vacation" className="space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-xl">Jahresplaner & Abwesenheiten</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="p-5 bg-blue-50 border-blue-100 rounded-xl border">
                                <h3 className="font-bold text-blue-900 mb-3 flex items-center gap-2">
                                    <MousePointerClick className="w-5 h-5" />
                                    Schnellauswahl (Range Select)
                                </h3>
                                <div className="text-sm text-blue-800 space-y-2">
                                    <p>Sie können schnell Zeiträume für Urlaub, Krankheit etc. markieren:</p>
                                    <ol className="list-decimal list-inside space-y-1 ml-2">
                                        <li>Wählen Sie oben den gewünschten Status (z.B. "Urlaub").</li>
                                        <li>Klicken Sie auf den <strong>ersten Tag</strong> des Zeitraums und halten Sie die Maustaste gedrückt.</li>
                                        <li>Ziehen Sie die Maus bis zum <strong>letzten Tag</strong>.</li>
                                        <li>Lassen Sie die Maustaste los – der gesamte Zeitraum wird markiert.</li>
                                    </ol>
                                </div>
                            </div>
                            
                            <div className="grid md:grid-cols-2 gap-4">
                                <div className="border p-4 rounded-lg">
                                    <h4 className="font-semibold mb-2">Einzelne Tage</h4>
                                    <p className="text-sm text-slate-600">
                                        Klicken Sie einfach auf einen einzelnen Tag, um den Status zu setzen (oder zu entfernen, wenn er bereits gesetzt ist).
                                    </p>
                                </div>
                                <div className="border p-4 rounded-lg">
                                    <h4 className="font-semibold mb-2">Lösch-Modus</h4>
                                    <p className="text-sm text-slate-600">
                                        Wählen Sie den grauen Status <strong>"Löschen"</strong>, um mit der gleichen Methode (Klicken oder Ziehen) vorhandene Einträge zu entfernen.
                                    </p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-xl">
                                <CalendarDays className="w-6 h-6 text-indigo-600" />
                                Feiertage & Schulferien
                            </CardTitle>
                            <CardDescription>
                                Automatische Kalenderdaten und Einstellungen.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <h3 className="font-semibold">Bundesland & Automatische Daten</h3>
                                <p className="text-sm text-slate-600">
                                    RadioPlan lädt automatisch die gesetzlichen Feiertage und Schulferien für Ihr gewähltes Bundesland (Standard: Mecklenburg-Vorpommern).
                                    Sie können das Bundesland in den <strong>Einstellungen</strong> (Zahnrad-Symbol auf der Abwesenheits-Seite) ändern.
                                </p>
                            </div>
                            <div className="space-y-2">
                                <h3 className="font-semibold">Eigene Feiertage verwalten</h3>
                                <p className="text-sm text-slate-600">
                                    Fehlt ein Feiertag oder stimmen die Ferien nicht? In den Einstellungen können Sie:
                                </p>
                                <ul className="list-disc list-inside text-sm text-slate-600 ml-2">
                                    <li>Zusätzliche freie Tage oder Brückentage definieren.</li>
                                    <li>Falsche oder nicht benötigte Einträge ausblenden ("Entfernen/Blockieren").</li>
                                    <li>Unterscheiden zwischen "Schulferien" (nur informativ, grün hinterlegt) und echten "Feiertagen" (werden wie Sonntage behandelt).</li>
                                </ul>
                            </div>
                            <div className="p-3 bg-indigo-50 text-indigo-900 text-sm rounded-lg border border-indigo-100">
                                <strong>Tipp:</strong> Die Daten werden live von einer externen Datenbank (OpenHolidays API) geladen, sodass Sie auch für kommende Jahre immer aktuelle Ferientermine haben.
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* VERWALTUNG */}
                 <TabsContent value="staff" className="space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-xl">Verwaltung & Konfiguration</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-4">
                                <div className="flex gap-4 items-start">
                                    <div className="p-2 bg-slate-100 rounded text-slate-600 mt-1">
                                        <Users className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <h4 className="font-semibold">Mitarbeiter sortieren</h4>
                                        <p className="text-sm text-slate-600 mt-1">
                                            Auf der Seite "Team" können Sie die Reihenfolge der Mitarbeiter per Drag & Drop verändern.
                                            Die hier festgelegte Reihenfolge wird automatisch im Wochenplan (Seitenleiste) und in den Auswahllisten übernommen.
                                        </p>
                                    </div>
                                </div>

                                <div className="flex gap-4 items-start">
                                    <div className="p-2 bg-slate-100 rounded text-slate-600 mt-1">
                                        <CalendarDays className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <h4 className="font-semibold">Arbeitsplätze konfigurieren</h4>
                                        <p className="text-sm text-slate-600 mt-1">
                                            Im Wochenplan finden Sie oben rechts Buttons für Einstellungen.
                                            Hier können Sie neue Zeilen (Arbeitsplätze) hinzufügen, bestehende umbenennen oder die Reihenfolge ändern.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}