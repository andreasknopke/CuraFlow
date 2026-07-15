# Ticket #92377083-89ef-4e08-9578-11f3f1c3c802 — Coding-Dossier

> Dieses Verzeichnis enthaelt die vollstaendige Analyse des Ticketsystem-Workflows
> fuer Ticket #92377083-89ef-4e08-9578-11f3f1c3c802. Es ist als Briefing fuer einen externen Coding-Agenten
> (z. B. OpenCode, VS Code Copilot) gedacht. Der Agent arbeitet direkt im Repo —
> die Analyse hier dient als Eingabe, nicht als Code-Vorlage.

## Eckdaten

- Titel: **Monatssicht berechnet soll-stunden falsch**
- Typ: `bug`
- Dringlichkeit: `normal`
- System: CuraFlow (`andreasknopke/CuraFlow`)
- Workflow-Run: 245 (gestartet 2026-07-14 11:27:05)

## Inhalt

- [Triage Reviewer](./01_triage.md) — Status: `done`
- [Security & Redaction](./02_security.md) — Status: `done`
- [Solution Architect (Planning)](./03_planning.md) — Status: `done`
- [Integration Reviewer](./04_integration.md) — Status: `done`
- [Final Approver (Dispatch-Decision)](./05_approval.md) — Status: `waiting_human`
- [Manifest (JSON)](./manifest.json)

## Original-Beschreibung (unredacted)

> Hinweis: Der `02_security.md`-Bericht enthaelt die redaktierte Variante,
> die fuer KI-Aufrufe verwendet wurde.

```
In der Wochensicht wird ja richtig die Anzahl der eingeplanten Arbeitsstunden mit den Soll-Arbeitsstunden aus dem Tarifvertrag verglichen (zB. 38h/40h). In der Monatssicht sollten dann die gesamten stunden im Monat aufsummiert werden und mit den summierten soll stunden verglichen werden (zB: 155h/160h). Das klappt auch ganz gut für die planungsstunden, allerdings nicht für die soll stunden, da steht immernoch die wochenstunden zahl (zB: 155h/40h)
```