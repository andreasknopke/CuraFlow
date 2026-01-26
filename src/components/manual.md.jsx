# RadioPlan - Systemdokumentation & Funktionsübersicht

Diese Datei dient als Wissensbasis für einen KI-Assistenten, um Benutzerfragen zur Software "RadioPlan" zu beantworten.

## 1. Über RadioPlan
RadioPlan ist eine spezialisierte Webanwendung zur Dienst- und Rotationsplanung für radiologische Abteilungen. Sie unterstützt Planer (Oberärzte, Chefärzte) dabei, den komplexen Einsatz von Ärzten auf verschiedene Arbeitsplätze, Dienste und Ausbildungsrotationen zu koordinieren.

---

## 2. Kernbereiche & Navigation

Die Anwendung ist in mehrere Hauptmodule unterteilt, die über die linke Seitenleiste erreichbar sind:

### A. Wochenplan (Schedule) - "Das Herzstück"
Hier findet die operative Planung statt.
- **Funktion:** Zuweisung von Ärzten zu Arbeitsplätzen für eine Woche oder einen Tag.
- **Ansichten:** Wochenansicht (Mo-So) und Tagesansicht.
- **Aufbau:**
  - **Zeilen:** Arbeitsplätze (z.B. CT, MRT), Dienste (Vordergrund, Hintergrund) und Status (Frei, Urlaub).
  - **Spalten:** Wochentage.
  - **Seitenleiste:** Liste aller verfügbaren Mitarbeiter, sortiert nach Rang.
- **Bedienung:**
  - **Drag & Drop:** Ärzte aus der Leiste in den Plan ziehen.
  - **Verschieben:** Einträge im Plan verschieben (Drag & Drop). Mit gedrückter `Strg`-Taste wird der Eintrag kopiert.
  - **Kontextmenü:** Rechtsklick auf das Mikrofon-Icon für Einstellungen.
  - **Papierkorb:** Einträge können zum Löschen in den Papierkorb gezogen werden (oder zurück in die Leiste).
- **Besonderheiten:**
  - **Warnungen:** Das System prüft live auf Konflikte (Doppelbelegung, Ruhezeiten, fehlende Qualifikation).
  - **Bereiche:** Unterteilt in "Dienste", "Rotationen", "Demonstrationen & Konsile", "Anwesenheiten" (Verfügbar) und "Abwesenheiten".

### B. Dienstbesetzung (Service Staffing)
Fokus auf die monatliche Besetzung der Bereitschaftsdienste.
- **Funktion:** Schnelle Übersicht, ob alle Nacht- und Wochenenddienste besetzt sind.
- **Features:**
  - **Auto-Frei:** Generiert oft automatisch einen "Frei"-Eintrag für den Folgetag nach einem Nachtdienst.
  - **Export:** Drucken oder per E-Mail versenden.

### C. Team (Staff)
Stammdatenverwaltung der Teammitglieder.
- **Daten:** Name, Kürzel, Funktion (frei konfigurierbar), E-Mail, Arbeitszeitfaktor (FTE).
- **Funktion:** Neue Mitarbeiter anlegen, bearbeiten, löschen oder deaktivieren.
- **Sortierung:** Die Reihenfolge hier bestimmt die Sortierung in der Seitenleiste des Wochenplans.

### D. Abwesenheiten (Vacation)
Langfristige Urlaubsplanung.
- **Funktion:** Kalenderansicht (Jahresansicht) zum Eintragen von Urlaub, Krankheit, Dienstreisen.
- **Synchronisation:** Hier eingetragene Abwesenheiten blockieren den Arzt automatisch im Wochenplan.

### E. Ausbildung (Training)
Rotationsplanung für Assistenzärzte.
- **Funktion:** Zuweisung von Ärzten zu Modalitäten (z.B. "3 Monate CT") für feste Zeiträume.
- **Effekt:** Im Wochenplan werden diese Ärzte farblich hervorgehoben oder bevorzugt für diese Plätze vorgeschlagen.

### F. Statistik
Auswertung der Planung.
- **Metriken:** Anzahl der Dienste pro Arzt, Verteilung der Rotationen, Abwesenheitsquoten.

### G. Administration (Admin)
Nur für Benutzer mit der Rolle 'admin'.
- **Backups:** Manuelle Erstellung von Datenbank-Backups und Wiederherstellung.
- **Logs:** Systemprotokolle zur Fehleranalyse (z.B. warum ein Backup nicht lief).
- **Reparatur:** Tools zur Bereinigung von Datenbank-Inkonsistenzen.

---

## 3. Spezialfunktionen

### Sprachsteuerung (Voice Control)
Eine herausragende Funktion zur freihändigen Bedienung.
- **Icon:** Mikrofon im Wochenplan.
- **Funktion:** Der User spricht Befehle, die KI führt sie aus.
- **Beispielbefehle:**
  - *"Dr. Müller heute ins CT einteilen."*
  - *"Verschiebe den Spätdienst von Montag auf Dienstag."*
  - *"Zeige mir die nächste Woche."*
  - *"Lösche alle Einträge von Dr. Weber."*
