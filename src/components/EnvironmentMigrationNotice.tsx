import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertTriangle, ExternalLink } from 'lucide-react';
import { isTestEnvironmentOrigin, PRODUCTION_ENVIRONMENT_URL } from '@/lib/environment';

export default function EnvironmentMigrationNotice() {
  if (!isTestEnvironmentOrigin()) {
    return null;
  }

  return (
    <div className="space-y-3 rounded-2xl border-2 border-amber-300 bg-gradient-to-br from-amber-50 via-orange-50 to-red-50 p-5 text-left shadow-sm">
      <div className="inline-flex rounded-full bg-red-600 px-3 py-1 text-xs font-bold uppercase tracking-[0.2em] text-white">
        Test-Umgebung
      </div>
      <div>
        <p className="text-3xl font-black uppercase tracking-wide text-red-700">Test-Umgebung</p>
        <p className="mt-2 text-sm font-medium text-slate-700">
          Sie befinden sich hier nicht in der Produktivumgebung.
        </p>
      </div>
      <Alert className="border-red-200 bg-white/90 text-left">
        <AlertTriangle className="h-5 w-5 text-red-600" />
        <AlertTitle className="text-red-700">Produktivumgebung verwenden</AlertTitle>
        <AlertDescription className="space-y-2 text-slate-700">
          <p>
            Die Produktivumgebung finden Sie unter{' '}
            <a
              href={PRODUCTION_ENVIRONMENT_URL}
              className="font-semibold text-red-700 underline underline-offset-2 hover:text-red-800"
            >
              https://cf.coolify.kliniksued-rostock.de/
            </a>
            .
          </p>
          <p className="font-medium">
            Bitte aktualisieren Sie jetzt Ihre gespeicherten Links und Lesezeichen auf diese
            Adresse.
          </p>
          <a
            href={PRODUCTION_ENVIRONMENT_URL}
            className="inline-flex items-center gap-2 rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700"
          >
            Produktivumgebung öffnen
            <ExternalLink className="h-4 w-4" />
          </a>
        </AlertDescription>
      </Alert>
    </div>
  );
}
