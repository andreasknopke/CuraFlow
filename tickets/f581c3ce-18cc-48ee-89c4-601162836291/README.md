# Ticket #f581c3ce-18cc-48ee-89c4-601162836291 — Coding-Dossier

> Dieses Verzeichnis enthaelt die vollstaendige Analyse des Ticketsystem-Workflows
> fuer Ticket #f581c3ce-18cc-48ee-89c4-601162836291. Es ist als Briefing fuer einen externen Coding-Agenten
> (z. B. OpenCode, VS Code Copilot) gedacht. Der Agent arbeitet direkt im Repo —
> die Analyse hier dient als Eingabe, nicht als Code-Vorlage.

## Eckdaten

- Titel: **Wochenplan Text Einträge in Bereich/Datum werden abgeschnitten**
- Typ: `bug`
- Dringlichkeit: `normal`
- System: CuraFlow (`andreasknopke/CuraFlow`)
- Workflow-Run: 142 (gestartet 2026-05-11 05:54:41)

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
Aktuell kann der Benutzer die Textfelder in "Bereich/Datum" eigenständig benennen. Manchmal sind die Bezeichnungen des Benutzers länger als das Zellbreite von "Bereich/Dienstplan", dann wird der Eintrag aktuell abgeschnitten. Besser wäre es, einen Zeilenumbruch in der Zelle zu erzeugen bei längeren Einträgen mit mehreren Wörtern (zB: "Vordergrund UCHI Wochenende früh" zu "Vordergrund UCHI" EOL "Wochenende früh" )
Bei sehr langen Einzelwörtern die keinen natürlichen Zeilenumbruch erlauben kann auch die Schriftgröße verkleinert werden.
```