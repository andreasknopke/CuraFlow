import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { db } from '@/api/client';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Award, User, Check, X, Shield } from 'lucide-react';
import { useQualifications, useAllDoctorQualifications } from '@/hooks/useQualifications';

/**
 * Übersichts-Matrix: Welcher Mitarbeiter hat welche Qualifikation.
 * Wird als Tab im Team-Modul angezeigt.
 */
export default function QualificationOverview({ doctors = [] }) {
    const { qualifications, qualificationMap, isLoading: qualsLoading } = useQualifications();
    const { allDoctorQualifications, byDoctor, isLoading: dqLoading } = useAllDoctorQualifications();

    const activeQuals = qualifications.filter(q => q.is_active !== false);
    const isLoading = qualsLoading || dqLoading;

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-32 text-slate-400">
                Wird geladen...
            </div>
        );
    }

    if (activeQuals.length === 0) {
        return (
            <Card>
                <CardContent className="py-12 text-center text-slate-500">
                    <Award className="w-12 h-12 mx-auto mb-4 opacity-20" />
                    <h3 className="font-semibold text-lg mb-2">Noch keine Qualifikationen angelegt</h3>
                    <p className="text-sm">
                        Verwenden Sie den <Shield className="w-4 h-4 inline" /> Qualifikations-Manager oben rechts, um Qualifikationen anzulegen.
                    </p>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card>
            <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                    <Award className="w-5 h-5" />
                    Qualifikations-Matrix
                </CardTitle>
                <p className="text-sm text-slate-500">
                    Übersicht aller Qualifikationen und ihrer Zuordnung zu Teammitgliedern.
                </p>
            </CardHeader>
            <CardContent>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b">
                                <th className="text-left py-2 px-3 font-medium text-slate-600 sticky left-0 bg-white min-w-[180px]">
                                    Mitarbeiter
                                </th>
                                {activeQuals.map(qual => (
                                    <th key={qual.id} className="text-center py-2 px-2 font-medium min-w-[80px]">
                                        <div className="flex flex-col items-center gap-1">
                                            <Badge
                                                style={{ 
                                                    backgroundColor: qual.color_bg || '#e0e7ff', 
                                                    color: qual.color_text || '#3730a3' 
                                                }}
                                                className="border-0 text-[10px]"
                                            >
                                                {qual.short_label || qual.name.substring(0, 3).toUpperCase()}
                                            </Badge>
                                            <span className="text-[10px] text-slate-500 font-normal whitespace-nowrap">
                                                {qual.name}
                                            </span>
                                        </div>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {doctors.map(doctor => {
                                const doctorQualIds = (byDoctor[doctor.id] || []).map(dq => dq.qualification_id);
                                return (
                                    <tr key={doctor.id} className="border-b hover:bg-slate-50">
                                        <td className="py-2 px-3 sticky left-0 bg-white">
                                            <div className="flex items-center gap-2">
                                                <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-600 flex-shrink-0">
                                                    {doctor.initials || <User className="w-3 h-3" />}
                                                </div>
                                                <div>
                                                    <div className="font-medium text-slate-900 text-sm">{doctor.name}</div>
                                                    <div className="text-[10px] text-slate-400">{doctor.role}</div>
                                                </div>
                                            </div>
                                        </td>
                                        {activeQuals.map(qual => {
                                            const hasQual = doctorQualIds.includes(qual.id);
                                            return (
                                                <td key={qual.id} className="text-center py-2 px-2">
                                                    {hasQual ? (
                                                        <Check className="w-4 h-4 text-green-600 mx-auto" />
                                                    ) : (
                                                        <X className="w-4 h-4 text-slate-200 mx-auto" />
                                                    )}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                );
                            })}
                        </tbody>
                        {/* Footer: Count per qualification */}
                        <tfoot>
                            <tr className="border-t bg-slate-50">
                                <td className="py-2 px-3 text-xs font-semibold text-slate-500 sticky left-0 bg-slate-50">
                                    Gesamt
                                </td>
                                {activeQuals.map(qual => {
                                    const count = doctors.filter(doc => {
                                        const dqIds = (byDoctor[doc.id] || []).map(dq => dq.qualification_id);
                                        return dqIds.includes(qual.id);
                                    }).length;
                                    return (
                                        <td key={qual.id} className="text-center py-2 px-2 text-xs font-semibold text-slate-600">
                                            {count}/{doctors.length}
                                        </td>
                                    );
                                })}
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </CardContent>
        </Card>
    );
}
