import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { db } from '@/api/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Award, Check, X } from 'lucide-react';
import { useQualifications } from '@/hooks/useQualifications';

/**
 * Editor-Komponente zum Zuweisen/Entfernen von Qualifikationen für einen einzelnen Arzt.
 * Wird im DoctorForm oder als eigenständige Komponente verwendet.
 */
export default function DoctorQualificationEditor({ doctorId, compact = false }) {
    const queryClient = useQueryClient();
    const { qualifications, qualificationsByCategory, categories, isLoading: qualsLoading } = useQualifications();

    const { data: doctorQuals = [], isLoading: dqLoading } = useQuery({
        queryKey: ['doctorQualifications', doctorId],
        queryFn: () => db.DoctorQualification.filter({ doctor_id: doctorId }),
        enabled: !!doctorId,
    });

    const assignMutation = useMutation({
        mutationFn: (qualificationId) => db.DoctorQualification.create({
            doctor_id: doctorId,
            qualification_id: qualificationId,
        }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['doctorQualifications', doctorId] });
            queryClient.invalidateQueries({ queryKey: ['allDoctorQualifications'] });
        },
    });

    const removeMutation = useMutation({
        mutationFn: (dqId) => db.DoctorQualification.delete(dqId),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['doctorQualifications', doctorId] });
            queryClient.invalidateQueries({ queryKey: ['allDoctorQualifications'] });
        },
    });

    if (!doctorId) {
        return (
            <div className="text-xs text-slate-400 italic p-2">
                Bitte speichern Sie das Teammitglied zuerst, um Qualifikationen zuzuweisen.
            </div>
        );
    }

    const isLoading = qualsLoading || dqLoading;
    const assignedQualIds = doctorQuals.map(dq => dq.qualification_id);

    const handleToggle = (qualId) => {
        const existingAssignment = doctorQuals.find(dq => dq.qualification_id === qualId);
        if (existingAssignment) {
            removeMutation.mutate(existingAssignment.id);
        } else {
            assignMutation.mutate(qualId);
        }
    };

    // Active qualifications only
    const activeQuals = qualifications.filter(q => q.is_active !== false);

    if (isLoading) {
        return <div className="text-xs text-slate-400 p-2">Wird geladen...</div>;
    }

    if (activeQuals.length === 0) {
        return (
            <div className="text-xs text-slate-400 italic p-2">
                Noch keine Qualifikationen angelegt. Verwenden Sie den Qualifikations-Manager, um welche anzulegen.
            </div>
        );
    }

    if (compact) {
        // Compact: Nur Badge-Chips zum anklicken
        return (
            <div className="space-y-2">
                <Label className="text-sm font-medium flex items-center gap-1.5">
                    <Award className="w-3.5 h-3.5" />
                    Qualifikationen
                </Label>
                <div className="flex flex-wrap gap-1.5">
                    {activeQuals.map(qual => {
                        const isAssigned = assignedQualIds.includes(qual.id);
                        return (
                            <button
                                key={qual.id}
                                type="button"
                                onClick={() => handleToggle(qual.id)}
                                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all cursor-pointer ${
                                    isAssigned 
                                        ? 'ring-2 ring-offset-1 ring-indigo-400' 
                                        : 'opacity-40 hover:opacity-70'
                                }`}
                                style={{ 
                                    backgroundColor: qual.color_bg || '#e0e7ff', 
                                    color: qual.color_text || '#3730a3' 
                                }}
                                title={qual.description || qual.name}
                            >
                                {isAssigned && <Check className="w-3 h-3" />}
                                {qual.short_label || qual.name.substring(0, 3).toUpperCase()}
                            </button>
                        );
                    })}
                </div>
            </div>
        );
    }

    // Full view: grouped by category with checkboxes
    return (
        <div className="space-y-3">
            <Label className="text-sm font-medium flex items-center gap-1.5">
                <Award className="w-3.5 h-3.5" />
                Qualifikationen & Berechtigungen
            </Label>
            {categories.map(cat => {
                const catQuals = (qualificationsByCategory[cat] || []).filter(q => q.is_active !== false);
                if (catQuals.length === 0) return null;
                return (
                    <div key={cat} className="space-y-1">
                        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                            {cat}
                        </div>
                        <div className="space-y-1">
                            {catQuals.map(qual => {
                                const isAssigned = assignedQualIds.includes(qual.id);
                                return (
                                    <div 
                                        key={qual.id} 
                                        className="flex items-center gap-2.5 py-1 px-2 rounded hover:bg-slate-50 cursor-pointer"
                                        onClick={() => handleToggle(qual.id)}
                                    >
                                        <Checkbox 
                                            checked={isAssigned}
                                            onCheckedChange={() => handleToggle(qual.id)}
                                            className="pointer-events-none"
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
                                        <span className="text-sm">{qual.name}</span>
                                        {qual.description && (
                                            <span className="text-xs text-slate-400 ml-auto hidden sm:block">
                                                {qual.description}
                                            </span>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

/**
 * Readonly Badge-Anzeige der Qualifikationen eines Arztes.
 * Für die Team-Liste und den Dienstplan.
 */
export function DoctorQualificationBadges({ doctorId, qualificationMap, allDoctorQualifications }) {
    // Get this doctor's qualification IDs
    const doctorQualIds = allDoctorQualifications
        ? (allDoctorQualifications[doctorId] || []).map(dq => dq.qualification_id)
        : [];

    if (doctorQualIds.length === 0) return null;

    return (
        <div className="flex flex-wrap gap-1">
            {doctorQualIds.map(qualId => {
                const qual = qualificationMap?.[qualId];
                if (!qual || qual.is_active === false) return null;
                return (
                    <Badge
                        key={qualId}
                        style={{ 
                            backgroundColor: qual.color_bg || '#e0e7ff', 
                            color: qual.color_text || '#3730a3' 
                        }}
                        className="border-0 text-[10px] px-1.5 py-0"
                        title={`${qual.name}${qual.description ? ': ' + qual.description : ''}`}
                    >
                        {qual.short_label || qual.name.substring(0, 3).toUpperCase()}
                    </Badge>
                );
            })}
        </div>
    );
}
