import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { db } from '@/api/client';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Shield, AlertTriangle, Ban } from 'lucide-react';
import { useQualifications } from '@/hooks/useQualifications';

/**
 * Editor zum Zuweisen von Qualifikationsanforderungen an einen Arbeitsplatz/Dienst.
 * Wird in der WorkplaceConfigDialog eingebettet.
 */
export default function WorkplaceQualificationEditor({ workplaceId }) {
    const queryClient = useQueryClient();
    const { qualifications, isLoading: qualsLoading } = useQualifications();

    const { data: workplaceQuals = [], isLoading: wqLoading } = useQuery({
        queryKey: ['workplaceQualifications', workplaceId],
        queryFn: () => db.WorkplaceQualification.filter({ workplace_id: workplaceId }),
        enabled: !!workplaceId,
    });

    const assignMutation = useMutation({
        mutationFn: (data) => db.WorkplaceQualification.create({
            workplace_id: workplaceId,
            ...data,
        }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['workplaceQualifications', workplaceId] });
            queryClient.invalidateQueries({ queryKey: ['allWorkplaceQualifications'] });
        },
    });

    const removeMutation = useMutation({
        mutationFn: (id) => db.WorkplaceQualification.delete(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['workplaceQualifications', workplaceId] });
            queryClient.invalidateQueries({ queryKey: ['allWorkplaceQualifications'] });
        },
    });

    const updateMutation = useMutation({
        mutationFn: ({ id, data }) => db.WorkplaceQualification.update(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['workplaceQualifications', workplaceId] });
            queryClient.invalidateQueries({ queryKey: ['allWorkplaceQualifications'] });
        },
    });

    if (!workplaceId) {
        return (
            <div className="text-xs text-slate-400 italic p-2">
                Bitte speichern Sie zuerst, um Qualifikationsanforderungen festzulegen.
            </div>
        );
    }

    const isLoading = qualsLoading || wqLoading;
    const activeQuals = qualifications.filter(q => q.is_active !== false);
    const assignedQualIds = workplaceQuals.map(wq => wq.qualification_id);

    const handleToggle = (qualId) => {
        const existingAssignment = workplaceQuals.find(wq => wq.qualification_id === qualId);
        if (existingAssignment) {
            removeMutation.mutate(existingAssignment.id);
        } else {
            assignMutation.mutate({ qualification_id: qualId, is_mandatory: true, is_excluded: false });
        }
    };

    /** Cycle through modes: Pflicht → Sollte → Sollte nicht → Nicht → Pflicht */
    const cycleMode = (wqEntry) => {
        if (!wqEntry.is_mandatory && wqEntry.is_excluded) {
            // Nicht → Pflicht
            updateMutation.mutate({ id: wqEntry.id, data: { is_mandatory: true, is_excluded: false } });
        } else if (wqEntry.is_mandatory && wqEntry.is_excluded) {
            // Sollte nicht → Nicht
            updateMutation.mutate({ id: wqEntry.id, data: { is_mandatory: false, is_excluded: true } });
        } else if (wqEntry.is_mandatory && !wqEntry.is_excluded) {
            // Pflicht → Sollte
            updateMutation.mutate({ id: wqEntry.id, data: { is_mandatory: false, is_excluded: false } });
        } else {
            // Sollte → Sollte nicht
            updateMutation.mutate({ id: wqEntry.id, data: { is_mandatory: true, is_excluded: true } });
        }
    };

    const getModeLabel = (wqEntry) => {
        if (wqEntry.is_mandatory && wqEntry.is_excluded) return 'Sollte nicht';
        if (!wqEntry.is_mandatory && wqEntry.is_excluded) return 'Nicht';
        if (wqEntry.is_mandatory) return 'Pflicht';
        return 'Sollte';
    };

    const getModeStyle = (wqEntry) => {
        if (wqEntry.is_mandatory && wqEntry.is_excluded) return 'bg-orange-100 text-orange-700 hover:bg-orange-200';
        if (!wqEntry.is_mandatory && wqEntry.is_excluded) return 'bg-slate-800 text-white hover:bg-slate-700';
        if (wqEntry.is_mandatory) return 'bg-red-100 text-red-700 hover:bg-red-200';
        return 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200';
    };

    if (isLoading) {
        return <div className="text-xs text-slate-400 p-2">Wird geladen...</div>;
    }

    if (activeQuals.length === 0) {
        return (
            <div className="text-xs text-amber-600 bg-amber-50 p-2 rounded flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" />
                Noch keine Qualifikationen angelegt. Erstellen Sie welche im Team-Modul.
            </div>
        );
    }

    return (
        <div className="space-y-2">
            <Label className="text-sm font-medium flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5" />
                Benötigte Qualifikationen
            </Label>
            <div className="text-xs text-slate-500 mb-1">
                Pflicht = Arzt muss Qualifikation besitzen. Sollte = Bevorzugt qualifiziert, aber Unqualifizierte erlaubt. Sollte nicht = Qualifizierte nur wenn kein anderer verfügbar. Nicht = Arzt mit dieser Qualifikation darf hier nicht eingeteilt werden.
            </div>
            <div className="space-y-1">
                {activeQuals.map(qual => {
                    const wqEntry = workplaceQuals.find(wq => wq.qualification_id === qual.id);
                    const isAssigned = !!wqEntry;
                    return (
                        <div 
                            key={qual.id} 
                            className="flex items-center gap-2 py-1 px-2 rounded hover:bg-slate-100 cursor-pointer"
                        >
                            <Checkbox 
                                checked={isAssigned}
                                onCheckedChange={() => handleToggle(qual.id)}
                            />
                            <Badge 
                                style={{ 
                                    backgroundColor: qual.color_bg || '#e0e7ff', 
                                    color: qual.color_text || '#3730a3' 
                                }}
                                className="border-0 text-xs"
                            >
                                {qual.short_label || qual.name.substring(0, 3).toUpperCase()}
                            </Badge>
                            <span className="text-sm flex-1">{qual.name}</span>
                            {isAssigned && (
                                <button
                                    type="button"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        cycleMode(wqEntry);
                                    }}
                                    className={`text-[10px] px-2 py-0.5 rounded-full transition-colors ${getModeStyle(wqEntry)}`}
                                >
                                    {getModeLabel(wqEntry)}
                                </button>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

/**
 * Readonly Badge-Anzeige der benötigten Qualifikationen eines Arbeitsplatzes.
 */
export function WorkplaceQualificationBadges({ workplaceId, qualificationMap, allWorkplaceQualifications }) {
    const wqEntries = allWorkplaceQualifications?.[workplaceId] || [];
    if (wqEntries.length === 0) return null;

    return (
        <div className="flex flex-wrap gap-1">
            {wqEntries.map(wq => {
                const qual = qualificationMap?.[wq.qualification_id];
                if (!qual) return null;
                const isExcluded = !wq.is_mandatory && wq.is_excluded;
                const isDiscouraged = wq.is_mandatory && wq.is_excluded;
                const prefix = isExcluded ? '⊘' : isDiscouraged ? '◇' : wq.is_mandatory ? '★' : '○';
                const modeLabel = isExcluded ? 'Nicht' : isDiscouraged ? 'Sollte nicht' : wq.is_mandatory ? 'Pflicht' : 'Sollte';
                return (
                    <Badge
                        key={wq.id}
                        style={isExcluded 
                            ? { backgroundColor: '#1e293b', color: '#fff' }
                            : isDiscouraged
                            ? { backgroundColor: '#fff7ed', color: '#c2410c' }
                            : { backgroundColor: qual.color_bg || '#e0e7ff', color: qual.color_text || '#3730a3' }
                        }
                        className={`border-0 text-[10px] px-1.5 py-0 ${!wq.is_mandatory && !isExcluded ? 'opacity-60' : ''}`}
                        title={`${modeLabel}: ${qual.name}`}
                    >
                        {prefix} {qual.short_label || qual.name.substring(0, 3).toUpperCase()}
                    </Badge>
                );
            })}
        </div>
    );
}
