# Security & Redaction

- Ticket: #92377083-89ef-4e08-9578-11f3f1c3c802 — Monatssicht berechnet soll-stunden falsch
- Stage: `security`
- Status: `done`
- Bearbeiter: Security-Bot (ai)
- Provider/Modell: `openai_local` / `gemma-4`
- Gestartet: 2026-07-14 11:27:10
- Beendet: 2026-07-14 11:27:14
- Dauer: 4204 ms

## Bericht

> System: CuraFlow (ID 1) · Repo: andreasknopke/CuraFlow

### Coding-Prompt

Adjust the logic for calculating 'Soll-Stunden' (target hours) in the monthly view of the system. Currently, the monthly view incorrectly displays the weekly target hour value instead of the aggregated monthly total. The implementation should ensure that while planned hours are correctly summed for the month, the target hours are also transitioned from a weekly-based value to a cumulative monthly sum to match the monthly scale.

### Redigierte Beschreibung

In der Wochensicht wird ja richtig die Anzahl der eingeplanten Arbeitsstunden mit den Soll-Arbeitsstunden aus dem Tarifvertrag verglichen (zB. 38h/40h). In der Monatssicht sollten dann die gesamten stunden im Monat aufsummiert werden und mit den summierten soll stunden verglichen werden (zB: 155h/160h). Das klappt auch ganz gut für die planungsstunden, allerdings nicht für die soll stunden, da steht immernoch die wochenstunden zahl (zB: 155h/40h)

Triage-Zusammenfassung: Die Berechnung der Soll-Stunden in der Monatssicht muss von der wöchentlichen auf die monatliche Summe umgestellt werden.
Triage-Empfehlung: Logik der Soll-Stunden-Aggregation in der Monatssicht anpassen.

## Coding-Prompt (redacted)

```
Adjust the logic for calculating 'Soll-Stunden' (target hours) in the monthly view of the system. Currently, the monthly view incorrectly displays the weekly target hour value instead of the aggregated monthly total. The implementation should ensure that while planned hours are correctly summed for the month, the target hours are also transitioned from a weekly-based value to a cumulative monthly sum to match the monthly scale.
```

## Redacted Description

```
In der Wochensicht wird ja richtig die Anzahl der eingeplanten Arbeitsstunden mit den Soll-Arbeitsstunden aus dem Tarifvertrag verglichen (zB. 38h/40h). In der Monatssicht sollten dann die gesamten stunden im Monat aufsummiert werden und mit den summierten soll stunden verglichen werden (zB: 155h/160h). Das klappt auch ganz gut für die planungsstunden, allerdings nicht für die soll stunden, da steht immernoch die wochenstunden zahl (zB: 155h/40h)

Triage-Zusammenfassung: Die Berechnung der Soll-Stunden in der Monatssicht muss von der wöchentlichen auf die monatliche Summe umgestellt werden.
Triage-Empfehlung: Logik der Soll-Stunden-Aggregation in der Monatssicht anpassen.
```

## Vollstaendiges Output-Payload

```json
{
  "redacted_text": "In der Wochensicht wird ja richtig die Anzahl der eingeplanten Arbeitsstunden mit den Soll-Arbeitsstunden aus dem Tarifvertrag verglichen (zB. 38h/40h). In der Monatssicht sollten dann die gesamten stunden im Monat aufsummiert werden und mit den summierten soll stunden verglichen werden (zB: 155h/160h). Das klappt auch ganz gut für die planungsstunden, allerdings nicht für die soll stunden, da steht immernoch die wochenstunden zahl (zB: 155h/40h)\n\nTriage-Zusammenfassung: Die Berechnung der Soll-Stunden in der Monatssicht muss von der wöchentlichen auf die monatliche Summe umgestellt werden.\nTriage-Empfehlung: Logik der Soll-Stunden-Aggregation in der Monatssicht anpassen.",
  "coding_prompt": "Adjust the logic for calculating 'Soll-Stunden' (target hours) in the monthly view of the system. Currently, the monthly view incorrectly displays the weekly target hour value instead of the aggregated monthly total. The implementation should ensure that while planned hours are correctly summed for the month, the target hours are also transitioned from a weekly-based value to a cumulative monthly sum to match the monthly scale.",
  "findings": [],
  "open_questions": [],
  "markdown": "> System: CuraFlow (ID 1) · Repo: andreasknopke/CuraFlow\n\n### Coding-Prompt\n\nAdjust the logic for calculating 'Soll-Stunden' (target hours) in the monthly view of the system. Currently, the monthly view incorrectly displays the weekly target hour value instead of the aggregated monthly total. The implementation should ensure that while planned hours are correctly summed for the month, the target hours are also transitioned from a weekly-based value to a cumulative monthly sum to match the monthly scale.\n\n### Redigierte Beschreibung\n\nIn der Wochensicht wird ja richtig die Anzahl der eingeplanten Arbeitsstunden mit den Soll-Arbeitsstunden aus dem Tarifvertrag verglichen (zB. 38h/40h). In der Monatssicht sollten dann die gesamten stunden im Monat aufsummiert werden und mit den summierten soll stunden verglichen werden (zB: 155h/160h). Das klappt auch ganz gut für die planungsstunden, allerdings nicht für die soll stunden, da steht immernoch die wochenstunden zahl (zB: 155h/40h)\n\nTriage-Zusammenfassung: Die Berechnung der Soll-Stunden in der Monatssicht muss von der wöchentlichen auf die monatliche Summe umgestellt werden.\nTriage-Empfehlung: Logik der Soll-Stunden-Aggregation in der Monatssicht anpassen.",
  "_artifacts": [
    {
      "kind": "redacted_description",
      "filename": "redacted_description.md",
      "content": "In der Wochensicht wird ja richtig die Anzahl der eingeplanten Arbeitsstunden mit den Soll-Arbeitsstunden aus dem Tarifvertrag verglichen (zB. 38h/40h). In der Monatssicht sollten dann die gesamten stunden im Monat aufsummiert werden und mit den summierten soll stunden verglichen werden (zB: 155h/160h). Das klappt auch ganz gut für die planungsstunden, allerdings nicht für die soll stunden, da steht immernoch die wochenstunden zahl (zB: 155h/40h)\n\nTriage-Zusammenfassung: Die Berechnung der Soll-Stunden in der Monatssicht muss von der wöchentlichen auf die monatliche Summe umgestellt werden.\nTriage-Empfehlung: Logik der Soll-Stunden-Aggregation in der Monatssicht anpassen."
    },
    {
      "kind": "coding_prompt",
      "filename": "coding_prompt.md",
      "content": "Adjust the logic for calculating 'Soll-Stunden' (target hours) in the monthly view of the system. Currently, the monthly view incorrectly displays the weekly target hour value instead of the aggregated monthly total. The implementation should ensure that while planned hours are correctly summed for the month, the target hours are also transitioned from a weekly-based value to a cumulative monthly sum to match the monthly scale."
    }
  ]
}
```
