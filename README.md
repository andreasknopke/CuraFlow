# CuraFlow

Webbasiertes Dienstplanungs- und Personalverwaltungssystem für Krankenhäuser und Kliniken


## Überblick

CuraFlow ist eine moderne Webanwendung zur digitalen Verwaltung von Dienstplänen, Urlaubsplanung und Personalressourcen in medizinischen Einrichtungen. Das System wurde speziell für die Anforderungen von radiologischen Abteilungen und vergleichbaren Krankenhausbereichen entwickelt, lässt sich jedoch flexibel an andere Fachabteilungen anpassen.

Die Anwendung bietet eine intuitive Oberfläche zur Planung von Schichtdiensten, Bereitschaftsdiensten und Rotationen. Durch rollenbasierte Zugriffssteuerung können Administratoren die vollständige Kontrolle über Dienstpläne und Mitarbeiterdaten ausüben, während reguläre Mitarbeiter ihre eigenen Dienste und Wunschlisten einsehen und bearbeiten können.


## Systemarchitektur

CuraFlow besteht aus zwei Hauptkomponenten:

Frontend: React-basierte Single-Page-Application mit Vite als Build-Tool. Die Benutzeroberfläche nutzt moderne UI-Komponenten auf Basis von Radix UI und Tailwind CSS für ein responsives Design, das sowohl auf Desktop- als auch auf mobilen Endgeräten funktioniert.

Backend: Node.js/Express-Server mit REST-API. Die Authentifizierung erfolgt über JWT-Token. Als Datenbank wird MySQL verwendet. Das Backend unterstützt Multi-Tenant-Betrieb, sodass mehrere Mandanten (z.B. verschiedene Abteilungen oder Standorte) über eine zentrale Installation bedient werden können.


## Technische Voraussetzungen

Server-Anforderungen:
- Node.js Version 18 oder höher
- MySQL Version 8.0 oder höher
- Mindestens 1 GB RAM für den Anwendungsserver
- Netzwerkzugriff für HTTPS-Verbindungen

Client-Anforderungen:
- Moderner Webbrowser (Chrome, Firefox, Edge, Safari in aktueller Version)
- JavaScript muss aktiviert sein
- Bildschirmauflösung von mindestens 1024x768 Pixeln empfohlen


## Hauptfunktionen

Dienstplanverwaltung (Schedule):
Die zentrale Funktion der Anwendung ermöglicht die visuelle Planung von Diensten in einer Wochen- oder Tagesansicht. Ärzte und Mitarbeiter können per Drag-and-Drop verschiedenen Arbeitsbereichen zugeordnet werden. Das System unterscheidet zwischen Anwesenheiten, Abwesenheiten (Urlaub, Krank, Frei, Dienstreise), Diensten (Vordergrund, Hintergrund, Spätdienst) sowie Rotationen und Spezialbereichen (CT, MRT, Sonographie, Angiographie, Mammographie etc.). Die Konfiguration der Arbeitsbereiche ist vollständig anpassbar.

Automatische Dienstplanfüllung (AutoFill):
Die deterministische AutoFill-Engine füllt den Dienstplan prioritätsbasiert in vier Phasen: Phase A besetzt Dienste zuerst (inkl. Dienstwünsche und Auto-Frei am Folgetag), Phase B füllt verfügbarkeitsrelevante Arbeitsplätze (Rotationen etc.), Phase C besetzt nicht-verfügbarkeitsrelevante Arbeitsplätze (Mitarbeiter aus Phase B bleiben verfügbar), und Phase D generiert verbleibende Auto-Frei-Einträge. Die Kandidatenauswahl erfolgt über eine einheitliche additive Kostenfunktion.

Kostenfunktion:
Eine einheitliche additive Kostenfunktion bewertet alle Planungsdimensionen als numerischen Score. Optimiert werden 10 Dimensionen: Qualifikations-Match, Rotations-Passung, FTE-gewichtete Fairness, Auswirkung auf andere Arbeitsplätze (Unterbesetzungsfolgen), Dienstwünsche, Wochenbalance, Displacement-Bonus für verdrängte Rotationsärzte, Sollte-nicht-Penalty, Alleinbesetzer-Strafe und Dienstlimits. Alle Gewichte sind als zentrale Konstanten konfigurierbar.