- **Training:** Über das Kontextmenü kann man "Voice Alias Training" aufrufen, um der KI beizubringen, wie man bestimmte Ärztenamen ausspricht (z.B. Spitznamen).

### KI-Vorschlag (Auto-Fill)
- **Funktion:** Ein Algorithmus (unterstützt durch LLM) versucht, den leeren Wochenplan intelligent zu füllen.
- **Berücksichtigung:** Rotationen, Qualifikationen (Facharzt für Hintergrunddienst), Abwesenheiten.

### Konfiguration (Settings)
- **Arbeitsplätze:** Der User kann definieren, welche Zeilen im Plan erscheinen (z.B. "Neues MRT Gerät").
- **Farben:** Anpassung der Farben für Arzt-Rollen (z.B. Oberärzte = Blau).

---

## 4. Logik & Regeln (Hintergrundwissen)

- **Konfliktprüfung:** Ein Arzt kann nicht gleichzeitig an zwei Orten sein. Ausnahme: Bestimmte Dienste erlauben parallele Rotation (konfigurierbar).
- **Ruhezeiten:** RadioPlan achtet auf gesetzliche Ruhezeiten. Nach einem "Dienst Vordergrund" (Nachtdienst) wird der Arzt am Folgetag für die normale Arbeit gesperrt ("Frei").
- **Besetzungs-Check:** Das System warnt, wenn an einem Tag zu wenige Fachärzte anwesend sind (Staffing Level).

## 5. Häufige User-Fragen (FAQ für den Bot)

**F: Wie trage ich Urlaub ein?**
A: Gehe auf die Seite "Abwesenheiten". Klicke dort auf die Tage im Kalender oder ziehe einen Bereich mit der Maus, und wähle dann oben "Urlaub" aus.

**F: Warum kann ich Dr. X nicht ins CT ziehen?**
A: Prüfe, ob Dr. X an dem Tag bereits eine Abwesenheit hat (z.B. Urlaub) oder schon für einen anderen Dienst eingeteilt ist. Das System verhindert Doppelbelegungen.

**F: Die Sprachsteuerung versteht meinen neuen Arzt nicht.**
A: Mache einen Rechtsklick auf das Mikrofon-Icon und wähle "Stimmtraining". Dort kannst du den Namen einsprechen, damit die KI ihn lernt.

**F: Wie erstelle ich eine Sicherung?**
A: Gehe zu "Administration". Dort gibt es den Bereich "Server Backup", wo du manuell ein Backup erstellen und herunterladen kannst.

---

## 6. Detaillierte UI-Funktionsbeschreibung

### Wochenplan (ScheduleBoard)
- **Navigation & Steuerung:**
  - **Pfeiltasten (< >):** Blättern zwischen Wochen oder Tagen.
  - **"Heute"-Button:** Springt sofort zum aktuellen Datum zurück.
  - **Ansicht-Umschalter:** Wechselt zwischen der kompakten Wochenansicht und der detaillierten Tagesansicht.
  - **Zoom/Schriftgröße:** Über das "Auge"-Menü kann die Schriftgröße des gesamten Plans stufenlos angepasst werden, um mehr Übersicht auf kleinen Bildschirmen zu schaffen.
- **Toolbar-Funktionen:**
  - **Excel-Export:** Generiert eine .xlsx Datei des aktuellen Zeitraums. Beachtet dabei ausgeblendete Zeilen.
  - **Woche leeren (Mülleimer):** Löscht mit einer Bestätigung alle Dienste der angezeigten Woche. **Achtung:** Abwesenheiten (Urlaub/Krank) bleiben zum Schutz meist erhalten.
  - **Zeilen-Filter (Auge-Icon):** Hier können ganze Zeilen (z.B. "Sonstiges" oder selten genutzte Geräte) ausgeblendet werden, um den Plan übersichtlicher zu gestalten.
- **Interaktions-Details:**
  - **Drag & Drop:** Das Standard-Werkzeug. Ein Dienst kann von einem Tag auf einen anderen, oder von einem Arzt auf einen anderen gezogen werden.
  - **Kopieren (Strg-Taste):** Hält man während des Ziehens die `Strg`-Taste (oder `Alt` auf Mac) gedrückt, wird der Dienst kopiert statt verschoben. Ein Plus-Symbol signalisiert dies.
  - **Rechtsklick auf Mikrofon:** Öffnet das Experten-Menü für die Sprachsteuerung (Modus-Wahl, Debugging, Alias-Training).

### Team (StaffPage)
- **Sortierung:** Die Reihenfolge in der Liste ist per Drag & Drop änderbar. Diese Reihenfolge wird **global** für die Seitenleiste im Wochenplan übernommen. Wichtige Mitarbeiter (z.B. Springer) können so nach oben sortiert werden.
- **Funktions-Farben:** Die Farben der Funktionen (z.B. OA = Blau) werden in den globalen Einstellungen ("Color Settings") definiert, nicht im einzelnen Mitarbeiter-Profil.

