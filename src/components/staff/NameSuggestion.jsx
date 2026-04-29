import React from 'react';
import { Button } from '@/components/ui/button';

/**
 * Komponente zur Anzeige von Namens- und Kürzelvorschlägen nach einem Konflikt.
 * Erwartet ein suggestion-Objekt mit name und initials und einen onAccept-Callback.
 */
export default function NameSuggestion({ suggestion, onAccept }) {
  if (!suggestion) return null;

  const handleAccept = () => {
    if (onAccept) onAccept(suggestion);
  };

  return (
    <div className="mt-3 p-3 border border-blue-200 rounded-md bg-blue-50">
      <p className="text-sm font-medium text-blue-800 mb-2">
        Vorschlag zur Vermeidung des Konflikts:
      </p>
      <div className="flex items-center gap-4">
        <div>
          <span className="text-xs text-slate-600">Name: </span>
          <span className="font-mono text-sm">{suggestion.name}</span>
        </div>
        <div>
          <span className="text-xs text-slate-600">Kürzel: </span>
          <span className="font-mono text-sm">{suggestion.initials}</span>
        </div>
        <Button variant="secondary" size="sm" onClick={handleAccept}>
          Übernehmen
        </Button>
      </div>
    </div>
  );
}
