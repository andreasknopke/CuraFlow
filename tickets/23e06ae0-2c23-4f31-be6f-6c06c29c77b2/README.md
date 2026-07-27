# Ticket #23e06ae0-2c23-4f31-be6f-6c06c29c77b2 — Coding-Dossier

> Dieses Verzeichnis enthaelt die vollstaendige Analyse des Ticketsystem-Workflows
> fuer Ticket #23e06ae0-2c23-4f31-be6f-6c06c29c77b2. Es ist als Briefing fuer einen externen Coding-Agenten
> (z. B. OpenCode, VS Code Copilot) gedacht. Der Agent arbeitet direkt im Repo —
> die Analyse hier dient als Eingabe, nicht als Code-Vorlage.

## Eckdaten

- Titel: **Wochenplan: Teammitglieder innerhalb einer Zelle verschieben ohne Zeitslot abfrage**
- Typ: `feature`
- Dringlichkeit: `normal`
- System: CuraFlow (`andreasknopke/CuraFlow`)
- Workflow-Run: 257 (gestartet 2026-07-27 07:20:11)

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
aktuell kann man Mitarbeiter innerhalb einer Zelle im Wochenplan durch drag und drop verschieben. wenn der Dienst allerdings Zeit-Fenster hat wird beim drag und drop eine erneute Abfrage des Zeitfenster-dialogs getriggert. 

Besser wäre es, wenn die erneute Triggerung des Dialogs nicht stattfinden würde, da die Information über das Zeitfenster für dieses Teammitglied in dieser Zelle schon vorhanden ist.
```