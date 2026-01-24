import React, { useState, useEffect } from 'react';
import { toast } from "sonner";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { 
    Key, Plus, Trash2, Edit2, Check, X, Database, Power, PowerOff, 
    Building2, Copy, ChevronRight, RefreshCw 
} from 'lucide-react';
import { 
    getSavedTokens, 
    saveNamedToken, 
    deleteNamedToken, 
    renameToken, 
    switchToToken, 
    getActiveTokenId,
    isDbTokenEnabled,
    enableDbToken,
    disableDbToken,
    saveDbToken,
    syncSavedTokensFromIndexedDB
} from '@/components/dbTokenStorage';

export default function TokenManager() {
    const [savedTokens, setSavedTokens] = useState([]);
    const [activeTokenId, setActiveTokenId] = useState(null);
    const [tokenEnabled, setTokenEnabled] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [editName, setEditName] = useState('');
    
    // Add new token dialog
    const [showAddDialog, setShowAddDialog] = useState(false);
    const [newTokenName, setNewTokenName] = useState('');
    const [newTokenCreds, setNewTokenCreds] = useState({ 
        host: '', 
        user: '', 
        password: '', 
        database: '', 
        port: '3306', 
        ssl: false 
    });
    
    // Load saved tokens on mount
    useEffect(() => {
        const loadTokens = async () => {
            await syncSavedTokensFromIndexedDB();
            setSavedTokens(getSavedTokens());
            setActiveTokenId(getActiveTokenId());
            setTokenEnabled(isDbTokenEnabled());
        };
        loadTokens();
    }, []);
    
    const refreshTokens = async () => {
        await syncSavedTokensFromIndexedDB();
        setSavedTokens(getSavedTokens());
        setActiveTokenId(getActiveTokenId());
        setTokenEnabled(isDbTokenEnabled());
    };
    
    const handleAddToken = async () => {
        if (!newTokenName.trim()) {
            toast.error('Bitte einen Namen eingeben');
            return;
        }
        if (!newTokenCreds.host || !newTokenCreds.user || !newTokenCreds.database) {
            toast.error('Host, Benutzer und Datenbank sind erforderlich');
            return;
        }
        
        try {
            const config = { ...newTokenCreds };
            if (config.ssl) {
                config.ssl = { rejectUnauthorized: false };
            } else {
                delete config.ssl;
            }
            const token = btoa(JSON.stringify(config));
            
            await saveNamedToken(newTokenName.trim(), token);
            
            setSavedTokens(getSavedTokens());
            setShowAddDialog(false);
            setNewTokenName('');
            setNewTokenCreds({ host: '', user: '', password: '', database: '', port: '3306', ssl: false });
            toast.success(`Token "${newTokenName}" gespeichert`);
        } catch (e) {
            toast.error('Fehler beim Speichern: ' + e.message);
        }
    };
    
    const handleDeleteToken = async (id, name) => {
        if (window.confirm(`Token "${name}" wirklich löschen?`)) {
            await deleteNamedToken(id);
            setSavedTokens(getSavedTokens());
            
            // If the active token was deleted, disable token mode
            if (activeTokenId === id) {
                await disableDbToken();
                setTokenEnabled(false);
                setActiveTokenId(null);
            }
            
            toast.success('Token gelöscht');
        }
    };
    
    const handleRename = async (id) => {
        if (!editName.trim()) {
            toast.error('Name darf nicht leer sein');
            return;
        }
        
        await renameToken(id, editName.trim());
        setSavedTokens(getSavedTokens());
        setEditingId(null);
        setEditName('');
        toast.success('Token umbenannt');
    };
    
    const handleSwitchToken = async (id) => {
        try {
            const tokenEntry = await switchToToken(id);
            setActiveTokenId(id);
            setTokenEnabled(true);
            toast.success(`Gewechselt zu "${tokenEntry.name}"`);
            
            // Reload to apply changes
            setTimeout(() => window.location.reload(), 1000);
        } catch (e) {
            toast.error('Fehler beim Wechseln: ' + e.message);
        }
    };
    
    const handleDisableToken = async () => {
        await disableDbToken();
        setTokenEnabled(false);
        toast.success('Token-Modus deaktiviert - Standard-DB wird verwendet');
        setTimeout(() => window.location.reload(), 1000);
    };
    
    const parseTokenInfo = (token) => {
        try {
            const decoded = JSON.parse(atob(token));
            return {
                host: decoded.host,
                database: decoded.database,
                user: decoded.user
            };
        } catch (e) {
            return null;
        }
    };
    
    const copyToken = (token) => {
        navigator.clipboard.writeText(token);
        toast.success('Token kopiert');
    };
    
    return (
        <Card>
            <CardHeader>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Building2 className="w-5 h-5 text-indigo-600" />
                        <CardTitle>Mandanten-Verwaltung</CardTitle>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button variant="ghost" size="icon" onClick={refreshTokens} title="Aktualisieren">
                            <RefreshCw className="w-4 h-4" />
                        </Button>
                        <Button onClick={() => setShowAddDialog(true)} size="sm">
                            <Plus className="w-4 h-4 mr-2" />
                            Neuer Mandant
                        </Button>
                    </div>
                </div>
                <CardDescription>
                    Gespeicherte Datenbankverbindungen für verschiedene Mandanten (z.B. Radiologie, Chirurgie)
                </CardDescription>
            </CardHeader>
            <CardContent>
                {/* Current Status */}
                <div className={`mb-4 p-3 rounded-lg border ${tokenEnabled ? 'bg-green-50 border-green-200' : 'bg-slate-50 border-slate-200'}`}>
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            {tokenEnabled ? (
                                <Power className="w-4 h-4 text-green-600" />
                            ) : (
                                <PowerOff className="w-4 h-4 text-slate-400" />
                            )}
                            <span className="text-sm font-medium">
                                {tokenEnabled 
                                    ? `Aktiv: ${savedTokens.find(t => t.id === activeTokenId)?.name || 'Unbekannt'}`
                                    : 'Standard-Datenbank (kein Mandant aktiv)'
                                }
                            </span>
                        </div>
                        {tokenEnabled && (
                            <Button variant="ghost" size="sm" onClick={handleDisableToken}>
                                <PowerOff className="w-4 h-4 mr-2" />
                                Deaktivieren
                            </Button>
                        )}
                    </div>
                </div>
                
                {/* Token List */}
                {savedTokens.length === 0 ? (
                    <div className="text-center py-8 text-slate-500">
                        <Database className="w-12 h-12 mx-auto mb-3 opacity-30" />
                        <p>Keine Mandanten gespeichert</p>
                        <p className="text-sm">Klicken Sie auf "Neuer Mandant" um einen hinzuzufügen</p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {savedTokens.map((tokenEntry) => {
                            const info = parseTokenInfo(tokenEntry.token);
                            const isActive = tokenEnabled && activeTokenId === tokenEntry.id;
                            const isEditing = editingId === tokenEntry.id;
                            
                            return (
                                <div 
                                    key={tokenEntry.id}
                                    className={`p-3 rounded-lg border transition-colors ${
                                        isActive 
                                            ? 'bg-indigo-50 border-indigo-200' 
                                            : 'bg-white border-slate-200 hover:border-slate-300'
                                    }`}
                                >
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3 flex-1">
                                            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                                                isActive ? 'bg-indigo-100' : 'bg-slate-100'
                                            }`}>
                                                <Key className={`w-5 h-5 ${isActive ? 'text-indigo-600' : 'text-slate-400'}`} />
                                            </div>
                                            
                                            <div className="flex-1">
                                                {isEditing ? (
                                                    <div className="flex items-center gap-2">
                                                        <Input
                                                            value={editName}
                                                            onChange={(e) => setEditName(e.target.value)}
                                                            className="h-8 w-48"
                                                            autoFocus
                                                            onKeyDown={(e) => {
                                                                if (e.key === 'Enter') handleRename(tokenEntry.id);
                                                                if (e.key === 'Escape') setEditingId(null);
                                                            }}
                                                        />
                                                        <Button 
                                                            size="icon" 
                                                            variant="ghost" 
                                                            className="h-8 w-8"
                                                            onClick={() => handleRename(tokenEntry.id)}
                                                        >
                                                            <Check className="w-4 h-4 text-green-600" />
                                                        </Button>
                                                        <Button 
                                                            size="icon" 
                                                            variant="ghost" 
                                                            className="h-8 w-8"
                                                            onClick={() => setEditingId(null)}
                                                        >
                                                            <X className="w-4 h-4 text-slate-400" />
                                                        </Button>
                                                    </div>
                                                ) : (
                                                    <>
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-medium">{tokenEntry.name}</span>
                                                            {isActive && (
                                                                <Badge variant="secondary" className="bg-indigo-100 text-indigo-700">
                                                                    Aktiv
                                                                </Badge>
                                                            )}
                                                        </div>
                                                        {info && (
                                                            <div className="text-xs text-slate-500 mt-0.5">
                                                                {info.host} / {info.database}
                                                            </div>
                                                        )}
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                        
                                        <div className="flex items-center gap-1">
                                            <Button
                                                size="icon"
                                                variant="ghost"
                                                className="h-8 w-8"
                                                onClick={() => copyToken(tokenEntry.token)}
                                                title="Token kopieren"
                                            >
                                                <Copy className="w-4 h-4 text-slate-400" />
                                            </Button>
                                            <Button
                                                size="icon"
                                                variant="ghost"
                                                className="h-8 w-8"
                                                onClick={() => {
                                                    setEditingId(tokenEntry.id);
                                                    setEditName(tokenEntry.name);
                                                }}
                                                title="Umbenennen"
                                            >
                                                <Edit2 className="w-4 h-4 text-slate-400" />
                                            </Button>
                                            <Button
                                                size="icon"
                                                variant="ghost"
                                                className="h-8 w-8 hover:text-red-600"
                                                onClick={() => handleDeleteToken(tokenEntry.id, tokenEntry.name)}
                                                title="Löschen"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </Button>
                                            {!isActive && (
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    className="ml-2"
                                                    onClick={() => handleSwitchToken(tokenEntry.id)}
                                                >
                                                    Aktivieren
                                                    <ChevronRight className="w-4 h-4 ml-1" />
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </CardContent>
            
            {/* Add Token Dialog */}
            <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Building2 className="w-5 h-5" />
                            Neuen Mandanten hinzufügen
                        </DialogTitle>
                        <DialogDescription>
                            Speichern Sie Zugangsdaten für eine weitere Datenbank
                        </DialogDescription>
                    </DialogHeader>
                    
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label>Name des Mandanten *</Label>
                            <Input
                                placeholder="z.B. Radiologie, Chirurgie, Klinik Nord..."
                                value={newTokenName}
                                onChange={(e) => setNewTokenName(e.target.value)}
                            />
                        </div>
                        
                        <div className="border-t pt-4">
                            <p className="text-sm font-medium mb-3">Datenbankverbindung</p>
                            
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-2">
                                    <Label className="text-xs">Host *</Label>
                                    <Input
                                        placeholder="db.example.com"
                                        value={newTokenCreds.host}
                                        onChange={(e) => setNewTokenCreds({...newTokenCreds, host: e.target.value})}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-xs">Port</Label>
                                    <Input
                                        placeholder="3306"
                                        value={newTokenCreds.port}
                                        onChange={(e) => setNewTokenCreds({...newTokenCreds, port: e.target.value})}
                                    />
                                </div>
                            </div>
                            
                            <div className="space-y-2 mt-3">
                                <Label className="text-xs">Datenbank *</Label>
                                <Input
                                    placeholder="curaflow"
                                    value={newTokenCreds.database}
                                    onChange={(e) => setNewTokenCreds({...newTokenCreds, database: e.target.value})}
                                />
                            </div>
                            
                            <div className="grid grid-cols-2 gap-3 mt-3">
                                <div className="space-y-2">
                                    <Label className="text-xs">Benutzer *</Label>
                                    <Input
                                        placeholder="root"
                                        value={newTokenCreds.user}
                                        onChange={(e) => setNewTokenCreds({...newTokenCreds, user: e.target.value})}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-xs">Passwort</Label>
                                    <Input
                                        type="password"
                                        placeholder="••••••••"
                                        value={newTokenCreds.password}
                                        onChange={(e) => setNewTokenCreds({...newTokenCreds, password: e.target.value})}
                                    />
                                </div>
                            </div>
                            
                            <div className="flex items-center gap-2 mt-3">
                                <input
                                    type="checkbox"
                                    id="ssl"
                                    checked={newTokenCreds.ssl}
                                    onChange={(e) => setNewTokenCreds({...newTokenCreds, ssl: e.target.checked})}
                                    className="rounded"
                                />
                                <Label htmlFor="ssl" className="text-sm cursor-pointer">SSL-Verbindung verwenden</Label>
                            </div>
                        </div>
                    </div>
                    
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowAddDialog(false)}>
                            Abbrechen
                        </Button>
                        <Button onClick={handleAddToken}>
                            <Plus className="w-4 h-4 mr-2" />
                            Speichern
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    );
}
