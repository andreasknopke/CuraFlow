import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, db, base44 } from "@/api/client";
import { useAuth } from '@/components/AuthProvider';
import { Button } from '@/components/ui/button';
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Database, Download, AlertTriangle, CheckCircle, Wrench, ShieldAlert, Key, Copy, Server, Trash2, Power, PowerOff } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { isDbTokenEnabled, enableDbToken, disableDbToken, deleteDbToken, saveDbToken } from '@/components/dbTokenStorage';
import TokenManager from './TokenManager';

export default function DatabaseManagement() {
    const { token } = useAuth();
    const queryClient = useQueryClient();
    const [issues, setIssues] = useState(null);
    const [selectedIssues, setSelectedIssues] = useState([]);

    // Token Generator State
    const [generatedToken, setGeneratedToken] = useState(null);
    const [manualCreds, setManualCreds] = useState({ host: '', user: '', password: '', database: '', port: '3306', ssl: false });
    const [showManualTokenInput, setShowManualTokenInput] = useState(false);
    const [tokenEnabled, setTokenEnabled] = useState(false);
    const [currentToken, setCurrentToken] = useState(null);
    
    // Wipe Database State
    const [showWipeDialog, setShowWipeDialog] = useState(false);
    const [wipeConfirmText, setWipeConfirmText] = useState('');
    const [isWiping, setIsWiping] = useState(false);

    // Load token status on mount
    useEffect(() => {
        setTokenEnabled(isDbTokenEnabled());
        setCurrentToken(localStorage.getItem('db_credentials'));
    }, []);

    const handleToggleToken = async () => {
        if (tokenEnabled) {
            await disableDbToken();
            setTokenEnabled(false);
            toast.success('DB-Token deaktiviert - Standard-DB wird verwendet');
            // Reload to apply changes
            setTimeout(() => window.location.reload(), 1000);
        } else {
            if (!currentToken) {
                toast.error('Kein Token vorhanden - Bitte erst Token generieren');
                return;
            }
            await enableDbToken();
            setTokenEnabled(true);
            toast.success('DB-Token aktiviert - Alternative DB wird verwendet');
            // Reload to apply changes
            setTimeout(() => window.location.reload(), 1000);
        }
    };

    const handleDeleteToken = async () => {
        if (window.confirm('Token wirklich löschen? Dies kann nicht rückgängig gemacht werden.')) {
            await deleteDbToken();
            setCurrentToken(null);
            setTokenEnabled(false);
            setGeneratedToken(null);
            toast.success('Token gelöscht');
            setTimeout(() => window.location.reload(), 1000);
        }
    };

    const generateTokenFromSecretsMutation = useMutation({
        mutationFn: () => invokeWithAuth('generate_db_token'),
        onSuccess: async (res) => {
            const token = res.data.token;
            setGeneratedToken(token);
            setCurrentToken(token);
            // Save token to both storages
            await saveDbToken(token);
            // Auto-enable token
            await enableDbToken();
            setTokenEnabled(true);
            setShowManualTokenInput(false);
            toast.success('Token generiert und aktiviert');
        },
        onError: (err) => {
            toast.error("Fehler: " + err.message);
        }
    });

    const generateTokenManually = async () => {
        try {
            const config = { ...manualCreds };
            if (config.ssl) {
                config.ssl = { rejectUnauthorized: false };
            } else {
                delete config.ssl;
            }
            const json = JSON.stringify(config);
            const token = btoa(json);
            setGeneratedToken(token);
            setCurrentToken(token);
            // Save token to both storages
            await saveDbToken(token);
            // Auto-enable token
            await enableDbToken();
            setTokenEnabled(true);
            toast.success('Token manuell erstellt und aktiviert');
        } catch (e) {
            toast.error("Fehler beim Erstellen des Tokens");
        }
    };

    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text);
        toast.success("Kopiert!");
    };

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
            // Use the API URL from environment, not window.location.origin
            const apiBaseUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
            const url = `${apiBaseUrl}/api/admin/tools`;
            console.log('Calling admin tools:', { url, action, hasToken: !!token });
            
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ action, ...data })
            });
            
            console.log('Response status:', response.status);
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('Error response:', errorText);
                
                // Try to parse as JSON, otherwise use text
                let result;
                try {
                    result = JSON.parse(errorText);
                } catch {
                    throw new Error(`HTTP ${response.status}: ${errorText || response.statusText}`);
                }
                
                throw new Error(result.error || `HTTP ${response.status}`);
            }
            
            const result = await response.json();
            console.log('Success response:', result);
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

            {/* Token Manager - Multi-Tenant Support */}
            <TokenManager />

            <div className="grid md:grid-cols-2 gap-6">
                {/* DB Access Token - Legacy section for manual token */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Key className="w-5 h-5" /> Manuelles Token
                        </CardTitle>
                        <CardDescription>Token direkt eingeben oder aus Secrets generieren</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {/* Token Status & Controls */}
                        {currentToken && (
                            <div className="p-4 bg-slate-50 rounded-lg border space-y-3">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <Badge variant={tokenEnabled ? "default" : "secondary"}>
                                            {tokenEnabled ? "Aktiv" : "Inaktiv"}
                                        </Badge>
                                        <span className="text-sm text-slate-600">Token gespeichert</span>
                                    </div>
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={handleDeleteToken}
                                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </Button>
                                </div>
                                
                                <Button
                                    className="w-full"
                                    variant={tokenEnabled ? "destructive" : "default"}
                                    onClick={handleToggleToken}
                                >
                                    {tokenEnabled ? (
                                        <>
                                            <PowerOff className="w-4 h-4 mr-2" />
                                            Token deaktivieren (zurück zur Standard-DB)
                                        </>
                                    ) : (
                                        <>
                                            <Power className="w-4 h-4 mr-2" />
                                            Token aktivieren (Alternative DB nutzen)
                                        </>
                                    )}
                                </Button>
                            </div>
                        )}

                        <div className="space-y-2">
                            <Button 
                                variant="outline" 
                                className="w-full"
                                onClick={() => generateTokenFromSecretsMutation.mutate()}
                                disabled={generateTokenFromSecretsMutation.isPending}
                            >
                                {generateTokenFromSecretsMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Server className="w-4 h-4 mr-2" />}
                                Aus gespeicherten Secrets erzeugen
                            </Button>
                            
                            <div className="text-center text-xs text-slate-400">- oder -</div>
                            
                            <Button 
                                variant="ghost" 
                                className="w-full text-sm"
                                onClick={() => setShowManualTokenInput(!showManualTokenInput)}
                            >
                                {showManualTokenInput ? "Manuelle Eingabe verbergen" : "Manuell eingeben"}
                            </Button>
                        </div>

                        {showManualTokenInput && (
                            <div className="space-y-2 p-4 bg-slate-50 rounded-md border">
                                <div className="grid grid-cols-2 gap-2">
                                    <div>
                                        <Label className="text-xs">Host</Label>
                                        <Input value={manualCreds.host} onChange={e => setManualCreds({...manualCreds, host: e.target.value})} className="h-8" />
                                    </div>
                                    <div>
                                        <Label className="text-xs">Port</Label>
                                        <Input value={manualCreds.port} onChange={e => setManualCreds({...manualCreds, port: e.target.value})} className="h-8" />
                                    </div>
                                    <div>
                                        <Label className="text-xs">User</Label>
                                        <Input value={manualCreds.user} onChange={e => setManualCreds({...manualCreds, user: e.target.value})} className="h-8" />
                                    </div>
                                    <div>
                                        <Label className="text-xs">Database</Label>
                                        <Input value={manualCreds.database} onChange={e => setManualCreds({...manualCreds, database: e.target.value})} className="h-8" />
                                    </div>
                                    <div className="col-span-2">
                                        <Label className="text-xs">Password</Label>
                                        <Input type="password" value={manualCreds.password} onChange={e => setManualCreds({...manualCreds, password: e.target.value})} className="h-8" />
                                    </div>
                                    <div className="col-span-2 flex items-center space-x-2 pt-2">
                                        <Checkbox 
                                            id="ssl-mode" 
                                            checked={manualCreds.ssl} 
                                            onCheckedChange={(checked) => setManualCreds({...manualCreds, ssl: checked})} 
                                        />
                                        <Label htmlFor="ssl-mode" className="text-xs cursor-pointer">SSL Verbindung erzwingen (für Cloud DBs)</Label>
                                    </div>
                                </div>
                                <Button size="sm" className="w-full mt-2" onClick={generateTokenManually}>Token generieren</Button>
                            </div>
                        )}

                        {generatedToken && (
                            <div className="mt-4 p-3 bg-indigo-50 border border-indigo-100 rounded-md space-y-2">
                                <div className="flex items-center justify-between">
                                    <Label className="text-indigo-900 font-semibold">Token</Label>
                                    <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => copyToClipboard(generatedToken)}>
                                        <Copy className="h-3 w-3" />
                                    </Button>
                                </div>
                                <div className="bg-white p-2 rounded border text-xs break-all font-mono max-h-20 overflow-y-auto">
                                    {generatedToken}
                                </div>
                                
                                <div className="pt-2 border-t border-indigo-200">
                                    <div className="flex items-center justify-between mb-1">
                                        <Label className="text-indigo-900 text-xs">Link mit Token</Label>
                                        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => {
                                            const url = `${window.location.origin}${window.location.pathname}?db_token=${generatedToken}`;
                                            copyToClipboard(url);
                                        }}>
                                            <Copy className="h-3 w-3" />
                                        </Button>
                                    </div>
                                    <div className="text-[10px] text-slate-500 truncate">
                                        ?db_token=...
                                    </div>
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>

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