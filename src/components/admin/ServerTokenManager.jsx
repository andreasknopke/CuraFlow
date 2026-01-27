import React, { useState, useEffect } from 'react';
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
import { 
    Key, Plus, Trash2, Edit2, Check, X, Database, Power, PowerOff, 
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
            const response = await api.request('/api/admin/db-tokens');
            return response;
        },
        staleTime: 30000
    });
    
    // Create token mutation
    const createMutation = useMutation({
        mutationFn: async (data) => {
            return await api.request('/api/admin/db-tokens', {
                method: 'POST',
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
                method: 'DELETE'
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
                method: 'POST'
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
                method: 'POST'
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
    
    // Test connection
    const testConnection = async (tokenId) => {
        setTestingId(tokenId);
        setTestResult(null);
        try {
            const tokenData = await api.request(`/api/admin/db-tokens/${tokenId}`);
            
            if (!tokenData || !tokenData.token) {
                setTestResult({ success: false, tokenId, message: 'Token-Daten nicht gefunden' });
                toast.error('Token-Daten nicht gefunden');
                return;
            }
            
            const result = await api.request('/api/admin/db-tokens/test', {
                method: 'POST',
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
            const tokenData = await api.request(`/api/admin/db-tokens/${tokenId}`);
            await navigator.clipboard.writeText(tokenData.token);
            toast.success('Token in Zwischenablage kopiert');
        } catch (err) {
            toast.error('Fehler beim Kopieren: ' + err.message);
        }
    };
    
    const activeToken = tokens.find(t => t.is_active);
    
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
                <DialogContent className="max-w-lg">
                    <DialogHeader>
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
                    
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label htmlFor="name">Name / Bezeichnung *</Label>
                            <Input
                                id="name"
                                value={formData.name}
                                onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
                                placeholder="z.B. Klinik Süd Rostock"
                            />
                        </div>
                        
                        <div className="space-y-2">
                            <Label htmlFor="description">Beschreibung</Label>
                            <Textarea
                                id="description"
                                value={formData.description}
                                onChange={e => setFormData(prev => ({ ...prev, description: e.target.value }))}
                                placeholder="Optionale Beschreibung..."
                                rows={2}
                            />
                        </div>
                        
                        {editingToken && (
                            <div className="flex items-center gap-2 p-3 bg-amber-50 rounded-lg">
                                <Switch
                                    checked={formData.updateCredentials}
                                    onCheckedChange={checked => setFormData(prev => ({ ...prev, updateCredentials: checked }))}
                                />
                                <Label>Zugangsdaten aktualisieren</Label>
                            </div>
                        )}
                        
                        {(!editingToken || formData.updateCredentials) && (
                            <>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="host">Host *</Label>
                                        <Input
                                            id="host"
                                            value={formData.host}
                                            onChange={e => setFormData(prev => ({ ...prev, host: e.target.value }))}
                                            placeholder="mysql.railway.app"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="port">Port</Label>
                                        <Input
                                            id="port"
                                            value={formData.port}
                                            onChange={e => setFormData(prev => ({ ...prev, port: e.target.value }))}
                                            placeholder="3306"
                                        />
                                    </div>
                                </div>
                                
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="user">Benutzer *</Label>
                                        <Input
                                            id="user"
                                            value={formData.user}
                                            onChange={e => setFormData(prev => ({ ...prev, user: e.target.value }))}
                                            placeholder="root"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="password">Passwort</Label>
                                        <Input
                                            id="password"
                                            type="password"
                                            value={formData.password}
                                            onChange={e => setFormData(prev => ({ ...prev, password: e.target.value }))}
                                            placeholder="••••••••"
                                        />
                                    </div>
                                </div>
                                
                                <div className="space-y-2">
                                    <Label htmlFor="database">Datenbank *</Label>
                                    <Input
                                        id="database"
                                        value={formData.database}
                                        onChange={e => setFormData(prev => ({ ...prev, database: e.target.value }))}
                                        placeholder="railway"
                                    />
                                </div>
                                
                                <div className="flex items-center gap-2">
                                    <Switch
                                        id="ssl"
                                        checked={formData.ssl}
                                        onCheckedChange={checked => setFormData(prev => ({ ...prev, ssl: checked }))}
                                    />
                                    <Label htmlFor="ssl">SSL-Verbindung verwenden</Label>
                                </div>
                            </>
                        )}
                    </div>
                    
                    <DialogFooter className="gap-2">
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