Preview-Modus:
Bei der automatischen Planfüllung werden Vorschläge als Preview-Einträge halbtransparent mit gestricheltem Rahmen angezeigt. Im Preview-Modus können Vorschläge per Drag & Drop zwischen Positionen verschoben werden, bevor sie übernommen oder verworfen werden. Ein farbkodiertes Fairness-Badge zeigt die Dienstanzahl der letzten 4 Wochen, Wochenenddienste und Dienstwünsche an.

Qualifikationssystem:
CuraFlow bietet ein 4-stufiges Qualifikationssystem für Arbeitsplätze und Mitarbeiter. Pro Arbeitsplatz können Qualifikationen als Pflicht (Mitarbeiter muss die Qualifikation besitzen), Sollte (bevorzugt qualifiziert, aber Unqualifizierte erlaubt), Sollte nicht (Qualifizierte nur wenn kein anderer verfügbar) oder Nicht/Ausschlusskriterium (Mitarbeiter mit dieser Qualifikation darf nie eingeteilt werden) konfiguriert werden. Mitarbeitern werden Qualifikationen über einen eigenen Editor zugewiesen. Sowohl die AutoFill-Engine als auch die manuelle Einteilung prüfen alle vier Stufen und zeigen entsprechende Warnungen oder Blocker an.

Mitarbeiterverwaltung (Staff):
Verwaltung aller Ärzte und Mitarbeiter mit ihren Stammdaten. Jeder Mitarbeiter kann einer Rolle zugeordnet werden (Chefarzt, Oberarzt, Facharzt, Assistenzarzt, Nicht-Radiologe). Die Reihenfolge der Anzeige ist konfigurierbar. Es können Qualifikationen und Einschränkungen hinterlegt werden.

Team-Rollen und Berechtigungen:
Rollen sind vollständig konfigurierbar mit Priorität und Drag-and-Drop-Sortierung. Granulare Berechtigungen steuern, ob eine Rolle Vordergrunddienste oder Hintergrunddienste übernehmen darf, ob sie aus Statistiken ausgeschlossen wird und ob sie als Facharzt-Rolle gilt. Standardrollen werden automatisch angelegt, können aber beliebig erweitert oder angepasst werden.

Verfügbarkeitsrelevanz (Affects Availability):
Pro Arbeitsplatz kann konfiguriert werden, ob eine Einteilung die Verfügbarkeit beeinflusst. Bei deaktivierter Verfügbarkeitsrelevanz bleibt ein Mitarbeiter trotz Einteilung weiterhin für andere Positionen verfügbar. Dies ist nützlich für Konsile, Demonstrationen oder ähnliche Arbeitsplätze, bei denen mindestens eine Pflichtqualifikation erforderlich ist, die Zuweisung aber die restliche Tagesplanung nicht blockiert.

Stellenplan (Staffing Plan):
Erfassung des Beschäftigungsumfangs (VK-Anteil) je Mitarbeiter und Monat. Berücksichtigung von Kündigungsfristen, Mutterschutz, Elternzeit und anderen Abwesenheitsgründen. Diese Informationen fließen in die automatische Berechnung der Verfügbarkeit ein. Mitarbeiter mit abgelaufenem Vertrag, Mutterschutz, Elternzeit oder 0.0 FTE werden automatisch aus der Seitenleiste gefiltert.

Rotations- und Trainingsplanung:
Die Trainingsseite bietet eine Jahresübersicht zur Planung von Ausbildungsrotationen (z.B. CT, MRT, Sonographie) für Assistenzärzte. Rotationen können als Zeiträume eingetragen und per Transfer-Dialog in den aktiven Dienstplan übernommen werden, mit automatischer Konflikterkennung gegen bestehende Einträge. Die AutoFill-Engine priorisiert Mitarbeiter mit aktiver Rotation für den entsprechenden Arbeitsplatz.

Urlaubsplanung (Vacation):
Jahresübersicht für jeden Mitarbeiter mit Anzeige von Urlaubstagen, Schulferien und Feiertagen. Automatische Berücksichtigung von Konflikten bei der Urlaubsplanung. Synchronisation mit dem Dienstplan.

Dienstwunsch-System (WishList):
Mitarbeiter können Wünsche für bestimmte Dienste oder dienstfreie Tage eintragen. Genehmigte Kein-Dienst-Wünsche sind harte Ausschlüsse, ausstehende Kein-Dienst-Wünsche werden als weiche Präferenz berücksichtigt. Die WishList-Seite bietet eine Jahresübersicht nach Diensttyp mit Erinnerungsfunktion und Admin-Genehmigungsworkflow. Das System protokolliert die Erfüllungsquote der Wünsche.

