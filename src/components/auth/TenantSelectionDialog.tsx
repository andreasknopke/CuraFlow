import { useState, useEffect, useMemo } from 'react';
import { api } from '@/api/client';
import { saveDbToken, enableDbToken, disableDbToken, getActiveTokenId } from '@/components/dbTokenStorage';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Database, Building2 } from 'lucide-react';

interface TenantSelectionDialogProps {
    open: boolean;
    onComplete: () => void;
    tenants?: any[];
    hasFullAccess?: boolean;
}

export default function TenantSelectionDialog({ open, onComplete, tenants = [], hasFullAccess = false }: TenantSelectionDialogProps) {
    const [isActivating, setIsActivating] = useState(false);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [error, setError] = useState('');

    const sortedTenants = useMemo(() => {
        const lastActiveTokenId = getActiveTokenId();
        console.log('[TenantSort] lastActiveTokenId from localStorage:', lastActiveTokenId, typeof lastActiveTokenId);
        console.log('[TenantSort] tenants:', tenants.map((t: any) => ({ id: t.id, type: typeof t.id, is_active: t.is_active, name: t.name })));
        
        return [...tenants].sort((a: any, b: any) => {
            const aWasActive = String(a.id) === String(lastActiveTokenId);
            const bWasActive = String(b.id) === String(lastActiveTokenId);
            if (aWasActive && !bWasActive) return -1;
            if (!aWasActive && bWasActive) return 1;
            if (a.is_active && !b.is_active) return -1;
            if (!a.is_active && b.is_active) return 1;
            return (a.name || '').localeCompare(b.name || '');
        });
    }, [tenants]);

    useEffect(() => {
        if (open && tenants.length === 1 && !hasFullAccess) {
            handleActivateTenant(tenants[0].id);
        }
    }, [open, tenants, hasFullAccess]);

    const handleActivateTenant = async (tokenId: string) => {
        setIsActivating(true);
        setSelectedId(tokenId);
        setError('');
        
        try {
            const result = await (api as any).activateTenant(tokenId);
            
            if (result && result.token) {
                await saveDbToken(result.token);
                await enableDbToken();
                
                localStorage.setItem('active_token_id', tokenId);
                
                onComplete();
                
                setTimeout(() => { window.location.reload(); }, 500);
            } else {
                throw new Error('Token-Aktivierung fehlgeschlagen');
            }
        } catch (err: any) {
            console.error('Tenant activation failed:', err);
            setError(err.message || 'Aktivierung fehlgeschlagen');
            setIsActivating(false);
            setSelectedId(null);
        }
    };

    const handleUseDefaultDatabase = async () => {
        setIsActivating(true);
        setSelectedId('default');
        
        try {
            await disableDbToken();
            localStorage.removeItem('active_token_id');
            
            onComplete();
            
            setTimeout(() => { window.location.reload(); }, 500);
        } catch (err: any) {
            console.error('Deactivation failed:', err);
            setError(err.message || 'Deaktivierung fehlgeschlagen');
            setIsActivating(false);
            setSelectedId(null);
        }
    };

    if (open && tenants.length === 1 && !hasFullAccess) {
        return (
            <Dialog open={open}>
                <DialogContent className="sm:max-w-md" data-testid="tenant-selection-dialog">
                    <div className="flex flex-col items-center justify-center py-8" data-testid="tenant-selection-auto-activating">
                        <Loader2 className="w-8 h-8 animate-spin text-indigo-600 mb-4" />
                        <p className="text-slate-600">Mandant wird aktiviert...</p>
                        <p className="text-sm text-slate-500 mt-2">{tenants[0]?.name}</p>
                    </div>
                </DialogContent>
            </Dialog>
        );
    }

    return (
        <Dialog open={open}>
            <DialogContent className="sm:max-w-lg" data-testid="tenant-selection-dialog">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Building2 className="w-5 h-5 text-indigo-600" />
                        Mandanten-Auswahl
                    </DialogTitle>
                    <DialogDescription>
                        Wählen Sie den Mandanten, mit dem Sie arbeiten möchten
                    </DialogDescription>
                </DialogHeader>

                {error && (
                    <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                        {error}
                    </div>
                )}

                <div className="space-y-3 max-h-80 overflow-y-auto py-2">
                    {hasFullAccess && (
                        <Card 
                            className={`p-4 cursor-pointer transition-all hover:border-indigo-300 hover:shadow-sm ${
                                selectedId === 'default' ? 'border-indigo-500 bg-indigo-50' : ''
                            }`}
                            onClick={() => !isActivating && handleUseDefaultDatabase()}
                        >
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center">
                                        <Database className="w-5 h-5 text-slate-600" />
                                    </div>
                                    <div>
                                        <p className="font-medium text-slate-900">Standard-Datenbank</p>
                                        <p className="text-sm text-slate-500">Zentrale Datenbank verwenden</p>
                                    </div>
                                </div>
                                {isActivating && selectedId === 'default' ? (
                                    <Loader2 className="w-5 h-5 animate-spin text-indigo-600" />
                                ) : (
                                    <Badge variant="outline" className="text-slate-600">Standard</Badge>
                                )}
                            </div>
                        </Card>
                    )}

                    {sortedTenants.map((tenant: any) => {
                        const lastActiveTokenId = getActiveTokenId();
                        const wasLastActive = tenant.id === lastActiveTokenId;
                        return (
                        <Card 
                            key={tenant.id}
                            data-testid={`tenant-card-${tenant.id}`}
                            className={`p-4 cursor-pointer transition-all hover:border-indigo-300 hover:shadow-sm ${
                                selectedId === tenant.id ? 'border-indigo-500 bg-indigo-50' : ''
                            } ${wasLastActive ? 'border-indigo-300' : ''}`}
                            onClick={() => !isActivating && handleActivateTenant(tenant.id)}
                        >
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-lg bg-indigo-100 flex items-center justify-center">
                                        <Building2 className="w-5 h-5 text-indigo-600" />
                                    </div>
                                    <div>
                                        <p className="font-medium text-slate-900">{tenant.name}</p>
                                        {tenant.description && (
                                            <p className="text-sm text-slate-500">{tenant.description}</p>
                                        )}
                                        <p className="text-xs text-slate-400">{tenant.host}/{tenant.db_name}</p>
                                    </div>
                                </div>
                                {isActivating && selectedId === tenant.id ? (
                                    <Loader2 className="w-5 h-5 animate-spin text-indigo-600" />
                                ) : wasLastActive ? (
                                    <Badge className="bg-green-100 text-green-800">Zuletzt aktiv</Badge>
                                ) : tenant.is_active ? (
                                    <Badge className="bg-blue-100 text-blue-800">Aktiv</Badge>
                                ) : null}
                            </div>
                        </Card>
                    );
                    })}

                    {tenants.length === 0 && !hasFullAccess && (
                        <div className="text-center py-8 text-slate-500">
                            <Database className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                            <p>Keine Mandanten verfügbar</p>
                            <p className="text-sm">Bitte kontaktieren Sie Ihren Administrator</p>
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
