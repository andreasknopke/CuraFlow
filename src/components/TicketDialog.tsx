import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Bug, Lightbulb, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { reportBug, requestFeature } from '@/lib/ticketService';
import { useAuth } from '@/components/AuthProvider';

function resolveUserName(user) {
  const explicitUserName = user?.username || user?.preferred_username || user?.name || '';
  if (explicitUserName && explicitUserName.trim()) {
    return explicitUserName.trim();
  }

  if (user?.email && user.email.includes('@')) {
    return user.email.split('@')[0].trim();
  }

  return user?.email?.trim() || undefined;
}

/**
 * Dialog zum Erstellen von Bug-Reports und Feature-Requests
 * Öffnet direkt einen Dialog im CuraFlow-Design.
 * System-, Nutzer- und Mandanten-Informationen werden automatisch übermittelt.
 */
export default function TicketDialog({ open, onOpenChange, initialType = 'bug', initialError = null }) {
  const { user } = useAuth();
  const [type, setType] = useState(initialType || 'bug');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState('form'); // form | success | error
  const [resultMessage, setResultMessage] = useState('');

  // Bei Fehler (Crash) Vorbefüllung
  React.useEffect(() => {
    if (initialError) {
      setType('bug');
      setTitle(initialError.message || 'Automatischer Crash-Report');
      setDescription(
        `Ein unerwarteter Fehler ist aufgetreten:\n\n` +
        `Fehler: ${initialError.message || 'Unbekannter Fehler'}\n` +
        `Stack Trace:\n${initialError.stack || 'Nicht verfügbar'}\n\n` +
        `Bitte beschreiben Sie, was Sie vor dem Fehler getan haben:`
      );
    }
  }, [initialError]);

  // E-Mail aus aktuellem Benutzerkontext vorbefüllen
  React.useEffect(() => {
    if (user?.email) {
      setContactEmail(user.email);
    }
  }, [user?.email]);

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setStatus('form');
    setResultMessage('');
  };

  const handleClose = () => {
    resetForm();
    onOpenChange(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;

    setIsSubmitting(true);
    setStatus('form');

    try {
      const resolvedUserName = resolveUserName(user);
      const ticketOptions = {
        contactEmail: contactEmail.trim() || user?.email || undefined,
        reporterEmail: user?.email || contactEmail.trim() || undefined,
        reporterName: user?.full_name || resolvedUserName || user?.email || undefined,
        userName: resolvedUserName,
        reporterId: user?.id || undefined,
      };

      if (type === 'bug') {
        await reportBug(title.trim(), description.trim(), ticketOptions);
      } else {
        await requestFeature(title.trim(), description.trim(), ticketOptions);
      }

      setStatus('success');
      setResultMessage(
        type === 'bug'
          ? 'Bug-Report erfolgreich übermittelt! Vielen Dank für Ihre Mithilfe.'
          : 'Feature-Wunsch erfolgreich übermittelt! Vielen Dank für Ihren Vorschlag.'
      );
    } catch (error) {
      setStatus('error');
      setResultMessage(
        `Fehler bei der Übermittlung: ${error.message}\n\n` +
        'Bitte versuchen Sie es später erneut oder wenden Sie sich direkt an den Support.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(open) => { if (!open) handleClose(); }}>
      <DialogContent className="sm:max-w-lg">
        {status === 'form' && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-lg">
                {type === 'bug' ? (
                  <><Bug className="h-5 w-5 text-red-500" /> Bug melden</>
                ) : (
                  <><Lightbulb className="h-5 w-5 text-amber-500" /> Feature vorschlagen</>
                )}
              </DialogTitle>
              <DialogDescription>
                {type === 'bug'
                  ? 'Beschreiben Sie den Fehler möglichst genau. System- und Nutzerinformationen werden automatisch übermittelt.'
                  : 'Beschreiben Sie Ihren Verbesserungsvorschlag. System- und Nutzerinformationen werden automatisch übermittelt.'}
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Typ-Auswahl */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setType('bug')}
                  className={`flex-1 flex items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors ${
                    type === 'bug'
                      ? 'border-red-300 bg-red-50 text-red-700'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <Bug className="h-4 w-4" />
                  Bug
                </button>
                <button
                  type="button"
                  onClick={() => setType('feature')}
                  className={`flex-1 flex items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors ${
                    type === 'feature'
                      ? 'border-amber-300 bg-amber-50 text-amber-700'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <Lightbulb className="h-4 w-4" />
                  Feature
                </button>
              </div>

              {/* Titel */}
              <div className="space-y-1.5">
                <Label htmlFor="ticket-title">Titel *</Label>
                <Input
                  id="ticket-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={type === 'bug' ? 'Kurze Fehlerbeschreibung' : 'Kurze Beschreibung des Wunsches'}
                  required
                />
              </div>

              {/* Beschreibung */}
              <div className="space-y-1.5">
                <Label htmlFor="ticket-description">Beschreibung</Label>
                <Textarea
                  id="ticket-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={type === 'bug'
                    ? 'Schritte zum Reproduzieren:\n1. ...\n2. ...\n\nErwartetes Verhalten:\n...\n\nTatsächliches Verhalten:\n...'
                    : 'Beschreiben Sie Ihren Vorschlag möglichst detailliert...'
                  }
                  rows={5}
                />
              </div>

              {/* Kontakt-E-Mail */}
              <div className="space-y-1.5">
                <Label htmlFor="ticket-email">Kontakt-E-Mail (optional)</Label>
                <Input
                  id="ticket-email"
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  placeholder="ihre@email.de"
                />
                <p className="text-xs text-slate-400">
                  Nur falls wir Rückfragen haben. Ansonsten wird die hinterlegte E-Mail verwendet.
                </p>
              </div>

              {/* Hinweis zu automatischen Daten */}
              <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
                <p className="font-medium mb-1">Automatisch übermittelte Daten:</p>
                <ul className="list-disc list-inside space-y-0.5">
                  <li>System: CuraFlow, Version & URL</li>
                  <li>Ihr Benutzername & E-Mail</li>
                  <li>Mandant (Tenant)</li>
                  <li>Browser & Betriebssystem</li>
                  <li>IP-Adresse (serverseitig)</li>
                </ul>
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-2">
                <Button type="button" variant="outline" onClick={handleClose}>
                  Abbrechen
                </Button>
                <Button type="submit" disabled={isSubmitting || !title.trim()}>
                  {isSubmitting ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Wird gesendet...</>
                  ) : type === 'bug' ? (
                    <><Bug className="mr-2 h-4 w-4" /> Bug melden</>
                  ) : (
                    <><Lightbulb className="mr-2 h-4 w-4" /> Feature vorschlagen</>
                  )}
                </Button>
              </div>
            </form>
          </>
        )}

        {status === 'success' && (
          <div className="py-8 text-center">
            <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-slate-900 mb-2">Erfolgreich übermittelt!</h3>
            <p className="text-sm text-slate-600 mb-6 whitespace-pre-line">{resultMessage}</p>
            <Button onClick={handleClose}>Schließen</Button>
          </div>
        )}

        {status === 'error' && (
          <div className="py-8 text-center">
            <AlertCircle className="h-16 w-16 text-red-500 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-slate-900 mb-2">Übermittlung fehlgeschlagen</h3>
            <p className="text-sm text-slate-600 mb-6 whitespace-pre-line">{resultMessage}</p>
            <div className="flex justify-center gap-3">
              <Button variant="outline" onClick={handleClose}>Schließen</Button>
              <Button onClick={() => setStatus('form')}>Erneut versuchen</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}