Arbeitszeit-Prozentsatz:
Pro Arbeitsplatz kann ein Arbeitszeit-Prozentsatz konfiguriert werden (z.B. 70% für Rufbereitschaft). Dieser Wert fließt in die FTE-gewichtete Fairness-Berechnung der Kostenfunktion ein und sorgt dafür, dass Dienste unterschiedlicher Wertigkeit fair verteilt werden.

Zeitfenster-System (Timeslots):
Pro Arbeitsplatz können Zeitfenster definiert werden, um zeitliche Teilbesetzungen zu ermöglichen (z.B. OP-Säle mit Früh- und Spätteam, Schichtwechsel). Das System ist als Opt-in konzipiert mit strikter Rückwärtskompatibilität. Bestehende Einträge ohne Timeslot gelten als ganztägig.

Statistiken (Statistics):
Auswertungen über die Verteilung von Diensten, Rotationen und Abwesenheiten. Grafische Darstellung als Balkendiagramme und Tabellen. Export-Möglichkeit der Daten. Wunscherfüllungsberichte und Compliance-Reports.

Administration (Admin):
Zentrale Verwaltungsoberfläche für Systemadministratoren. Benutzerverwaltung mit Rollen und Berechtigungen inklusive E-Mail-Verifizierung. Datenbank-Wartungsfunktionen. Systemprotokollierung. Einstellungen für Farbschemata, Abschnittskonfiguration und weitere Anpassungen.


## Sicherheit und Datenschutz

Die Anwendung implementiert folgende Sicherheitsmaßnahmen:

- Authentifizierung über JWT-Token mit konfigurierbarer Gültigkeitsdauer
- Passwörter werden mit bcrypt gehasht und niemals im Klartext gespeichert
- HTTPS-Verschlüsselung für alle Verbindungen (bei korrekter Server-Konfiguration)
- Rollenbasierte Zugriffskontrolle (Admin, User, Read-Only)
- Rate-Limiting zum Schutz vor Brute-Force-Angriffen
- Helmet-Middleware für HTTP-Security-Header
- Mandantenspezifische Datenbanktrennung bei Multi-Tenant-Betrieb

Für den Betrieb in Krankenhausumgebungen wird empfohlen:
- Betrieb hinter einem Reverse-Proxy mit SSL-Terminierung
- Regelmäßige Datensicherung der MySQL-Datenbank
- Integration in das vorhandene Netzwerk- und Firewall-Konzept
- Prüfung der Kompatibilität mit lokalen Datenschutzrichtlinien


## Installation und Deployment

Die Anwendung kann auf verschiedenen Plattformen betrieben werden:

Lokale Installation:
1. Repository klonen
2. Dependencies installieren mit npm install im Hauptverzeichnis und im server-Verzeichnis
3. Umgebungsvariablen konfigurieren (siehe Abschnitt Konfiguration)
4. MySQL-Datenbank einrichten und Migrationen ausführen
5. Frontend bauen mit npm run build
6. Server starten mit npm start im server-Verzeichnis

Cloud-Deployment (Railway):
Die Anwendung ist für das Deployment auf Railway optimiert. Detaillierte Anleitungen finden sich in den Dateien RAILWAY_DEPLOYMENT.md und RAILWAY_QUICKSTART.md. Railway bietet eine einfache Möglichkeit, sowohl das Frontend als auch das Backend inklusive MySQL-Datenbank zu hosten.

Docker:
Ein Dockerfile ist im Repository enthalten und ermöglicht den Betrieb in Container-Umgebungen.


## Konfiguration

Die Anwendung wird über Umgebungsvariablen konfiguriert:

MYSQL_HOST: Hostname des MySQL-Servers
MYSQL_PORT: Port des MySQL-Servers (Standard: 3306)
MYSQL_USER: Datenbankbenutzer
MYSQL_PASSWORD: Datenbankpasswort
MYSQL_DATABASE: Name der Datenbank
JWT_SECRET: Geheimer Schlüssel für die JWT-Signierung (mindestens 32 Zeichen)
PORT: Port für den Express-Server (Standard: 3000)

