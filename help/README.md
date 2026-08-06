# CuraFlow CHM Hilfedatei

Dieses Verzeichnis enthält alle Dateien für die CuraFlow CHM-Hilfedatei (Compiled HTML Help).

## Dateien

- `index.html` - Startseite des Handbuchs
- `getting_started.html` - Erste Schritte
- `schedule.html` - Dienstplan (Grundlagen)
- `schedule_advanced.html` - Erweiterte Dienstplan-Funktionen
- `mydashboard.html` - Mein Dashboard
- `wishlist.html` - Dienstwünsche
- `vacation.html` - Urlaubsplanung
- `training.html` - Weiterbildungsplanung
- `staff.html` - Personalverwaltung
- `statistics.html` - Statistiken und Berichte
- `admin.html` - Systemadministration
- `concepts.html` - Konzepte und Grundlagen
- `troubleshooting.html` - Häufige Probleme
- `curaflow.hhp` - HTML Help Workshop Projektdatei
- `curaflow.hhc` - Inhaltsverzeichnis (Table of Contents)
- `curaflow.hhk` - Index (Keywords)

## Kompilieren der CHM-Datei

### Option 1: Mit HTML Help Workshop (empfohlen)

1. Installieren Sie den **HTML Help Workshop** von Microsoft:
   - Download: https://www.microsoft.com/en-us/download/details.aspx?id=21138
   - Oder über Windows SDK (älter als v10)

2. Öffnen Sie `curaflow.hhp` im HTML Help Workshop.

3. Klicken Sie auf **Compile** (oder drücken Sie F7).

4. Die CHM-Datei `CuraFlow_Hilfe.chm` wird im selben Verzeichnis erstellt.

### Option 2: Mit PowerShell-Skript

Führen Sie das Skript `build-chm.ps1` aus:

```powershell
cd d:\GitHub\CuraFlow\help
.\build-chm.ps1
```

Das Skript:
- Prüft, ob hhc.exe verfügbar ist.
- Kompiliert die CHM-Datei.
- Öffnet die CHM-Datei nach erfolgreichem Kompilieren.

### Option 3: Direkt über Kommandozeile

```powershell
hhc "d:\GitHub\CuraFlow\help\curaflow.hhp"
```

## CHM-Datei verwenden

Die kompilierte CHM-Datei kann:

- Direkt im Windows-Hilfe-Viewer geöffnet werden (Doppelklick).
- In CuraFlow als Hilfedatei integriert werden (über `help://`-Protokoll oder Datei-Link).
- Auf einem Netzwerkshare oder Intranet bereitgestellt werden.

## CHM-Datei in CuraFlow integrieren

Um die CHM-Datei in CuraFlow als Hilfelink zu integrieren:

1. Kopieren Sie `CuraFlow_Hilfe.chm` in ein öffentliches Verzeichnis (z.B. `public/help/`).

2. Fügen Sie im Help-Komponenten einen Link hinzu:

```tsx
<a href="/help/CuraFlow_Hilfe.chm">CHM-Hilfe herunterladen</a>
```

Oder für direkte Öffnung (wenn der Browser CHM unterstützt):

```tsx
<a href="file:///C:/Pfad/zur/CuraFlow_Hilfe.chm">CHM-Hilfe öffnen</a>
```

## Aktualisieren der Hilfedatei

Wenn Sie Änderungen an den HTML-Dateien vornehmen:

1. Bearbeiten Sie die entsprechenden HTML-Dateien.
2. Aktualisieren Sie bei Bedarf `curaflow.hhc` (Inhaltsverzeichnis) und `curaflow.hhk` (Index).
3. Kompilieren Sie die CHM-Datei erneut.

## Struktur des Handbuchs

Das Handbuch ist in folgende Kapitel unterteilt:

1. **Startseite** - Übersicht und Inhalt
2. **Erste Schritte** - Anmeldung, Navigation, Einstellungen
3. **Dienstplan** - Grundlegende Bedienung
4. **Erweiterte Dienstplan-Funktionen** - KI, Timeslots, Validierung
5. **Mein Dashboard** - Persönliche Übersicht
6. **Dienstwünsche** - Wünsche einreichen und verwalten
7. **Urlaubsplanung** - Urlaub planen und genehmigen
8. **Weiterbildungsplanung** - Rotationen und Schulungen
9. **Personalverwaltung** - Mitarbeiter und Qualifikationen
10. **Statistiken und Berichte** - Auswertungen
11. **Systemadministration** - Benutzer, Einstellungen, Wartung
12. **Konzepte und Grundlagen** - Berechtigungen, Rollen, Architektur
13. **Häufige Probleme** - Fehlerbehebung

## Lizenz

Diese Hilfedatei ist Teil von CuraFlow und unterliegt der gleichen Lizenz.
