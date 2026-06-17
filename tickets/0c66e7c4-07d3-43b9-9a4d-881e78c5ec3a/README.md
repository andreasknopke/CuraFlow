# Ticket #0c66e7c4-07d3-43b9-9a4d-881e78c5ec3a — Coding-Dossier

> Dieses Verzeichnis enthaelt die vollstaendige Analyse des Ticketsystem-Workflows
> fuer Ticket #0c66e7c4-07d3-43b9-9a4d-881e78c5ec3a. Es ist als Briefing fuer einen externen Coding-Agenten
> (z. B. OpenCode, VS Code Copilot) gedacht. Der Agent arbeitet direkt im Repo —
> die Analyse hier dient als Eingabe, nicht als Code-Vorlage.

## Eckdaten

- Titel: **"Andere Abteilung (AA)" als Status im Stellenplan**
- Typ: `feature`
- Dringlichkeit: `normal`
- System: CuraFlow (`andreasknopke/CuraFlow`)
- Workflow-Run: 202 (gestartet 2026-06-10 12:47:52)

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
Aktuell können Mitarbeiter nur auf 0,0 im Stellenplan gesetzt werden, wenn Sie nicht mehr über diese Abteilung bezahlt werden. Da führt aber zu Konflikten, denn oft werden diese Mitarbeiter trotzdem weiter eingeplant, aber über eine andere Abteilung abgerechnet.
Besser wäre es, wenn es einen zusätzlichen Status gäbe: AA - Andere Abteilung. Dieser steht nicht im Konflikt mit Diensten und anderen Planungszuständen (Urlaub etc), zeigt aber klar, dass diese Stelle nicht über diese Abteilung bezahlt wird.
```