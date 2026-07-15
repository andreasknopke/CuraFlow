# Integration Reviewer

- Ticket: #92377083-89ef-4e08-9578-11f3f1c3c802 — Monatssicht berechnet soll-stunden falsch
- Stage: `integration`
- Status: `done`
- Bearbeiter: Integration-Bot (ai)
- Provider/Modell: `mistral` / `mistral-large-latest`
- Gestartet: 2026-07-14 11:29:34
- Beendet: 2026-07-14 11:30:11
- Dauer: 18883 ms

## Bericht

> System: CuraFlow (ID 1) · Repo: andreasknopke/CuraFlow

**Verdict:** `approve_with_changes`
**Empfohlener Coding-Level:** `medium`
_Die Aufgabe erfordert eine klare Trennung der Logik für monatliche vs. wöchentliche Ansichten und die korrekte Berechnung der Wochenanzahl, aber die Änderungen sind auf eine einzelne Komponente beschränkt._

Der Plan ist grundsätzlich konform mit den Projektkonventionen und der Architektur, erfordert jedoch Anpassungen zur Risikominimierung und Konventionssicherung. Die monatliche Soll-Stunden-Berechnung ist eine logische Erweiterung, aber die Implementierung muss sicherstellen, dass sie nur in monatlichen Ansichten greift und bestehende wöchentliche Logik nicht beeinträchtigt.

**MUST FOLLOW:**
- Nutze ausschließlich die Props `year` und `month` aus `StaffingPlanTable` zur Bestimmung der Wochenanzahl im Monat (keine hardcodierten Werte oder externe Abhängigkeiten).
- Erhalte die Signatur und Rückgabewerte der bestehenden `StaffingPlanTable`-Komponente unverändert (nur interne Logik anpassen).
- Führe die Berechnung der Wochenanzahl in einer separaten Hilfsfunktion innerhalb von `StaffingPlanTable.tsx` durch (z. B. `calculateWeeksInMonth`), um die Lesbarkeit und Testbarkeit zu gewährleisten.
- Stelle sicher, dass die Änderung nur in monatlichen Ansichten greift (z. B. durch Prüfung eines `viewMode`-Props oder ähnlichem, falls vorhanden).
- Beachte die Projekt-Konventionen für Datumsberechnungen (z. B. Verwendung von `date-fns` oder ähnlichen Bibliotheken, falls im Projekt etabliert).

**MUST AVOID:**
- Änderungen an `staffingUtils.ts` oder anderen Utilities (wie im Constraint vorgegeben).
- Hardcoding von Wochenanzahlen oder Annahmen über die Länge eines Monats (z. B. 4 Wochen).
- Seiteneffekte auf wöchentliche Ansichten oder andere Komponenten, die `StaffingPlanTable` verwenden.
- Direkte Manipulation von globalen Zuständen oder Kontexten außerhalb der Komponente.

**Regelverletzungen:**
- Fehlende Prüfung, ob die Komponente tatsächlich in einer monatlichen Ansicht verwendet wird (Risiko: Seiteneffekte auf wöchentliche Ansichten).
- Keine klare Trennung der Berechnungslogik in eine Hilfsfunktion (Verstoß gegen Clean-Code-Prinzipien).

**Integrations-Risiken:**
- Unbeabsichtigte Auswirkungen auf wöchentliche Ansichten, falls `StaffingPlanTable` auch dort genutzt wird und keine klare Trennung der Logik erfolgt.
- Falsche Berechnung der Wochenanzahl im Monat (z. B. durch falsche Handhabung von Schaltjahren oder Monatsgrenzen).
- Performance-Probleme bei häufigen Neuberechnungen, falls die Wochenanzahl nicht zwischengespeichert wird.

**Empfohlene Aenderungen:**
- Füge eine Prop `viewMode` (oder ähnlich) hinzu, um zwischen wöchentlichen und monatlichen Ansichten zu unterscheiden. Falls diese bereits existiert, nutze sie zur Steuerung der Logik.
- Extrahiere die Berechnung der Wochenanzahl in eine separate Funktion `calculateWeeksInMonth(year: number, month: number): number` und teste sie isoliert.
- Füge Kommentare hinzu, die die neue Logik und ihre Abhängigkeiten dokumentieren (z. B. `// Monthly target hours = weekly target * weeks in month`).
- Prüfe, ob die Komponente bereits eine `monthly`- oder `weekly`-Prop verwendet, und nutze diese zur Steuerung der Logik.

