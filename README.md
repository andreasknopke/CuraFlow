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
Die AutoFill-Funktion erzeugt Vorschläge für einen offenen Wochenplan. Die Planentscheidung ist deterministisch und rein regelbasiert, es kommt also keine KI zum Einsatz. Die Engine läuft vollständig im Browser und überträgt keine Planungsdaten an externe Dienste. Alle Vorschläge werden zunächst als Preview-Einträge angezeigt und erst nach Freigabe durch den Planer übernommen; automatische Einzelentscheidungen ohne menschliche Bestätigung finden nicht statt.


Kostenfunktion:
Eine einheitliche additive Kostenfunktion bewertet alle Planungsdimensionen als numerischen Score. Optimiert werden 10 Dimensionen: Qualifikations-Match, Rotations-Passung, FTE-gewichtete Fairness, Auswirkung auf andere Arbeitsplätze (Unterbesetzungsfolgen), Dienstwünsche, Wochenbalance, Displacement-Bonus für verdrängte Rotationsärzte, Sollte-nicht-Penalty, Alleinbesetzer-Strafe und Dienstlimits. Alle Gewichte sind als zentrale Konstanten konfigurierbar.

Preview-Modus:
Bei der automatischen Planfüllung werden Vorschläge als Preview-Einträge halbtransparent mit gestricheltem Rahmen angezeigt. Im Preview-Modus können Vorschläge per Drag & Drop zwischen Positionen verschoben werden, bevor sie übernommen oder verworfen werden. Ein farbkodiertes Fairness-Badge zeigt die Dienstanzahl der letzten 4 Wochen, Wochenenddienste und Dienstwünsche an.

Qualifikationssystem:
CuraFlow bietet ein 4-stufiges Qualifikationssystem für Arbeitsplätze und Mitarbeiter. Pro Arbeitsplatz können Qualifikationen als Pflicht (Mitarbeiter muss die Qualifikation besitzen), Sollte (bevorzugt qualifiziert, aber Unqualifizierte erlaubt), Sollte nicht (Qualifizierte nur wenn kein anderer verfügbar) oder Nicht/Ausschlusskriterium (Mitarbeiter mit dieser Qualifikation darf nie eingeteilt werden) konfiguriert werden. Mitarbeitern werden Qualifikationen über einen eigenen Editor zugewiesen. Sowohl die AutoFill-Engine als auch die manuelle Einteilung prüfen alle vier Stufen und zeigen entsprechende Warnungen oder Blocker an.

Mitarbeiterverwaltung (Staff):
Verwaltung aller Ärzte und Mitarbeiter mit ihren Stammdaten. Jeder Mitarbeiter kann einer Rolle zugeordnet werden (zB. Chefarzt, Oberarzt, Facharzt, Assistenzarzt, Nicht-Radiologe). Die Reihenfolge der Anzeige ist konfigurierbar. Es können Qualifikationen und Einschränkungen hinterlegt werden.

Tisoware-Import und zentrale Mitarbeiterverknüpfung:
CuraFlow kann Teile des Zeiterfassungssystems Tisoware auslesen (READ ONLY). Beim Anlegen eines neuen Teammitglieds (Team → „Teammitglied hinzufügen" → „Mit zentralem Mitarbeiter verknüpfen") kann ein Mitarbeiter aus der zentralen Mitarbeiterverwaltung ausgewählt werden. Dabei werden folgende planungsrelevante Daten automatisch in das Formular übernommen:
- Name (Vor- und Nachname)
- E-Mail-Adresse (als Arbeits-E-Mail und Kalender-E-Mail)
- Soll-Stunden pro Woche
- Funktion (aus der zentralen Position)