### Administration & Logs
- **System-Logs:** Hier werden alle kritischen Aktionen (Backups, Fehler, KI-Aufrufe) protokolliert.
- **JSON-Viewer:** Detaillierte Log-Einträge können aufgeklappt werden, um technische Details (Stack Traces, Payloads) zu sehen.

---

## 7. App-Erweiterungen & Integrationen

### E-Mail Benachrichtigungen
- **Modul:** Dienstbesetzung (Service Staffing).
- **Funktion:** Versendet personalisierte E-Mails an Ärzte mit ihren Diensten für den ausgewählten Monat.
- **Voraussetzung:** Im Profil des Arztes muss eine gültige E-Mail-Adresse hinterlegt sein. Das System nutzt einen internen Mail-Service (SendGrid/SMTP via Backend).

### Excel-Export Engine
- **Funktion:** Erstellt native Excel-Dateien (kein CSV), die Formatierungen, Spaltenbreiten und Farben enthalten.
- **Logik:** Der Export respektiert die aktuellen Filtereinstellungen des Users. Was ausgeblendet ist, wird nicht exportiert.

### KI-Agent & Sprachverarbeitung (ElevenLabs & OpenAI)
- **Architektur:**
  1. **Audio-Input:** Wird via WebSocket an ElevenLabs gestreamt (Agent).
  2. **Verarbeitung:** Der Agent interpretiert die Absicht (Intent) und extrahiert Parameter (Arztname, Datum, Position).
  3. **Ausführung:** Das Backend validiert die Parameter gegen die Datenbank (Fuzzy Search für Namen) und führt die Änderung durch.
  4. **Feedback:** Erfolge oder Fehler werden als Audio-Antwort zurückgegeben ("Habe Dr. Müller eingetragen").
- **Latenz:** Die Verarbeitung benötigt ca. 1-3 Sekunden. Ein pulsierendes Icon visualisiert den Status "Hören" vs. "Denken".

---

## 8. Mögliche Fehlerquellen & Troubleshooting

### Bedienungsfehler (User Error)
- **"Ich kann den Dienst nicht dort hinziehen (springt zurück)"**
  - **Ursache 1 (Konflikt):** Der Arzt hat an diesem Tag bereits eine blockierende Abwesenheit (Urlaub/Krank).
  - **Ursache 2 (Regel):** Die Position erlaubt keine Doppelbelegung und ist bereits besetzt.
  - **Ursache 3 (Qualifikation):** Warnung bei Unterschreitung der Facharzt-Quote (erscheint meist als Warn-Popup, blockiert aber nicht immer hart).
- **"Der Arzt wird nicht gefunden (Sprachsteuerung)"**
  - **Ursache:** Der gesprochene Name weicht zu stark vom hinterlegten Namen ab (z.B. "Dr. J.P." vs "Jean-Pierre").
  - **Lösung:** "Voice Alias Training" nutzen, um dem System den Spitznamen beizubringen.
- **"Änderungen werden nicht gespeichert"**
  - **Ursache:** Verbindungsabbruch oder "Read-Only" Modus (wenn der User ausgeloggt wurde oder keine Rechte hat).
  - **Indikator:** Ein Schloss-Symbol oder eine rote "Offline"-Meldung.

### Technische Fehlerquellen
- **Mikrofon-Berechtigung:**
  - Wenn der Browser den Zugriff auf das Mikrofon verweigert, kann die Sprachsteuerung nicht starten. Das Icon bleibt inaktiv oder zeigt einen Fehler.
  - **Lösung:** Browser-Einstellungen (Schloss-Icon in der Adressleiste) prüfen.
- **Audio-Feedback bricht ab:**
  - Auf mobilen Geräten (iOS) unterbricht das System manchmal die Audio-Wiedergabe, wenn der Bildschirm gesperrt wird oder der Browser in den Hintergrund wechselt.
- **Datenbank-Inkonsistenzen:**
  - In seltenen Fällen (z.B. bei Netzwerkfehlern während einer Batch-Operation) können "verwaiste" Einträge entstehen (Dienste ohne Arzt).
  - **Lösung:** Im Admin-Bereich die Funktion "System Check & Repair" ausführen.

### Limitierungen
- **Undo-Funktion:** Das "Rückgängig" (Strg+Z) funktioniert nur für die Aktionen der aktuellen Sitzung. Nach einem Neuladen der Seite ist der Verlauf leer.
- **Mobile Ansicht:** Der Wochenplan ist für Desktop-Monitore optimiert. Auf Smartphones ist die Bedienung via Drag & Drop eingeschränkt möglich, aber nicht empfohlen. Hier ist die Sprachsteuerung die bevorzugte Eingabemethode.