## Vollstaendiges Output-Payload

```json
{
  "verdict": "approve_with_changes",
  "rationale": "Der Plan ist grundsätzlich konform mit den Projektkonventionen und der Architektur, erfordert jedoch Anpassungen zur Risikominimierung und Konventionssicherung. Die monatliche Soll-Stunden-Berechnung ist eine logische Erweiterung, aber die Implementierung muss sicherstellen, dass sie nur in monatlichen Ansichten greift und bestehende wöchentliche Logik nicht beeinträchtigt.",
  "must_follow": [
    "Nutze ausschließlich die Props `year` und `month` aus `StaffingPlanTable` zur Bestimmung der Wochenanzahl im Monat (keine hardcodierten Werte oder externe Abhängigkeiten).",
    "Erhalte die Signatur und Rückgabewerte der bestehenden `StaffingPlanTable`-Komponente unverändert (nur interne Logik anpassen).",
    "Führe die Berechnung der Wochenanzahl in einer separaten Hilfsfunktion innerhalb von `StaffingPlanTable.tsx` durch (z. B. `calculateWeeksInMonth`), um die Lesbarkeit und Testbarkeit zu gewährleisten.",
    "Stelle sicher, dass die Änderung nur in monatlichen Ansichten greift (z. B. durch Prüfung eines `viewMode`-Props oder ähnlichem, falls vorhanden).",
    "Beachte die Projekt-Konventionen für Datumsberechnungen (z. B. Verwendung von `date-fns` oder ähnlichen Bibliotheken, falls im Projekt etabliert)."
  ],
  "must_avoid": [
    "Änderungen an `staffingUtils.ts` oder anderen Utilities (wie im Constraint vorgegeben).",
    "Hardcoding von Wochenanzahlen oder Annahmen über die Länge eines Monats (z. B. 4 Wochen).",
    "Seiteneffekte auf wöchentliche Ansichten oder andere Komponenten, die `StaffingPlanTable` verwenden.",
    "Direkte Manipulation von globalen Zuständen oder Kontexten außerhalb der Komponente."
  ],
  "doc_references": [
    "docs/architecture.md:section-staffing-components",
    "docs/conventions.md:section-date-handling",
    "src/components/staff/README.md"
  ],
  "rule_violations": [
    "Fehlende Prüfung, ob die Komponente tatsächlich in einer monatlichen Ansicht verwendet wird (Risiko: Seiteneffekte auf wöchentliche Ansichten).",
    "Keine klare Trennung der Berechnungslogik in eine Hilfsfunktion (Verstoß gegen Clean-Code-Prinzipien)."
  ],
  "integration_risks": [
    "Unbeabsichtigte Auswirkungen auf wöchentliche Ansichten, falls `StaffingPlanTable` auch dort genutzt wird und keine klare Trennung der Logik erfolgt.",
    "Falsche Berechnung der Wochenanzahl im Monat (z. B. durch falsche Handhabung von Schaltjahren oder Monatsgrenzen).",
    "Performance-Probleme bei häufigen Neuberechnungen, falls die Wochenanzahl nicht zwischengespeichert wird."
  ],
  "recommended_changes": [
    "Füge eine Prop `viewMode` (oder ähnlich) hinzu, um zwischen wöchentlichen und monatlichen Ansichten zu unterscheiden. Falls diese bereits existiert, nutze sie zur Steuerung der Logik.",
    "Extrahiere die Berechnung der Wochenanzahl in eine separate Funktion `calculateWeeksInMonth(year: number, month: number): number` und teste sie isoliert.",
    "Füge Kommentare hinzu, die die neue Logik und ihre Abhängigkeiten dokumentieren (z. B. `// Monthly target hours = weekly target * weeks in month`).",
    "Prüfe, ob die Komponente bereits eine `monthly`- oder `weekly`-Prop verwendet, und nutze diese zur Steuerung der Logik."
  ],
  "recommended_complexity": "medium",
  "complexity_rationale": "Die Aufgabe erfordert eine klare Trennung der Logik für monatliche vs. wöchentliche Ansichten und die korrekte Berechnung der Wochenanzahl, aber die Änderungen sind auf eine einzelne Komponente beschränkt.",
  "open_questions": [],
  "markdown": "> System: CuraFlow (ID 1) · Repo: andreasknopke/CuraFlow\n\n**Verdict:** `approve_with_changes`\n**Empfohlener Coding-Level:** `medium`\n_Die Aufgabe erfordert eine klare Trennung der Logik für monatliche vs. wöchentliche Ansichten und die korrekte Berechnung der Wochenanzahl, aber die Änderungen sind auf eine einzelne Komponente beschränkt._\n\nDer Plan ist grundsätzlich konform mit den Projektkonventionen und der Architektur, erfordert jedoch Anpassungen zur Risikominimierung und Konventionssicherung. Die monatliche Soll-Stunden-Berechnung ist eine logische Erweiterung, aber die Implementierung muss sicherstellen, dass sie nur in monatlichen Ansichten greift und bestehende wöchentliche Logik nicht beeinträchtigt.\n\n**MUST FOLLOW:**\n- Nutze ausschließlich die Props `year` und `month` aus `StaffingPlanTable` zur Bestimmung der Wochenanzahl im Monat (keine hardcodierten Werte oder externe Abhängigkeiten).\n- Erhalte die Signatur und Rückgabewerte der bestehenden `StaffingPlanTable`-Komponente unverändert (nur interne Logik anpassen).\n- Führe die Berechnung der Wochenanzahl in einer separaten Hilfsfunktion innerhalb von `StaffingPlanTable.tsx` durch (z. B. `calculateWeeksInMonth`), um die Lesbarkeit und Testbarkeit zu gewährleisten.\n- Stelle sicher, dass die Änderung nur in monatlichen Ansichten greift (z. B. durch Prüfung eines `viewMode`-Props oder ähnlichem, falls vorhanden).\n- Beachte die Projekt-Konventionen für Datumsberechnungen (z. B. Verwendung von `date-fns` oder ähnlichen Bibliotheken, falls im Projekt etabliert).\n\n**MUST AVOID:**\n- Änderungen an `staffingUtils.ts` oder anderen Utilities (wie im Constraint vorgegeben).\n- Hardcoding von Wochenanzahlen oder Annahmen über die Länge eines Monats (z. B. 4 Wochen).\n- Seiteneffekte auf wöchentliche Ansichten oder andere Komponenten, die `StaffingPlanTable` verwenden.\n- Direkte Manipulation von globalen Zuständen oder Kontexten außerhalb der Komponente.\n\n**Regelverletzungen:**\n- Fehlende Prüfung, ob die Komponente tatsächlich in einer monatlichen Ansicht verwendet wird (Risiko: Seiteneffekte auf wöchentliche Ansichten).\n- Keine klare Trennung der Berechnungslogik in eine Hilfsfunktion (Verstoß gegen Clean-Code-Prinzipien).\n\n**Integrations-Risiken:**\n- Unbeabsichtigte Auswirkungen auf wöchentliche Ansichten, falls `StaffingPlanTable` auch dort genutzt wird und keine klare Trennung der Logik erfolgt.\n- Falsche Berechnung der Wochenanzahl im Monat (z. B. durch falsche Handhabung von Schaltjahren oder Monatsgrenzen).\n- Performance-Probleme bei häufigen Neuberechnungen, falls die Wochenanzahl nicht zwischengespeichert wird.\n\n**Empfohlene Aenderungen:**\n- Füge eine Prop `viewMode` (oder ähnlich) hinzu, um zwischen wöchentlichen und monatlichen Ansichten zu unterscheiden. Falls diese bereits existiert, nutze sie zur Steuerung der Logik.\n- Extrahiere die Berechnung der Wochenanzahl in eine separate Funktion `calculateWeeksInMonth(year: number, month: number): number` und teste sie isoliert.\n- Füge Kommentare hinzu, die die neue Logik und ihre Abhängigkeiten dokumentieren (z. B. `// Monthly target hours = weekly target * weeks in month`).\n- Prüfe, ob die Komponente bereits eine `monthly`- oder `weekly`-Prop verwendet, und nutze diese zur Steuerung der Logik.",
  "_artifacts": [
    {
      "kind": "integration_assessment",
      "filename": "integration_assessment.md",
      "content": "**Verdict:** `approve_with_changes`\n**Empfohlener Coding-Level:** `medium`\n_Die Aufgabe erfordert eine klare Trennung der Logik für monatliche vs. wöchentliche Ansichten und die korrekte Berechnung der Wochenanzahl, aber die Änderungen sind auf eine einzelne Komponente beschränkt._\n\nDer Plan ist grundsätzlich konform mit den Projektkonventionen und der Architektur, erfordert jedoch Anpassungen zur Risikominimierung und Konventionssicherung. Die monatliche Soll-Stunden-Berechnung ist eine logische Erweiterung, aber die Implementierung muss sicherstellen, dass sie nur in monatlichen Ansichten greift und bestehende wöchentliche Logik nicht beeinträchtigt.\n\n**MUST FOLLOW:**\n- Nutze ausschließlich die Props `year` und `month` aus `StaffingPlanTable` zur Bestimmung der Wochenanzahl im Monat (keine hardcodierten Werte oder externe Abhängigkeiten).\n- Erhalte die Signatur und Rückgabewerte der bestehenden `StaffingPlanTable`-Komponente unverändert (nur interne Logik anpassen).\n- Führe die Berechnung der Wochenanzahl in einer separaten Hilfsfunktion innerhalb von `StaffingPlanTable.tsx` durch (z. B. `calculateWeeksInMonth`), um die Lesbarkeit und Testbarkeit zu gewährleisten.\n- Stelle sicher, dass die Änderung nur in monatlichen Ansichten greift (z. B. durch Prüfung eines `viewMode`-Props oder ähnlichem, falls vorhanden).\n- Beachte die Projekt-Konventionen für Datumsberechnungen (z. B. Verwendung von `date-fns` oder ähnlichen Bibliotheken, falls im Projekt etabliert).\n\n**MUST AVOID:**\n- Änderungen an `staffingUtils.ts` oder anderen Utilities (wie im Constraint vorgegeben).\n- Hardcoding von Wochenanzahlen oder Annahmen über die Länge eines Monats (z. B. 4 Wochen).\n- Seiteneffekte auf wöchentliche Ansichten oder andere Komponenten, die `StaffingPlanTable` verwenden.\n- Direkte Manipulation von globalen Zuständen oder Kontexten außerhalb der Komponente.\n\n**Regelverletzungen:**\n- Fehlende Prüfung, ob die Komponente tatsächlich in einer monatlichen Ansicht verwendet wird (Risiko: Seiteneffekte auf wöchentliche Ansichten).\n- Keine klare Trennung der Berechnungslogik in eine Hilfsfunktion (Verstoß gegen Clean-Code-Prinzipien).\n\n**Integrations-Risiken:**\n- Unbeabsichtigte Auswirkungen auf wöchentliche Ansichten, falls `StaffingPlanTable` auch dort genutzt wird und keine klare Trennung der Logik erfolgt.\n- Falsche Berechnung der Wochenanzahl im Monat (z. B. durch falsche Handhabung von Schaltjahren oder Monatsgrenzen).\n- Performance-Probleme bei häufigen Neuberechnungen, falls die Wochenanzahl nicht zwischengespeichert wird.\n\n**Empfohlene Aenderungen:**\n- Füge eine Prop `viewMode` (oder ähnlich) hinzu, um zwischen wöchentlichen und monatlichen Ansichten zu unterscheiden. Falls diese bereits existiert, nutze sie zur Steuerung der Logik.\n- Extrahiere die Berechnung der Wochenanzahl in eine separate Funktion `calculateWeeksInMonth(year: number, month: number): number` und teste sie isoliert.\n- Füge Kommentare hinzu, die die neue Logik und ihre Abhängigkeiten dokumentieren (z. B. `// Monthly target hours = weekly target * weeks in month`).\n- Prüfe, ob die Komponente bereits eine `monthly`- oder `weekly`-Prop verwendet, und nutze diese zur Steuerung der Logik."
    }
  ]
}
```