Zusätzlich kann die Liste über eine Kostenstelle gefiltert werden (z. B. „9642000 – Station Intensivmedizin"); die Kostenstelle selbst wird nur als Filter verwendet. Diese Stammdaten stammen aus der zentralen Mitarbeiterverwaltung, die über den Tisoware- und Stammdaten-Import befüllt wird.

Berechtigungen (wer kann das / wer sieht die Daten):
- Die Mitarbeiter-Seite („Team") einschließlich des Dialogs „Teammitglied hinzufügen" ist nur für Administratoren (Rolle `admin`) sichtbar. Reguläre Nutzer und Read-Only-Nutzer sehen diese Seite nicht.
- Das Verknüpfen eines Mitarbeiters (zentral ↔ Mandant) erfordert die Berechtigung `can_link_employees` („Mitarbeiter-Verknüpfung"), die nur Administratoren granular zugewiesen werden kann.
- Die zentrale Mitarbeiterverwaltung (Master-Daten) ist zusätzlich über die Berechtigung `can_manage_master_data` geschützt.
- Hinweis: Der Abruf der zentralen Mitarbeiterliste über die API (`GET /api/staff/central-employees`) ist derzeit nur durch die Anmeldung (JWT) geschützt, nicht durch eine feingranulare Berechtigung. Technisch kann damit jeder angemeldete Benutzer Name, E-Mail, Funktion, Kostenstelle und Soll-Stunden der zentralen Mitarbeiter abrufen. Die Benutzeroberfläche beschränkt den Zugriff jedoch auf Administratoren.

Tisoware-Abwesenheitsimport:
Neben der Mitarbeiterverknüpfung importiert CuraFlow Abwesenheitsdaten aus dem Zeiterfassungssystem Tisoware (nächtlicher Import). Dabei werden die in Tisoware erfassten Abwesenheiten (Krank, Urlaub, Dienstreise, Frei, Mutterschutz, Elternzeit etc.) in die zentrale Abwesenheitsverwaltung von CuraFlow übernommen.

Importierte Daten und Abbildung:
- Die Abwesenheiten werden über die Personalnummer (PSPERSNR) den zentralen Mitarbeitern zugeordnet.
- Tisoware-Abwesenheitscodes (LOANR) werden auf die kanonischen CuraFlow-Abwesenheitspositionen abgebildet (z. B. Krank, Urlaub, Dienstreise, Frei, Nicht verfügbar).
- **Datenschutz (Art. 9 DSGVO):** Krankheits-Subtypen (z. B. „Krank mit AU-Bescheinigung", „Krank Quarantäne", „Krank Infektion") und Original-Abwesenheitsgründe werden als Zusatzvermerk (`[TISO:CODE]`) im Notizfeld der zentralen Abwesenheitsverwaltung gespeichert (Nachvollziehbarkeit des Imports). Diese gesundheitsbezogenen Detailinformationen werden in der Benutzeroberfläche **nicht angezeigt** (Datenminimierung auf Anzeigeebene); der Zugriff ist auf Administratoren mit Systemverwaltungs-Berechtigung beschränkt.
- Mutterschutz und Elternzeit werden auf „Nicht verfügbar" abgebildet; der ursprüngliche Grund bleibt als TISO-Vermerk im Notizfeld erhalten (ebenfalls nicht in der UI angezeigt).

Konfliktbehandlung:
- `CentralAbsenceEntry` hat einen eindeutigen Schlüssel (Mitarbeiter, Datum). Bei einem Konflikt gilt: Gleiche Position → überspringen; unterschiedliche Position → Prioritätsvergleich (Tisoware vs. zentral); bei Gleichstand bleibt der Eintrag unverändert (Konflikt wird gemeldet).
- Beim manuellen Import kann die Konfliktauflösung zugeschaltet werden; der nächtliche Automatik-Import läuft mit automatischer Konfliktauflösung.

Berechtigung:
- Alle Tisoware-Import-Endpunkte (`/api/master/tisoware/*`) erfordern zusätzlich zur Anmeldung die Berechtigung `can_manage_system` (Systemverwaltung). Nur Administratoren mit dieser Berechtigung können den Import ausführen, Vorschauen erzeugen oder Mitarbeiter in Tisoware suchen.
- Der nächtliche Automatik-Import (Cron, 01:30 Uhr Serverzeit) kann über die Umgebungsvariable `TISOWARE_AUTO_IMPORT=false` deaktiviert werden (Standard: aktiv).

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

Betrieb in der Krankenhaus-Umgebung (umgesetzt):
- Betrieb hinter einem Reverse-Proxy mit SSL-Terminierung
- Integration in das vorhandene Netzwerk- und Firewall-Konzept des Krankenhauses (erfolgt)
- Tägliche Datensicherung der MySQL-Datenbank (erfolgt)
- Tägliche Spiegelung des Coolify-Servers (erfolgt)



## Installation und Deployment

Die Anwendung kann auf verschiedenen Plattformen betrieben werden:

Lokale Installation:
1. Repository klonen
2. Dependencies installieren mit npm install im Hauptverzeichnis und im server-Verzeichnis
3. Umgebungsvariablen konfigurieren (siehe Abschnitt Konfiguration)
4. MySQL-Datenbank einrichten und Migrationen ausführen
5. Frontend bauen mit npm run build
6. Server starten mit npm start im server-Verzeichnis

Deployment im Krankenhaus (lokaler Server / Coolify):
Die Anwendung wird im Krankenhaus auf einem lokalen Server betrieben (Docker/Coolify). Frontend, Backend und sämtliche MySQL-Datenbanken laufen vollständig in der lokalen Infrastruktur des Krankenhauses. Es werden keine Benutzerdaten in eine Cloud hochgeladen; alle Datenbanken liegen auf lokalen Servern im Krankenhaus.

Docker:
Ein Dockerfile ist im Repository enthalten und ermöglicht den Betrieb in Container-Umgebungen (z. B. Coolify auf einem lokalen Server).


## Nutzung als Endanwender (PWA)

CuraFlow wird als Website betrieben und ist unter folgender Adresse erreichbar:

https://cf.coolify.kliniksued-rostock.de/

Die Seite ist sowohl innerhalb des Krankenhausnetzes als auch außerhalb (z. B. über mobiles Internet) erreichbar. Für die Anmeldung werden Zugangsdaten benötigt, die vom Administrator vergeben werden.

### Auf Desktop-PCs (Google Chrome)

1. Chrome öffnen und die Adresse **https://cf.coolify.kliniksued-rostock.de/** aufrufen
2. Oben rechts im Browser auf das Installationssymbol (Monitor mit Pfeil) klicken
   - Alternativ: Menü (⋮) → **„CuraFlow installieren"** bzw. **„Als App installieren"**
3. Im Dialog **„Installieren"** bestätigen

CuraFlow wird damit als eigenständige App (Progressive Web App) installiert und ist über eine Verknüpfung auf dem Desktop startbar. Ein separates Installationsprogramm ist nicht erforderlich.

### Auf Smartphones (Android / iOS)

1. Browser öffnen (z. B. Chrome auf Android, Safari auf iOS) und die Adresse **https://cf.coolify.kliniksued-rostock.de/** aufrufen
2. Anmelden und die Seite als App installieren:
   - **Android (Chrome):** Menü (⋮) → **„App installieren"** bzw. **„Zum Startbildschirm hinzufügen"**
   - **iOS (Safari):** Teilen-Button → **„Zum Home-Bildschirm"**
3. Das CuraFlow-Symbol erscheint auf dem Startbildschirm und öffnet die App im Vollbildmodus

**Hinweis:** Die Nutzung ist als PWA möglich (App-Start im eigenen Fenster). Da die Anwendung online verbunden bleibt und keine Daten dauerhaft auf dem Gerät speichert, ist für die Nutzung eine Internetverbindung zur CuraFlow-Adresse erforderlich.


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
SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS: Konfiguration für E-Mail-Versand (Verifizierung, Benachrichtigungen)
VITE_JITSI_BASE_URL: Basis-URL für CoWork-Videokonferenzen (Standard: https://meet.jit.si)

Hinweis zu CoWork:
Die Jitsi-Einbettung kann kostenlos betrieben werden, indem entweder `meet.jit.si` (öffentlich, ohne SLA) genutzt wird oder eine eigene Jitsi-Instanz über `VITE_JITSI_BASE_URL` eingebunden wird (empfohlen für produktive Nutzung).


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
schedule_rules: Planungsregeln (Tabelle vorhanden; derzeit kein aktives Feature nutzt sie)

Die Tabellenstruktur kann über die SQL-Migrationen im Verzeichnis server/migrations angepasst werden.


## Schnittstellen und Integrationen

REST-API:
Alle Funktionen sind über eine dokumentierte REST-API erreichbar. Die API verwendet JSON als Datenaustauschformat. Authentifizierung erfolgt über Bearer-Token im Authorization-Header.

Excel-Export:
Dienstpläne können als Excel-Dateien exportiert werden zur Weitergabe oder Archivierung.


## Wartung und Support

Datenbank-Backup:
Die MySQL-Datenbank wird einmal täglich gesichert. Zusätzlich wird der Coolify-Server einmal täglich gespiegelt. Damit sind sowohl die Anwendungsdaten als auch die Server-Infrastruktur regelmäßig gesichert. Die Anwendung selbst speichert keine persistenten Daten außerhalb der Datenbank.

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

Dieses Projekt steht unter der [MIT-Lizenz](LICENSE). Copyright (c) 2026 andreasknopke.

Diese Software wird ohne Gewährleistung bereitgestellt. Der Einsatz in produktiven Umgebungen erfolgt auf eigene Verantwortung. Vor dem produktiven Einsatz sollte eine umfassende Prüfung der Sicherheits- und Datenschutzanforderungen der jeweiligen Einrichtung erfolgen.


## Kontakt und Weiterentwicklung

Das Projekt wird aktiv weiterentwickelt. Für Fragen zur Implementierung, Anpassungen oder Integration in bestehende Krankenhausinfrastrukturen kann der Entwickler kontaktiert werden.

Repository: https://github.com/andreasknopke/CuraFlow
