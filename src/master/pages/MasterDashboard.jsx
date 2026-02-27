import React from 'react';
import { useMasterAuth } from '@/master/MasterAuthProvider';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Shield } from 'lucide-react';

export default function MasterDashboard() {
  const { user } = useMasterAuth();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Master-Frontend</h1>
        <p className="text-slate-500 mt-1">
          Willkommen, {user?.full_name || user?.email}.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5" />
            In Vorbereitung
          </CardTitle>
          <CardDescription>
            Das Master-Frontend ist technisch getrennt eingerichtet und auf die Master-DB ausgerichtet.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-slate-600">
          Die fachlichen Funktionen (Zeiterfassung, konsolidierte Reports, Fehlzeiten-Management) folgen in den nächsten Schritten.
        </CardContent>
      </Card>
    </div>
  );
}
