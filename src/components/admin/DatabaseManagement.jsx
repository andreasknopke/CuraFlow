import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/components/AuthProvider';
import { Button } from '@/components/ui/button';
import { toast } from "sonner";
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Database, Download, AlertTriangle, CheckCircle, Wrench, ShieldAlert, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Checkbox } from "@/components/ui/checkbox";
import ServerTokenManager from './ServerTokenManager';

export default function DatabaseManagement() {
    const { token } = useAuth();
    const queryClient = useQueryClient();
    const [issues, setIssues] = useState(null);
    const [selectedIssues, setSelectedIssues] = useState([]);
    
    // Wipe Database State
    const [showWipeDialog, setShowWipeDialog] = useState(false);
    const [wipeConfirmText, setWipeConfirmText] = useState('');
    const [isWiping, setIsWiping] = useState(false);

    // --- CHECK ---
    const checkMutation = useMutation({
        mutationFn: () => invokeWithAuth('check'),
        onSuccess: (res) => {
            setIssues(res.data.issues);
            setSelectedIssues([]);
        }
    });

    // --- REPAIR ---
    const repairMutation = useMutation({
        mutationFn: async () => {
             const issuesToFix = issues.filter(i => selectedIssues.includes(i.id || i.ids?.[0]));
             const processedIssues = issuesToFix.map(issue => issue);
             return invokeWithAuth('repair', { data: { issuesToFix: processedIssues } });
        },
        onSuccess: (res) => {
            alert(res.data.message + "\n" + res.data.results.join('\n'));
            checkMutation.mutate();
        }
    });

    const toggleIssue = (id) => {
        setSelectedIssues(prev => 
            prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
        );
    };

    const toggleAll = () => {
        if (selectedIssues.length === issues.length) setSelectedIssues([]);
        else setSelectedIssues(issues.map(i => i.id || i.ids?.[0]));
    };

    // --- Wipe Database ---
    const handleWipeDatabase = async () => {
        if (wipeConfirmText !== 'LÖSCHEN') return;
        setIsWiping(true);
        try {
            const res = await invokeWithAuth('wipe_database');
            toast.success(res.data.message || 'Datenbank geleert!');
            setShowWipeDialog(false);
            setWipeConfirmText('');
            queryClient.invalidateQueries();
        } catch (e) {
            toast.error('Fehler: ' + (e.message));
        } finally {
            setIsWiping(false);
        }
    };

    // Helper to call backend with JWT token
    const invokeWithAuth = async (action, data = {}) => {
        try {
            const apiBaseUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
            const url = `${apiBaseUrl}/api/admin/tools`;
            
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ action, ...data })
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                let result;
                try {
                    result = JSON.parse(errorText);
                } catch {
                    throw new Error(`HTTP ${response.status}: ${errorText || response.statusText}`);
                }
                throw new Error(result.error || `HTTP ${response.status}`);
            }
            
            const result = await response.json();
            return { data: result };
        } catch (error) {
            console.error('invokeWithAuth error:', error);
            throw error;
        }
    };

    // --- MySQL Export ---
    const handleMySQLExport = async () => {
        try {
            toast.info('Lade MySQL-Daten...');
            const res = await invokeWithAuth('export_mysql_as_json');

            const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `mysql_export_${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            toast.success('MySQL-Export heruntergeladen!');
        } catch (e) {
            toast.error('Fehler: ' + (e.message));
        }
    };

    return (
        <div className="space-y-8">
            <Alert className="bg-blue-50 border-blue-200">
                <Database className="w-4 h-4 text-blue-600" />
                <AlertTitle className="text-blue-800">MySQL-Modus aktiv</AlertTitle>
                <AlertDescription className="text-blue-700">
                    Die Anwendung nutzt ausschließlich die externe MySQL-Datenbank.
                </AlertDescription>
            </Alert>

            {/* Server Token Manager - Multi-Tenant Support */}
            <ServerTokenManager />

            <div className="grid md:grid-cols-2 gap-6">
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Database className="w-5 h-5" /> Datenbank-Tools
                        </CardTitle>
                        <CardDescription>Export & Wartung</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <Button 
                            onClick={handleMySQLExport}
                            variant="outline"
                            className="w-full border-blue-600 text-blue-600 hover:bg-blue-50"
                        >
                            <Download className="w-4 h-4 mr-2" />
                            MySQL als JSON exportieren
                        </Button>
                        
                        <Button 
                            onClick={() => setShowWipeDialog(true)}
                            variant="outline"
                            className="w-full border-red-600 text-red-600 hover:bg-red-50"
                        >
                            <Trash2 className="w-4 h-4 mr-2" />
                            Datenbank leeren
                        </Button>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <ShieldAlert className="w-5 h-5" /> Integritätsprüfung
                        </CardTitle>
                        <CardDescription>Datenbank auf Fehler und Regelverstöße prüfen</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                         <Button 
                            onClick={() => checkMutation.mutate()} 
                            disabled={checkMutation.isPending}
                            className="w-full"
                        >
                            {checkMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <AlertTriangle className="w-4 h-4 mr-2" />}
                            Prüfung starten
                        </Button>
                        
                        {issues && issues.length === 0 && (
                            <Alert className="bg-green-50 border-green-200 text-green-800">
                                <CheckCircle className="w-4 h-4" />
                                <AlertTitle>Alles in Ordnung</AlertTitle>
                                <AlertDescription>Keine Inkonsistenzen gefunden.</AlertDescription>
                            </Alert>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* Wipe Database Confirmation Dialog */}
            <Dialog open={showWipeDialog} onOpenChange={setShowWipeDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="text-red-600 flex items-center gap-2">
                            <AlertTriangle className="w-5 h-5" />
                            Datenbank leeren
                        </DialogTitle>
                        <DialogDescription>
                            Diese Aktion löscht <strong>alle Daten</strong> außer Benutzer (app_users). 
                            Dies kann nicht rückgängig gemacht werden!
                        </DialogDescription>
                    </DialogHeader>
                    <div className="py-4 space-y-4">
                        <Alert className="bg-red-50 border-red-200">
                            <AlertTriangle className="w-4 h-4 text-red-600" />
                            <AlertDescription className="text-red-700">
                                Folgende Tabellen werden geleert: Doctor, ShiftEntry, Workplace, WishRequest, TrainingRotation, etc.
                            </AlertDescription>
                        </Alert>
                        <div className="space-y-2">
                            <Label>Geben Sie <strong>LÖSCHEN</strong> ein, um zu bestätigen:</Label>
                            <Input 
                                value={wipeConfirmText}
                                onChange={(e) => setWipeConfirmText(e.target.value)}
                                placeholder="LÖSCHEN"
                                className="font-mono"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowWipeDialog(false)}>
                            Abbrechen
                        </Button>
                        <Button 
                            variant="destructive"
                            onClick={handleWipeDatabase}
                            disabled={wipeConfirmText !== 'LÖSCHEN' || isWiping}
                        >
                            {isWiping ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
                            Endgültig löschen
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Issues List */}
            {issues && issues.length > 0 && (
                <Card className="border-red-200">
                    <CardHeader className="bg-red-50 border-b border-red-100">
                        <CardTitle className="text-red-800 flex justify-between items-center">
                            <span>{issues.length} Probleme gefunden</span>
                            {selectedIssues.length > 0 && (
                                <Button 
                                    variant="destructive" 
                                    size="sm" 
                                    onClick={() => repairMutation.mutate()}
                                    disabled={repairMutation.isPending}
                                >
                                    {repairMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Wrench className="w-4 h-4 mr-2" />}
                                    {selectedIssues.length} Probleme beheben
                                </Button>
                            )}
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-12">
                                        <Checkbox 
                                            checked={selectedIssues.length === issues.length}
                                            onCheckedChange={toggleAll}
                                        />
                                    </TableHead>
                                    <TableHead>Typ</TableHead>
                                    <TableHead>Beschreibung</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {issues.map((issue, idx) => {
                                    const id = issue.id || issue.ids?.[0];
                                    return (
                                        <TableRow key={idx}>
                                            <TableCell>
                                                <Checkbox 
                                                    checked={selectedIssues.includes(id)}
                                                    onCheckedChange={() => toggleIssue(id)}
                                                />
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant="outline" className="border-red-200 text-red-700 bg-red-50">
                                                    {issue.type}
                                                </Badge>
                                            </TableCell>
                                            <TableCell>{issue.description}</TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}