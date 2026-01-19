import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/components/AuthProvider';
import { CalendarDays, LogIn, ShieldCheck, Activity, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function Home() {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const handleLogin = () => {
    navigate(createPageUrl('AuthLogin'));
  };

  const handleScheduleClick = (e) => {
    if (!isAuthenticated) {
        e.preventDefault();
        handleLogin();
    }
  };

  return (
    <div className="max-w-4xl mx-auto py-12 px-4">
      <div className="text-center mb-12">
        <div className="flex justify-center mb-4">
          <div className="p-4 bg-indigo-100 rounded-full">
            <Activity className="w-12 h-12 text-indigo-600" />
          </div>
        </div>
        <h1 className="text-4xl font-bold text-slate-900 mb-4">Willkommen bei CuraFlow</h1>
        <p className="text-xl text-slate-600 max-w-2xl mx-auto">
          Das intelligente Dienstplanungs-System für die Radiologie.
          Effiziente Planung, transparente Übersichten und KI-gestützte Optimierung.
        </p>
      </div>

      <div className="grid md:grid-cols-1 gap-8 max-w-xl mx-auto">
        <Card className="border-2 border-indigo-100 hover:border-indigo-300 transition-all cursor-pointer hover:shadow-md group">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-indigo-700">
              {isAuthenticated ? <CalendarDays className="w-6 h-6" /> : <LogIn className="w-6 h-6" />}
              {isAuthenticated ? 'Zum Dienstplan' : 'Anmelden'}
            </CardTitle>
            <CardDescription>
              {isAuthenticated ? 'Wochenplan und Verwaltung öffnen' : 'Login für Mitarbeiter und Verwaltung'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-slate-600 mb-6">
              {isAuthenticated 
                ? 'Sie sind angemeldet. Klicken Sie hier, um zum Hauptmenü zu gelangen.'
                : 'Bitte melden Sie sich an, um Zugriff auf den Dienstplan zu erhalten. Administratoren haben Schreibzugriff, Mitarbeiter erhalten Lesezugriff.'}
            </p>
            <Link to={createPageUrl('Schedule')} onClick={handleScheduleClick}>
              <Button className="w-full bg-indigo-600 group-hover:bg-indigo-700">
                {isAuthenticated ? 'Dienstplan öffnen' : 'Jetzt anmelden'}
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}