Optionale Variablen für erweiterte Funktionen:
ENCRYPTION_KEY: Schlüssel für die Verschlüsselung von Mandanten-Datenbankzugangsdaten
GOOGLE_CALENDAR_CREDENTIALS: Zugangsdaten für Google Calendar Integration
OPENAI_API_KEY: API-Schlüssel für KI-gestütztes AutoFill und Planungsoptimierung
MISTRAL_API_KEY: Alternativer API-Schlüssel für Mistral-basierte KI-Funktionen
SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS: Konfiguration für E-Mail-Versand (Verifizierung, Benachrichtigungen)


## Datenmodell

Die Anwendung verwendet folgende Haupttabellen:

app_users: Benutzerkonten mit Authentifizierungsdaten und Einstellungen (inkl. E-Mail-Verifizierung und must_change_password)
doctors: Mitarbeiterstammdaten (Ärzte und sonstiges Personal)
shift_entries: Einzelne Dienstplaneinträge mit Datum, Person, Position und optionalem Timeslot
workplaces: Konfigurierbare Arbeitsbereiche und Dienste (mit affects_availability, work_time_percentage und Timeslot-Konfiguration)
wish_requests: Dienstwünsche der Mitarbeiter mit Status-Workflow (approved/pending/declined)
color_settings: Anpassbare Farbschemata für Rollen und Abwesenheiten
system_settings: Globale Systemeinstellungen
staffing_plan_entries: Stellenplaneinträge pro Mitarbeiter und Zeitraum
team_roles: Konfigurierbare Rollen mit Priorität und granularen Berechtigungen (can_do_vd, can_do_hd, excluded_from_stats, is_fachArzt)
qualifications: Verfügbare Qualifikationen (z.B. CT, MRT, Sono)
workplace_qualifications: Zuordnung von Qualifikationen zu Arbeitsplätzen mit 4-stufigem Level (Pflicht/Sollte/Sollte-nicht/Nicht)
doctor_qualifications: Zuordnung von Qualifikationen zu Mitarbeitern
training_rotations: Ausbildungsrotationen mit Zeitraum, Mitarbeiter und Arbeitsplatz
workplace_timeslots: Zeitfenster-Definitionen pro Arbeitsplatz
email_verification: E-Mail-Verifizierungstokens
schedule_rules: Benutzerdefinierte KI-Planungsregeln in natürlicher Sprache

Die Tabellenstruktur kann über die SQL-Migrationen im Verzeichnis server/migrations angepasst werden.


## Schnittstellen und Integrationen

REST-API:
Alle Funktionen sind über eine dokumentierte REST-API erreichbar. Die API verwendet JSON als Datenaustauschformat. Authentifizierung erfolgt über Bearer-Token im Authorization-Header.

Kalender-Synchronisation:
Optionale Integration mit Google Calendar zur automatischen Synchronisation von Diensten.

Excel-Export:
Dienstpläne können als Excel-Dateien exportiert werden zur Weitergabe oder Archivierung.


## Wartung und Support

Datenbank-Backup:
Regelmäßige Backups der MySQL-Datenbank werden dringend empfohlen. Die Anwendung selbst speichert keine persistenten Daten außerhalb der Datenbank.

Logging:
Das Backend protokolliert Zugriffe und Fehler. Die Logs können über die Admin-Oberfläche eingesehen werden.

Updates:
Bei Updates sollte zunächst ein Backup erstellt werden. Anschließend können die neuen Dateien eingespielt und eventuell erforderliche Datenbankmigrationen ausgeführt werden.


## Technologie-Stack

Frontend:
- React 18 mit Vite
- TanStack Query für Datenverwaltung
- Tailwind CSS für Styling
- Radix UI für Basiskomponenten
- date-fns für Datumsberechnungen
- Recharts für Diagramme

Backend:
- Node.js mit Express
- MySQL mit mysql2-Treiber
- JWT für Authentifizierung
- bcrypt für Passwort-Hashing
- Helmet für Security-Header
- express-rate-limit für Anfragebegrenzung


## Lizenz und Haftung

Diese Software wird ohne Gewährleistung bereitgestellt. Der Einsatz in produktiven Umgebungen erfolgt auf eigene Verantwortung. Vor dem produktiven Einsatz sollte eine umfassende Prüfung der Sicherheits- und Datenschutzanforderungen der jeweiligen Einrichtung erfolgen.


## Kontakt und Weiterentwicklung

Das Projekt wird aktiv weiterentwickelt. Für Fragen zur Implementierung, Anpassungen oder Integration in bestehende Krankenhausinfrastrukturen kann der Entwickler kontaktiert werden.

Repository: https://github.com/andreasknopke/CuraFlow
