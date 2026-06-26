import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from "sonner";
import { api } from "@/api/client";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Plus, Trash2, Edit2, Check, X, Database, Power, PowerOff, 
    Building2, Copy, RefreshCw, AlertTriangle, TestTube, Server, Loader2
} from 'lucide-react';
import {
    saveDbToken,
    enableDbToken,
    disableDbToken,
    isDbTokenEnabled
} from '@/components/dbTokenStorage';

// Server-based Token Manager
// Stores tokens in the backend database, accessible from any workstation
export default function ServerTokenManager() {
    const queryClient = useQueryClient();
    const [showAddDialog, setShowAddDialog] = useState(false);
    const [editingToken, setEditingToken] = useState(null);
    const [testingId, setTestingId] = useState(null);
    const [localTokenEnabled, setLocalTokenEnabled] = useState(isDbTokenEnabled());
    
    // Form state for new/edit token
    const [formData, setFormData] = useState({
        name: '',
        description: '',
        host: '',
        user: '',
        password: '',
        database: '',
        port: '3306',
        ssl: false
    });
    
    // Fetch all tokens from server
    const { data: tokens = [], isLoading, refetch } = useQuery({
        queryKey: ['serverDbTokens'],
        queryFn: async () => {
            const response = await api.request('/api/admin/db-tokens', { skipDbToken: true });
            return response;
        },
        staleTime: 30000
    });
    
    // Create token mutation
    const createMutation = useMutation({
        mutationFn: async (data) => {
            return await api.request('/api/admin/db-tokens', {
                method: 'POST',
                skipDbToken: true,
                body: JSON.stringify({
                    name: data.name,
                    description: data.description,
                    credentials: {
                        host: data.host,
                        user: data.user,
                        password: data.password,
                        database: data.database,
                        port: data.port,
                        ssl: data.ssl
                    }
                })
            });
        },
        onSuccess: () => {
            queryClient.invalidateQueries(['serverDbTokens']);
            setShowAddDialog(false);
            resetForm();
            toast.success('Token erstellt');
        },
        onError: (err) => {
            toast.error('Fehler: ' + err.message);
        }
    });
    
    // Update token mutation
    const updateMutation = useMutation({
        mutationFn: async ({ id, data }) => {
            return await api.request(`/api/admin/db-tokens/${id}`, {
                method: 'PUT',
                skipDbToken: true,
                body: JSON.stringify({
                    name: data.name,
                    description: data.description,
                    credentials: data.updateCredentials ? {
                        host: data.host,
                        user: data.user,
                        password: data.password,
                        database: data.database,
                        port: data.port,
                        ssl: data.ssl
                    } : undefined
                })
            });
        },
        onSuccess: () => {
            queryClient.invalidateQueries(['serverDbTokens']);
            setEditingToken(null);
            resetForm();
            toast.success('Token aktualisiert');
        },
        onError: (err) => {
            toast.error('Fehler: ' + err.message);
        }
    });
    
    // Delete token mutation
    const deleteMutation = useMutation({
        mutationFn: async (id) => {
            return await api.request(`/api/admin/db-tokens/${id}`, {
                method: 'DELETE',
                skipDbToken: true
            });
        },
        onSuccess: () => {
            queryClient.invalidateQueries(['serverDbTokens']);
            toast.success('Token gelöscht');
        },
        onError: (err) => {
            toast.error('Fehler: ' + err.message);
        }
    });
    
    // Activate token mutation
    const activateMutation = useMutation({
        mutationFn: async (id) => {
            return await api.request(`/api/admin/db-tokens/${id}/activate`, {
                method: 'POST',
                skipDbToken: true
            });
        },
        onSuccess: async (data) => {
            queryClient.invalidateQueries(['serverDbTokens']);
            
            // Save token locally and enable it
            await saveDbToken(data.token);
            await enableDbToken();
            setLocalTokenEnabled(true);
            
            toast.success(`Token "${data.name}" aktiviert`);
            
            // Reload to apply changes
            setTimeout(() => window.location.reload(), 1000);
        },
        onError: (err) => {
            toast.error('Fehler: ' + err.message);
        }
    });
    
    // Deactivate all tokens mutation
    const deactivateMutation = useMutation({
        mutationFn: async () => {
            return await api.request('/api/admin/db-tokens/deactivate-all', {
                method: 'POST',
                skipDbToken: true
            });
        },
        onSuccess: async () => {
            queryClient.invalidateQueries(['serverDbTokens']);
            
            // Disable token locally
            await disableDbToken();
            setLocalTokenEnabled(false);
            
            toast.success('Token-Modus deaktiviert - Standard-DB wird verwendet');
            
            // Reload to apply changes
            setTimeout(() => window.location.reload(), 1000);
        },
        onError: (err) => {
            toast.error('Fehler: ' + err.message);
        }
    });
    
    // Test connection result state for UI feedback
    const [testResult, setTestResult] = useState(null);
    
    // Database check/creation state
    const [checkDbStatus, setCheckDbStatus] = useState(null); // null | { exists, empty, tableCount } | { error }
    const [checkingDb, setCheckingDb] = useState(false);
    const [creatingDb, setCreatingDb] = useState(false);
    
    // Test connection
    const testConnection = async (tokenId) => {
        setTestingId(tokenId);
        setTestResult(null);
        try {
            const tokenData = await api.request(`/api/admin/db-tokens/${tokenId}`, { skipDbToken: true });
            
            if (!tokenData || !tokenData.token) {
                setTestResult({ success: false, tokenId, message: 'Token-Daten nicht gefunden' });
                toast.error('Token-Daten nicht gefunden');
                return;
            }
            
            const result = await api.request('/api/admin/db-tokens/test', {
                method: 'POST',
                skipDbToken: true,
                body: JSON.stringify({ token: tokenData.token })
            });
            
            if (result && result.success) {
                const msg = `Verbindung OK: ${result.host}/${result.database}`;
                setTestResult({ success: true, tokenId, message: msg });
                toast.success(msg);
            } else {
                const msg = result?.error || 'Verbindung fehlgeschlagen';
                setTestResult({ success: false, tokenId, message: msg });
                toast.error(msg);
            }
        } catch (err) {
            const msg = 'Test fehlgeschlagen: ' + (err.message || 'Unbekannter Fehler');
            setTestResult({ success: false, tokenId, message: msg });
            toast.error(msg);
        } finally {
            setTestingId(null);
        }
    };
    
    // Test connection with form data
    const testFormConnection = async () => {
        setTestingId('form');
        try {
            const result = await api.request('/api/admin/db-tokens/test', {
                method: 'POST',
                skipDbToken: true,
                body: JSON.stringify({
                    credentials: {
                        host: formData.host,
                        user: formData.user,
                        password: formData.password,
                        database: formData.database,
                        port: formData.port
                    }
                })
            });
            
            if (result.success) {
                toast.success(`Verbindung erfolgreich zu ${result.host}/${result.database}`);
            } else {
                toast.error(result.error || 'Verbindung fehlgeschlagen');
            }
        } catch (err) {
            toast.error('Test fehlgeschlagen: ' + err.message);
        } finally {
            setTestingId(null);
        }
    };
    
    const resetForm = () => {
        setFormData({
            name: '',
            description: '',
            host: '',
            user: '',
            password: '',
            database: '',
            port: '3306',
            ssl: false
        });
        setCheckDbStatus(null);
    };
    
    // Check if database exists and is empty
    const checkDatabase = async () => {
        if (!formData.host || !formData.user || !formData.database) {
            toast.error('Host, Benutzer und Datenbank-Name erforderlich');
            return;
        }
        setCheckingDb(true);
        setCheckDbStatus(null);
        try {
            const result = await api.request('/api/admin/db-tokens/check-database', {
                method: 'POST',
                skipDbToken: true,
                body: JSON.stringify({
                    credentials: {
                        host: formData.host,
                        user: formData.user,
                        password: formData.password,
                        port: formData.port,
                    },
                    database: formData.database,
                }),
            });
            setCheckDbStatus(result);
            if (result.exists && result.empty) {
                toast.success(`Datenbank "${formData.database}" existiert und ist leer.`);
            } else if (result.exists) {
                toast.info(`Datenbank "${formData.database}" existiert mit ${result.tableCount} Tabelle(n).`);
            } else {
                toast.info(`Datenbank "${formData.database}" existiert nicht.`);
            }
        } catch (err) {
            setCheckDbStatus({ error: err.message });
            toast.error('Prüfung fehlgeschlagen: ' + err.message);
        } finally {
            setCheckingDb(false);
        }
    };
    
    // Create database
    const createDatabase = async () => {
        if (!formData.host || !formData.user || !formData.database) {
            toast.error('Host, Benutzer und Datenbank-Name erforderlich');
            return;
        }
        setCreatingDb(true);
        try {
            const result = await api.request('/api/admin/db-tokens/create-database', {
                method: 'POST',
                skipDbToken: true,
                body: JSON.stringify({
                    credentials: {
                        host: formData.host,
                        user: formData.user,
                        password: formData.password,
                        port: formData.port,
                    },
                    database: formData.database,
                }),
            });
            toast.success(result.message || `Datenbank "${formData.database}" angelegt.`);
            // Re-check to confirm
            setCheckDbStatus({ exists: true, empty: true, tableCount: 0, database: formData.database });
        } catch (err) {
            toast.error('Fehler: ' + err.message);
        } finally {
            setCreatingDb(false);
        }
    };
    
    const openEditDialog = (token) => {
        setEditingToken(token);
        setFormData({
            name: token.name,
            description: token.description || '',
            host: token.host || '',
            user: '',
            password: '',
            database: token.db_name || '',
            port: '3306',
            ssl: false,
            updateCredentials: false
        });
    };
    
    const handleSubmit = () => {
        if (!formData.name.trim()) {
            toast.error('Name ist erforderlich');
            return;
        }
        
        if (editingToken) {
            if (formData.updateCredentials && (!formData.host || !formData.user || !formData.database)) {
                toast.error('Host, Benutzer und Datenbank sind erforderlich');
                return;
            }
            updateMutation.mutate({ id: editingToken.id, data: formData });
        } else {
            if (!formData.host || !formData.user || !formData.database) {
                toast.error('Host, Benutzer und Datenbank sind erforderlich');
                return;
            }
            createMutation.mutate(formData);
        }
    };
    
    const handleDelete = (token) => {
        if (window.confirm(`Token "${token.name}" wirklich löschen?`)) {
            deleteMutation.mutate(token.id);
        }
    };
    
    const copyTokenToClipboard = async (tokenId) => {
        try {
            const tokenData = await api.request(`/api/admin/db-tokens/${tokenId}`, { skipDbToken: true });
            await navigator.clipboard.writeText(tokenData.token);
            toast.success('Token in Zwischenablage kopiert');
        } catch (err) {
            toast.error('Fehler beim Kopieren: ' + err.message);
        }
    };
    
    // Migration status query
    const { data: migrationStatus, refetch: refetchMigrations } = useQuery({
        queryKey: ['migrationStatus'],
        queryFn: async () => {
            try {
                return await api.request('/api/admin/migration-status', { skipDbToken: true });
            } catch (e) {
                console.error('Failed to load migration status:', e);
                return { migrations: [], allApplied: true };
            }
        },
        staleTime: 30000
    });
    
    // Run migrations mutation
    const runMigrationsMutation = useMutation({
        mutationFn: async () => {
            return await api.request('/api/admin/run-migrations', { method: 'POST', skipDbToken: true });
        },
        onSuccess: (data) => {
            refetchMigrations();
            const successCount = data.results.filter(r => r.status === 'success').length;
            const skippedCount = data.results.filter(r => r.status === 'skipped').length;
            if (successCount > 0) {
                toast.success(`${successCount} Migration(en) erfolgreich ausgeführt`);
            } else if (skippedCount > 0) {
                toast.info('Alle Migrationen bereits angewendet');
            }
        },
        onError: (err) => {
            toast.error('Fehler: ' + err.message);
        }
    });
    
    const activeToken = tokens.find(t => t.is_active);
    const pendingMigrations = migrationStatus?.migrations?.filter(m => !m.applied) || [];
    
    return (
        <Card>
            <CardHeader>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Server className="w-6 h-6 text-indigo-600" />
                        <div>
                            <CardTitle>Mandanten-Datenbanken</CardTitle>
                            <CardDescription>
                                Zentral verwaltete Datenbankverbindungen - verfügbar auf allen Arbeitsplätzen
                            </CardDescription>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" onClick={() => refetch()}>
                            <RefreshCw className="w-4 h-4 mr-1" />
                            Aktualisieren
                        </Button>
                        <Button onClick={() => { resetForm(); setShowAddDialog(true); }}>
                            <Plus className="w-4 h-4 mr-1" />
                            Neue Verbindung
                        </Button>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                {/* Status Bar */}
                <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border">
                    <div className="flex items-center gap-2">
                        {activeToken ? (
                            <>
                                <Power className="w-5 h-5 text-green-600" />
                                <span className="font-medium">Aktiv: {activeToken.name}</span>
                                <Badge variant="outline" className="bg-green-50 text-green-700">
                                    {activeToken.host}/{activeToken.db_name}
                                </Badge>
                            </>
                        ) : (
                            <>
                                <Database className="w-5 h-5 text-slate-500" />
                                <span className="text-slate-600">Standard-Datenbank aktiv</span>
                            </>
                        )}
                    </div>
                    {activeToken && (
                        <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => deactivateMutation.mutate()}
                            disabled={deactivateMutation.isPending}
                        >
                            <PowerOff className="w-4 h-4 mr-1" />
                            Deaktivieren
                        </Button>
                    )}
                </div>
                
                {/* Database Migrations */}
                {pendingMigrations.length > 0 && (
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <AlertTriangle className="w-5 h-5 text-amber-600" />
                                <div>
                                    <span className="font-medium text-amber-800">
                                        {pendingMigrations.length} ausstehende Migration(en)
                                    </span>
                                    <p className="text-xs text-amber-600">
                                        {pendingMigrations.map(m => m.description).join(', ')}
                                    </p>
                                </div>
                            </div>
                            <Button 
                                size="sm"
                                onClick={() => runMigrationsMutation.mutate()}
                                disabled={runMigrationsMutation.isPending}
                                className="bg-amber-600 hover:bg-amber-700"
                            >
                                {runMigrationsMutation.isPending ? (
                                    <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                                ) : (
                                    <Database className="w-4 h-4 mr-1" />
                                )}
                                Migrationen ausführen
                            </Button>
                        </div>
                    </div>
                )}
                
                {migrationStatus && pendingMigrations.length === 0 && (
                    <div className="p-2 bg-green-50 border border-green-200 rounded-lg">
                        <div className="flex items-center gap-2 text-green-700 text-sm">
                            <Check className="w-4 h-4" />
                            <span>Datenbank-Schema ist aktuell</span>
                        </div>
                    </div>
                )}
                
                {/* Token List */}
                {isLoading ? (
                    <div className="flex items-center justify-center py-8">
                        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
                    </div>
                ) : tokens.length === 0 ? (
                    <div className="text-center py-8 text-slate-500">
                        <Database className="w-12 h-12 mx-auto mb-3 opacity-30" />
                        <p>Keine Mandanten-Verbindungen konfiguriert</p>
                        <p className="text-sm mt-1">Erstellen Sie eine neue Verbindung, um Mandanten zu verwalten</p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {tokens.map(token => (
                            <div 
                                key={token.id}
                                className={`p-3 rounded-lg border ${
                                    token.is_active ? 'bg-green-50 border-green-200' : 'bg-white hover:bg-slate-50'
                                }`}
                            >
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <Building2 className={`w-5 h-5 ${token.is_active ? 'text-green-600' : 'text-slate-400'}`} />
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <span className="font-medium">{token.name}</span>
                                                {token.is_active && (
                                                    <Badge className="bg-green-600">Aktiv</Badge>
                                                )}
                                            </div>
                                            <div className="text-sm text-slate-500">
                                                {token.host}/{token.db_name}
                                                {token.description && <span className="ml-2 italic">- {token.description}</span>}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => testConnection(token.id)}
                                            disabled={testingId === token.id}
                                            title="Verbindung testen"
                                        >
                                            {testingId === token.id ? (
                                                <Loader2 className="w-4 h-4 animate-spin" />
                                            ) : (
                                                <TestTube className="w-4 h-4" />
                                            )}
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => copyTokenToClipboard(token.id)}
                                            title="Token kopieren"
                                        >
                                            <Copy className="w-4 h-4" />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => openEditDialog(token)}
                                            title="Bearbeiten"
                                        >
                                            <Edit2 className="w-4 h-4" />
                                        </Button>
                                        {!token.is_active && (
                                            <>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => activateMutation.mutate(token.id)}
                                                    disabled={activateMutation.isPending}
                                                    title="Aktivieren"
                                                    className="text-green-600 hover:text-green-700 hover:bg-green-50"
                                                >
                                                    <Power className="w-4 h-4" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => handleDelete(token)}
                                                    disabled={deleteMutation.isPending}
                                                    title="Löschen"
                                                    className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </Button>
                                            </>
                                        )}
                                    </div>
                                </div>
                                {/* Test result feedback - inline display */}
                                {testResult && testResult.tokenId === token.id && (
                                    <div className={`mt-2 p-2 rounded text-sm flex items-center gap-2 ${
                                        testResult.success 
                                            ? 'bg-green-100 text-green-800 border border-green-300' 
                                            : 'bg-red-100 text-red-800 border border-red-300'
                                    }`}>
                                        {testResult.success ? (
                                            <Check className="w-4 h-4" />
                                        ) : (
                                            <X className="w-4 h-4" />
                                        )}
                                        {testResult.message}
                                        <Button 
                                            variant="ghost" 
                                            size="sm" 
                                            className="ml-auto h-6 w-6 p-0"
                                            onClick={() => setTestResult(null)}
                                        >
                                            <X className="w-3 h-3" />
                                        </Button>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
                
                {/* Info Box */}
                <div className="flex items-start gap-2 p-3 bg-blue-50 rounded-lg text-sm text-blue-800">
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                    <div>
                        <strong>Hinweis:</strong> Diese Tokens werden zentral auf dem Server gespeichert und sind 
                        von allen Arbeitsplätzen aus verfügbar. Nach dem Aktivieren eines Tokens wird die 
                        Seite neu geladen, um alle Daten aus der gewählten Datenbank zu laden.
                    </div>
                </div>
            </CardContent>
            
            {/* Add/Edit Dialog */}
            <Dialog open={showAddDialog || !!editingToken} onOpenChange={(open) => {
                if (!open) {
                    setShowAddDialog(false);
                    setEditingToken(null);
                    resetForm();
                }
            }}>
                <DialogContent className="flex flex-col max-h-[85vh] !gap-0 p-0 max-w-lg">
                    <DialogHeader className="shrink-0 px-6 pt-6 pb-0">
                        <DialogTitle>
                            {editingToken ? 'Verbindung bearbeiten' : 'Neue Datenbankverbindung'}
                        </DialogTitle>
                        <DialogDescription>
                            {editingToken 
                                ? 'Ändern Sie die Verbindungsdetails. Lassen Sie die Zugangsdaten leer, um sie beizubehalten.'
                                : 'Geben Sie die Verbindungsdaten für die Mandanten-Datenbank ein.'
                            }
                        </DialogDescription>
                    </DialogHeader>
                    
                    <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
                        <div className="space-y-1">
                            <Label htmlFor="name" className="text-xs">Name / Bezeichnung *</Label>
                            <Input
                                id="name"
                                value={formData.name}
                                onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
                                placeholder="z.B. Klinik Süd Rostock"
                                className="h-8 text-xs"
                            />
                        </div>
                        
                        <div className="space-y-1">
                            <Label htmlFor="description" className="text-xs">Beschreibung</Label>
                            <Textarea
                                id="description"
                                value={formData.description}
                                onChange={e => setFormData(prev => ({ ...prev, description: e.target.value }))}
                                placeholder="Optionale Beschreibung..."
                                rows={1}
                                className="text-xs"
                            />
                        </div>
                        
                        {editingToken && (
                            <div className="flex items-center gap-2 p-2 bg-amber-50 rounded-lg text-xs">
                                <Switch
                                    checked={formData.updateCredentials}
                                    onCheckedChange={checked => setFormData(prev => ({ ...prev, updateCredentials: checked }))}
                                    className="scale-75"
                                />
                                <Label className="text-xs">Zugangsdaten aktualisieren</Label>
                            </div>
                        )}
                        
                        {(!editingToken || formData.updateCredentials) && (
                            <>
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1">
                                        <Label htmlFor="host" className="text-xs">Host *</Label>
                                        <Input
                                            id="host"
                                            value={formData.host}
                                            onChange={e => setFormData(prev => ({ ...prev, host: e.target.value }))}
                                            placeholder="mysql.railway.app"
                                            className="h-8 text-xs"
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <Label htmlFor="port" className="text-xs">Port</Label>
                                        <Input
                                            id="port"
                                            value={formData.port}
                                            onChange={e => setFormData(prev => ({ ...prev, port: e.target.value }))}
                                            placeholder="3306"
                                            className="h-8 text-xs"
                                        />
                                    </div>
                                </div>
                                
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1">
                                        <Label htmlFor="user" className="text-xs">Benutzer *</Label>
                                        <Input
                                            id="user"
                                            value={formData.user}
                                            onChange={e => setFormData(prev => ({ ...prev, user: e.target.value }))}
                                            placeholder="root"
                                            className="h-8 text-xs"
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <Label htmlFor="password" className="text-xs">Passwort</Label>
                                        <Input
                                            id="password"
                                            type="password"
                                            value={formData.password}
                                            onChange={e => setFormData(prev => ({ ...prev, password: e.target.value }))}
                                            placeholder="••••••••"
                                            className="h-8 text-xs"
                                        />
                                    </div>
                                </div>
                                
                                <div className="space-y-1">
                                    <Label htmlFor="database" className="text-xs">Datenbank *</Label>
                                    <div className="flex gap-2">
                                        <Input
                                            id="database"
                                            value={formData.database}
                                            onChange={e => {
                                                setFormData(prev => ({ ...prev, database: e.target.value }));
                                                setCheckDbStatus(null); // reset check on change
                                            }}
                                            placeholder="railway"
                                            className="flex-1 h-8 text-xs"
                                        />
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={checkDatabase}
                                            disabled={checkingDb || !formData.host || !formData.user || !formData.database}
                                            className="shrink-0 h-8 text-xs"
                                        >
                                            {checkingDb ? (
                                                <Loader2 className="w-3.5 h-3.5" />
                                            ) : (
                                                <Database className="w-3.5 h-3.5" />
                                            )}
                                            <span className="ml-1">Prüfen</span>
                                        </Button>
                                    </div>
                                    {checkDbStatus && !checkDbStatus.error && (
                                        <div className={`p-1.5 rounded text-xs flex items-center gap-1.5 border ${
                                            checkDbStatus.exists && checkDbStatus.empty
                                                ? 'bg-green-50 text-green-800 border-green-300'
                                                : checkDbStatus.exists
                                                    ? 'bg-amber-50 text-amber-800 border-amber-300'
                                                    : 'bg-blue-50 text-blue-800 border-blue-300'
                                        }`}>
                                            {checkDbStatus.exists ? (
                                                checkDbStatus.empty ? (
                                                    <><Check className="w-3.5 h-3.5 shrink-0" /><span>Datenbank <strong>{formData.database}</strong> existiert und ist leer.</span></>
                                                ) : (
                                                    <><AlertTriangle className="w-3.5 h-3.5 shrink-0" /><span>Datenbank <strong>{formData.database}</strong> existiert mit <strong>{checkDbStatus.tableCount}</strong> Tabelle(n).</span></>
                                                )
                                            ) : (
                                                <><Database className="w-3.5 h-3.5 shrink-0" /><span>Datenbank <strong>{formData.database}</strong> existiert noch nicht.</span></>
                                            )}
                                        </div>
                                    )}
                                    {checkDbStatus?.error && (
                                        <div className="p-1.5 rounded text-xs flex items-center gap-1.5 border bg-red-50 text-red-800 border-red-300">
                                            <X className="w-3.5 h-3.5 shrink-0" />
                                            <span>Prüfung fehlgeschlagen: {checkDbStatus.error}</span>
                                        </div>
                                    )}
                                    {checkDbStatus && !checkDbStatus.exists && !checkDbStatus.error && (
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={createDatabase}
                                            disabled={creatingDb}
                                            className="w-full text-xs h-8"
                                        >
                                            {creatingDb ? (
                                                <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                                            ) : (
                                                <Plus className="w-3.5 h-3.5 mr-1" />
                                            )}
                                            Datenbank "{formData.database}" jetzt anlegen
                                        </Button>
                                    )}
                                </div>
                                
                                <div className="flex items-center gap-2 text-xs">
                                    <Switch
                                        id="ssl"
                                        checked={formData.ssl}
                                        onCheckedChange={checked => setFormData(prev => ({ ...prev, ssl: checked }))}
                                        className="scale-75"
                                    />
                                    <Label htmlFor="ssl" className="text-xs">SSL-Verbindung verwenden</Label>
                                </div>
                            </>
                        )}
                    </div>
                    
                    <DialogFooter className="shrink-0 border-t px-6 py-3 gap-2">
                        {(!editingToken || formData.updateCredentials) && (
                            <Button
                                variant="outline"
                                onClick={testFormConnection}
                                disabled={testingId === 'form' || !formData.host || !formData.user || !formData.database}
                            >
                                {testingId === 'form' ? (
                                    <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                                ) : (
                                    <TestTube className="w-4 h-4 mr-1" />
                                )}
                                Testen
                            </Button>
                        )}
                        <Button
                            variant="outline"
                            onClick={() => {
                                setShowAddDialog(false);
                                setEditingToken(null);
                                resetForm();
                            }}
                        >
                            Abbrechen
                        </Button>
                        <Button
                            onClick={handleSubmit}
                            disabled={createMutation.isPending || updateMutation.isPending}
                        >
                            {(createMutation.isPending || updateMutation.isPending) && (
                                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                            )}
                            {editingToken ? 'Speichern' : 'Erstellen'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    );
}
