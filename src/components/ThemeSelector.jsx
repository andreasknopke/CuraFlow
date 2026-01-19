import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/components/AuthProvider';
import { THEMES, COLOR_PALETTES } from '@/components/themeConfig';
import { Palette, Check } from 'lucide-react';

export default function ThemeSelector({ open, onOpenChange }) {
    const { user, refreshUser } = useAuth();
    const [selectedTheme, setSelectedTheme] = useState('default');

    useEffect(() => {
        if (user?.theme) {
            setSelectedTheme(user.theme);
        }
    }, [user]);

    const handleSave = async () => {
        if (user) {
            await base44.auth.updateMe({ theme: selectedTheme });
            if (refreshUser) await refreshUser();
            onOpenChange(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Palette className="w-5 h-5" />
                        Design auswählen
                    </DialogTitle>
                </DialogHeader>
                
                <div className="grid grid-cols-2 gap-3 py-4">
                    {THEMES.map(theme => {
                        const isSelected = selectedTheme === theme.id;
                        return (
                            <div 
                                key={theme.id}
                                className={`
                                    relative flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all
                                    ${isSelected ? 'border-indigo-600 bg-indigo-50 ring-1 ring-indigo-600' : 'border-slate-200 hover:bg-slate-50'}
                                `}
                                onClick={() => setSelectedTheme(theme.id)}
                            >
                                <div className="w-8 h-8 rounded-full shadow-sm flex items-center justify-center shrink-0 overflow-hidden border border-slate-100">
                                    <div 
                                        className="w-full h-full" 
                                        style={{ 
                                            background: `linear-gradient(135deg, ${COLOR_PALETTES[theme.primary]?.[500] || '#6366f1'}, ${COLOR_PALETTES[theme.primary]?.[700] || '#4338ca'})` 
                                        }} 
                                    />
                                </div>
                                <div className="flex-1">
                                    <div className="font-medium text-sm text-slate-900">{theme.name}</div>
                                </div>
                                {isSelected && (
                                    <div className="absolute top-2 right-2 text-indigo-600">
                                        <Check className="w-4 h-4" />
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Abbrechen</Button>
                    <Button onClick={handleSave}>Speichern</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}