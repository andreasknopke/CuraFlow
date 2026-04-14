import React from 'react';
import { Link } from 'react-router-dom';
import { useMasterAuth } from '@/master/MasterAuthProvider';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import type { LucideIcon } from 'lucide-react';
import { Shield, Users, CalendarX2, Clock, ChevronRight, CalendarDays } from 'lucide-react';

interface Section {
  path: string;
  icon: LucideIcon;
  title: string;
  description: string;
  color: string;
}

const SECTIONS: Section[] = [
  {
    path: '/mitarbeiter',
    icon: Users,
    title: 'Mitarbeiterverwaltung',
    description: 'Stammdaten, Verträge, Arbeitsmodelle – pro Mitarbeiter und Mandant',
    color: 'bg-indigo-50 text-indigo-600',
  },
  {
    path: '/fehlzeiten',
    icon: CalendarX2,
    title: 'Fehlzeiten',
    description: 'Mandantenübergreifende Übersicht aller Abwesenheiten und Urlaubstage',
    color: 'bg-emerald-50 text-emerald-600',
  },
  {
    path: '/feiertage',
    icon: CalendarDays,
    title: 'Feiertage & Ferien',
    description: 'Zentrale Verwaltung von Feiertagen und Schulferien für alle Mandanten',
    color: 'bg-red-50 text-red-600',
  },
  {
    path: '/zeiterfassung',
    icon: Clock,
    title: 'Zeiterfassung',
    description: 'Soll/Ist-Vergleich, Überstunden-Salden und Monatsabschlüsse',
    color: 'bg-blue-50 text-blue-600',
  },
];

export default function MasterDashboard() {
  const { user } = useMasterAuth();

  return (
    <div className="space-y-8">
      {/* Begrüßung */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Master-Dashboard</h1>
        <p className="text-slate-500 mt-1">
          Willkommen, {user?.full_name || user?.email}. Zentrale Personalverwaltung über alle
          Mandanten.
        </p>
      </div>

      {/* Bereichskarten */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {SECTIONS.map((section) => (
          <Link key={section.path} to={section.path} className="group">
            <Card className="h-full transition-shadow hover:shadow-md hover:border-indigo-200">
              <CardHeader className="pb-3">
                <div
                  className={`w-10 h-10 rounded-lg ${section.color} flex items-center justify-center mb-2`}
                >
                  <section.icon className="w-5 h-5" />
                </div>
                <CardTitle className="text-base flex items-center justify-between">
                  {section.title}
                  <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-indigo-500 transition-colors" />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-slate-500">{section.description}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* Hinweis zur Datenführung */}
      <Card className="border-indigo-100 bg-indigo-50/30">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2 text-indigo-900">
            <Shield className="w-5 h-5" />
            Master-Datenbank ist führend
          </CardTitle>
          <CardDescription className="text-indigo-700/70">
            Alle Änderungen in diesem Frontend werden in der zentralen Master-Datenbank gespeichert
            und automatisch an den jeweiligen Mandanten durchgereicht.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
