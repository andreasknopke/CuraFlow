# Gap-Analyse: Digitale Zeiterfassung – Konkurrenzvergleich

> **Stand:** Juni 2025  
> **Bezug:** [TIMETRACKING.md](TIMETRACKING.md) (CuraFlow-Umsetzungsplan)  
> **Ziel:** Systematischer Abgleich der Funktionalitäten einer etablierten Zeiterfassungssoftware mit den vorhandenen und geplanten CuraFlow-Funktionen  
> **Zielplattform:** Master-Frontend (mandantenübergreifend) + Mandanten-Frontend

---

## Legende

| Symbol | Bedeutung |
|--------|-----------|
| ✅ | **Vorhanden** – In CuraFlow produktiv implementiert |
| 🔄 | **Teilweise** – Grundfunktion vorhanden, Erweiterung nötig |
| 📋 | **Geplant** – Im Umsetzungsplan dokumentiert, noch nicht implementiert |
| ❌ | **Fehlt** – Weder vorhanden noch geplant, Umsetzung prüfen |
| ⊘ | **Nicht benötigt** – Beim aktuellen Kunden irrelevant (keine Terminals, manuelle Erfassung) |

---

## 1. Stammdaten / Personalverwaltung

| # | Konkurrenz-Feature | CuraFlow | Status | Anmerkung |
|---|---|---|---|---|
| 1.1 | Mitarbeiter-Stammdaten (Name, Adresse, Geburtsdatum, Eintritt, Austritt) | `doctors`-Tabelle: name, email, phone, address, contract_end_date | 🔄 | Geburtsdatum und Eintrittsdatum fehlen als Felder |
| 1.2 | Personalnummer / Lohnbuchhaltungs-ID | `payroll_id` auf `doctors` | ✅ | Feld vorhanden |
| 1.3 | Organisationseinheiten / Abteilungszuordnung | Multi-Tenant = 1 Mandant pro Abteilung | ✅ | Über Mandantenstruktur abgebildet |
| 1.4 | Kostenstellen-Zuordnung | – | ❌ | Kein Kostenstellenfeld; ggf. als Custom-Feld ergänzen |
| 1.5 | Qualifikationsverwaltung | `Qualification`, `DoctorQualification`, `WorkplaceQualification` | ✅ | 4-stufiges System (Mandatory/Preferred/Discouraged/Excluded), Ablaufdatum |
| 1.6 | Vertragsarten / Arbeitszeitmodell | `fte`, `vk_share`, `target_hours_per_week`, `work_time_percentage` | 🔄 | Grundfelder vorhanden; formale Vertragsarten (Vollzeit/Teilzeit/Minijob) nicht als Enum |
| 1.7 | Mitarbeiter-Foto / Avatar | – | ❌ | Nicht implementiert; niedrige Priorität |
| 1.8 | Historisierung (Vertragsänderungen über Zeit) | – | ❌ | Kein Audit-Trail für Stammdatenänderungen |
| 1.9 | Import/Export von Stammdaten | – | ❌ | Kein CSV/Excel-Import für Stammdaten |
| 1.10 | Team-Rollen mit Berechtigungen | `TeamRole` mit `priority`, `is_specialist`, `can_do_foreground_duty` etc. | ✅ | Vollständig konfigurierbar |
| 1.11 | Mehrfach-Beschäftigung (MA in mehreren OEs) | Cross-Tenant-Abfrage im Master-Frontend | 🔄 | MA existiert pro Mandant separat, keine verknüpfte Identität |

**Bewertung:** Stammdaten sind für den Kernbedarf ausreichend. Kritische Lücke ist die fehlende **Historisierung** – bei Vertragsänderungen (z. B. Stundenreduzierung ab Datum X) kann CuraFlow aktuell nur den aktuellen Stand abbilden.

**Empfehlung:**
- 🟡 Geburtsdatum + Eintrittsdatum als Felder ergänzen (geringer Aufwand)
- 🟡 Vertragsart-Enum einführen (Vollzeit/Teilzeit/Minijob/Werkstudent)
- 🔴 Historisierung als eigenständiges Feature prüfen (hoher Aufwand, aber für HR-Compliance relevant)

---

## 2. Arbeitszeitmodelle

| # | Konkurrenz-Feature | CuraFlow | Status | Anmerkung |
|---|---|---|---|---|
| 2.1 | Wöchentliche Soll-Stunden pro MA | `target_hours_per_week` auf `doctors` | 📋 | Feld im Schema geplant, noch nicht migriert |
| 2.2 | Gleitzeit mit Kernarbeitszeit | – | ❌ | Kein Gleitzeitmodell definierbar |
| 2.3 | Schichtmodelle (Früh/Spät/Nacht) | `WorkplaceTimeslot` mit `start_time`/`end_time`, `spans_midnight` | ✅ | Pro Arbeitsplatz konfigurierbare Zeitfenster |
| 2.4 | Teilzeit-Modelle (60%, 75%, etc.) | `vk_share`, `work_time_percentage`, `fte` | ✅ | VK-Anteil pro Monat über StaffingPlanEntry |
| 2.5 | Wochenarbeitstage-Definition (3-Tage-Woche etc.) | – | ❌ | Kein Feld für individuelle Arbeitstage-Muster |
| 2.6 | Jahresarbeitszeitkonto | – | ❌ | Nur Monatssalden geplant (TimeAccount), kein Jahresmodell |
| 2.7 | Rahmenarbeitszeiten (früheste Kommt-Zeit, späteste Geht-Zeit) | – | ❌ | Keine Min/Max-Grenzen pro MA oder Modell |
| 2.8 | Pausenregelungen (automatisch/manuell) | – | ❌ | Keine Pausenabzugsregel hinterlegt |
| 2.9 | Arbeitszeitgesetz-Validierung (max. 10h/Tag, 48h/Woche, 11h Ruhezeit) | ComplianceReport: Max. aufeinanderfolgende Tage, Wochenend-Belastung | 🔄 | Teilweise – ArbZG-Grenzen nicht explizit konfiguriert |
| 2.10 | Saisonale / rotierende Arbeitszeitmodelle | – | ❌ | Kein Modellwechsel nach Zeitraum |
| 2.11 | Bereitschaftsdienst-Modelle | `service_type` (1=BD, 2=RB, 3=SD), `work_time_percentage` | ✅ | Prozentuale Anrechenbarkeit konfigurierbar |
| 2.12 | Rufbereitschafts-Anrechnung | `work_time_percentage` (z. B. 70%) | ✅ | In Arbeitszeitberechnung integriert |

**Bewertung:** Schichtmodelle und Bereitschaftsdienste sind stark. Die größte Lücke ist die fehlende **Pausenregelung** – das ArbZG schreibt bei >6h eine 30-Min-Pause und bei >9h eine 45-Min-Pause vor.

**Empfehlung:**
- 🔴 **Pausenregelung** implementieren (rechtlich erforderlich für korrekte Nettoarbeitszeit)
- 🟡 ArbZG-Grenzen als konfigurierbare Regeln im ComplianceReport ergänzen
- 🟡 `target_hours_per_week` Migration ausführen (Phase 1 aus TIMETRACKING.md)
- ⚪ Gleitzeit-Kernzeitmodell nur bei Bedarf (aktuell keine Terminals)

---

## 3. Zeitbuchungen (Kommt/Geht)

| # | Konkurrenz-Feature | CuraFlow | Status | Anmerkung |
|---|---|---|---|---|
| 3.1 | Terminal-Buchung (Stempeluhr, Transponder) | – | ⊘ | Beim Kunden nicht im Einsatz |
| 3.2 | Mobile Zeiterfassung (App) | – | ⊘ | Nicht benötigt (manuelle Erfassung durch HR) |
| 3.3 | Web-basierte Selbst-Buchung durch MA | – | ⊘ | HR erfasst, MA bucht nicht selbst |
| 3.4 | Manuelle Kommt/Geht-Buchung durch HR | Geplant: Buchungsmaske nutzt `shift_entries.start_time`/`end_time` | 📋 | Phase 1.3 in TIMETRACKING.md |
| 3.5 | Nachträgliche Korrektur von Buchungen | `shift_entries` editierbar (Admin) | 🔄 | Editierbar, aber kein Korrektur-Audit-Trail |
| 3.6 | Paarbildung Kommt/Geht | – | 📋 | Über start_time/end_time auf shift_entries abbildbar |
| 3.7 | Buchungsart-Erkennung (Dienstgang, Arztbesuch etc.) | 5 Abwesenheitstypen + Rotationen/Dienste | 🔄 | Dienstgang fehlt als expliziter Typ |
| 3.8 | Geo-Fencing / Standortprüfung | – | ⊘ | Nicht benötigt |
| 3.9 | Automatische Pausenerkennung/-abzug | – | ❌ | Siehe §2.8 |
| 3.10 | Fehlbuchungs-Erkennung (doppelt, fehlend) | Validierung in ScheduleBoard (Doppelbelegung, Mindestbesetzung) | 🔄 | Für Schichtplan ja, für reine Kommt/Geht-Buchungen noch nicht |
| 3.11 | Offene-Buchungen-Warnung (Kommt ohne Geht) | – | ❌ | Kein automatischer Check |
| 3.12 | Massenerfassung (mehrere MA gleichzeitig) | Geplant: Bulk-Eingabe in Buchungsmaske | 📋 | Phase 1.3 |

**Bewertung:** Da beim Kunden keine Terminals existieren, entfallen die meisten Terminal-Features. Die **manuelle HR-Buchungsmaske** (Phase 1.3) ist der kritische Baustein und korrekt geplant.

**Empfehlung:**
- 🔴 Phase 1.3 (Buchungsmaske) priorisieren – Kernfunktion für den Ersatz
- 🟡 Korrektur-Audit-Trail ergänzen (wer hat wann was geändert)
- 🟡 Offene-Buchungen-Warnung als Dashboard-Widget

---

## 4. Zeitkonten & Salden

| # | Konkurrenz-Feature | CuraFlow | Status | Anmerkung |
|---|---|---|---|---|
| 4.1 | Gleitzeitkonto (kumuliertes Plus/Minus) | `TimeAccount`-Tabelle geplant mit balance_minutes, carry_over, total_balance | 📋 | Phase 2 in TIMETRACKING.md |
| 4.2 | Überstundenkonto (separat) | – | ❌ | Nur ein Gesamtsaldo geplant, kein separates ÜSt-Konto |
| 4.3 | Urlaubskonto (Anspruch/Genommen/Rest) | `vacation_days` auf `doctors` + errechnete Urlaubstage aus shift_entries | 🔄 | Urlaubsanspruch vorhanden, kein formelles Kontensystem |
| 4.4 | Mehrfach-Kontenmodell (Gleitzeit + ÜSt + Langzeitkonto) | – | ❌ | Nur 1 Konto geplant |
| 4.5 | Automatische Saldo-Berechnung (Ist - Soll) | WorkingTimeReport berechnet Ist; Soll/Ist-Vergleich geplant | 📋 | Phase 1.2 + 2.2 |
| 4.6 | Vortrag ins Folgemonat | `carry_over` in TimeAccount geplant | 📋 | Phase 2.4 |
| 4.7 | Kappungsgrenzen (max. +40h, min. -20h etc.) | – | ❌ | Offene Frage #4 in TIMETRACKING.md |
| 4.8 | Verfallsfristen für Überstunden | – | ❌ | Offene Frage #4 |
| 4.9 | Manuelle Korrekturbuchung auf Konto | – | ❌ | Kein manueller +/- Eintrag auf TimeAccount |
| 4.10 | Konten-Übersicht (Dashboard) | MasterEmployeeDetail: Zeitkonto-Tab (UI fertig, Backend fehlt) | 📋 | UI im Master-Frontend vorhanden |
| 4.11 | Abgeltung von Überstunden (Auszahlung) | – | ❌ | Kein Workflow für ÜSt-Auszahlung |
| 4.12 | Rückstellungsberechnung (für Buchhaltung) | – | ❌ | Kein Bilanzierungsfeature |

**Bewertung:** Das geplante `TimeAccount`-Modell deckt die Kernfunktionen Gleitzeitkonto + Vortrag ab. Für den aktuellen Kunden reicht ein Single-Konto-Ansatz vermutlich aus.

**Empfehlung:**
- 🔴 TimeAccount-Migration + Backend (Phase 2) zeitnah umsetzen
- 🟡 Kappungsgrenzen als konfigurierbare Parameter einbauen (Feld `max_balance`/`min_balance` auf TimeAccount oder globale Einstellung)
- 🟡 Manuelle Korrekturbuchung ermöglichen (z. B. für Arbeitszeitnachweise von Kongressen)
- ⚪ Separates Überstundenkonto nur bei expliziter Kundenanforderung

---

## 5. Zuschläge & Zulagen

| # | Konkurrenz-Feature | CuraFlow | Status | Anmerkung |
|---|---|---|---|---|
| 5.1 | Nachtzuschlag (z. B. 20:00–06:00) | – | ❌ | Kein Zuschlagssystem |
| 5.2 | Wochenendzuschlag (Sa/So differenziert) | – | ❌ | |
| 5.3 | Feiertagszuschlag | Feiertage erkannt (MV), aber kein Zuschlag berechnet | ❌ | Feiertagsdaten vorhanden |
| 5.4 | Überstundenzuschlag (>8h, >10h abgestuft) | – | ❌ | |
| 5.5 | Bereitschaftsdienstzuschlag | `work_time_percentage` bildet Anrechenbarkeit ab, nicht Zuschlag | 🔄 | Anrechenbarkeit ≠ Zuschlag |
| 5.6 | Rufbereitschaftspauschale | – | ❌ | |
| 5.7 | Schichtzulage | – | ❌ | |
| 5.8 | Mehrarbeitszuschlag (Teilzeit > vertragliche Stunden) | – | ❌ | |
| 5.9 | Zuschlagskatalog (konfigurierbar) | – | ❌ | |
| 5.10 | Lohnarten-Mapping | – | ❌ | Für Loga-Export geplant, aber Format unklar |

**Bewertung:** Die Zuschlagsberechnung ist die **größte funktionale Lücke** gegenüber der Konkurrenzsoftware. Allerdings wird die Zuschlagsberechnung typischerweise im Lohnabrechnungssystem (Loga) durchgeführt, nicht im Zeiterfassungssystem.

**Empfehlung:**
- 🟡 Klären, ob Zuschläge in CuraFlow berechnet werden müssen oder ob Loga das übernimmt
- 🟡 Falls CuraFlow: Zuschlagskatalog-Tabelle einführen (`SurchargeRule`: Zeitraum, Typ, Prozent/Festbetrag)
- 🟡 Lohnarten-Mapping als Teil der Loga-Schnittstelle (Phase 4) umsetzen
- ⚪ Bei reinem Datentransfer an Loga: Nur die Brutto-Arbeitszeiten + Zeiträume exportieren, Loga rechnet Zuschläge

---

## 6. Fehlzeiten & Abwesenheiten

| # | Konkurrenz-Feature | CuraFlow | Status | Anmerkung |
|---|---|---|---|---|
| 6.1 | Urlaubsverwaltung mit Jahreskalender | Vacation.jsx: Jahreskalender mit Range-Selektion, Drag&Drop | ✅ | Sehr gut implementiert |
| 6.2 | Krankheitsmeldung | ShiftEntry mit position='Krank' | ✅ | |
| 6.3 | Sonderurlaub (Hochzeit, Todesfall, Umzug etc.) | – | 🔄 | Nur 5 Typen (Urlaub, Krank, Frei, Dienstreise, Nicht verfügbar); Sonderurlaub fehlt als Kategorie |
| 6.4 | Elternzeit / Mutterschutz | StaffingPlanEntry: Sonderstatus EZ, MS | ✅ | Über Stellenplan abgebildet + automatische Nicht-verfügbar-Sync |
| 6.5 | Fortbildung / Kongress | ShiftEntry mit position='Fortbildung'/'Kongress' | ✅ | In Abwesenheitstypen vorhanden |
| 6.6 | Unbezahlter Urlaub | – | 🔄 | Kein eigener Typ; über 'Frei' oder 'Nicht verfügbar' abbildbar |
| 6.7 | Kur / Reha | – | ❌ | Fehlender Abwesenheitstyp |
| 6.8 | Bildungsurlaub | – | ❌ | Fehlender Typ |
| 6.9 | Halbe Urlaubstage | – | ❌ | Nur ganztägige Einträge möglich |
| 6.10 | Fehlzeiten-Statistik | MasterAbsences.jsx: 7 Typen, Mandantenübergreifend | ✅ | Im Master-Frontend vorhanden |
| 6.11 | BEM-Trigger (>6 Wochen krank in 12 Monaten) | – | ❌ | Kein automatischer BEM-Hinweis |
| 6.12 | Abwesenheits-Übersicht (Team-Kalender) | VacationOverview: Alle MA × alle Tage | ✅ | Sehr gut |
| 6.13 | Stellvertreter-Regelung | – | ❌ | Kein Vertreter-Konzept bei Abwesenheit |
| 6.14 | Minimale Besetzungsprüfung bei Abwesenheit | ScheduleBoard: Mindestbesetzung pro Workplace | ✅ | Validierung im Dienstplan vorhanden |
| 6.15 | Feiertags-/Schulferien-Kalender | getHolidays.ts + Vacation.jsx: MV-Feiertage + Schulferien | ✅ | |

**Bewertung:** Fehlzeitenverwaltung ist eine der **Stärken** von CuraFlow. Die vorhandenen Typen decken den medizinischen Alltag gut ab.

**Empfehlung:**
- 🟡 Abwesenheitstypen erweitern: Sonderurlaub, Kur/Reha, Bildungsurlaub als konfigurierbare Typen
- 🟡 Halbe Urlaubstage ermöglichen (z. B. über Timeslot-Zuordnung: nur Vormittag Urlaub)
- 🟡 BEM-Frühwarnung als Dashboard-Widget (>30 Krankheitstage in 12 Monaten)
- ⚪ Stellvertreter-Regelung nur bei expliziter Anforderung

---

## 7. Urlaubsplanung

| # | Konkurrenz-Feature | CuraFlow | Status | Anmerkung |
|---|---|---|---|---|
| 7.1 | Urlaubsanspruch pro MA (jährlich) | `vacation_days` auf `doctors` | ✅ | |
| 7.2 | Rest-/Resturlaub-Berechnung | Berechnet in MasterEmployeeList/Detail | 🔄 | Annäherung (Anspruch − gebuchte Urlaubseinträge), kein formelles Konto |
| 7.3 | Urlaubsantrag-Workflow (Beantragen → Genehmigen → Ablehnen) | – | ❌ | Urlaub wird direkt eingetragen, kein Genehmigungsprozess |
| 7.4 | Urlaubssperre für bestimmte Zeiträume | – | ❌ | Kein Sperren-Konzept |
| 7.5 | Verfall von Resturlaub (gesetzl. Frist) | – | ❌ | Kein Verfallsautomatismus |
| 7.6 | Übertrag von Resturlaub ins Folgejahr | – | ❌ | |
| 7.7 | Teamkalender für Urlaubsplanung | VacationOverview + DoctorYearView | ✅ | Hervorragend |
| 7.8 | Konflikterkennung bei Urlaub | ConflictDialog mit Prioritätssystem | ✅ | 5-stufige Priorität, Warnung bei Überschreibung |
| 7.9 | Schul-/Ferien-Markierung im Kalender | ✅ Integriert (MV) | ✅ | |
| 7.10 | Mindestbesetzung bei Urlaubsplanung | Konfigurierbar (Fachärzte/Assistenten Minimum) | ✅ | |

**Bewertung:** Urlaubsplanung funktional stark. Die größte Lücke ist der fehlende **Genehmigungs-Workflow** – in der Konkurrenzsoftware können Mitarbeiter Urlaub beantragen, der dann genehmigt wird.

**Empfehlung:**
- 🔴 **Urlaubsantrags-Workflow** implementieren (MA beantragt → Admin genehmigt/ablehnt → automatische Eintragung)
- 🟡 Urlaubsübertrag/-verfall als Jahresabschluss-Feature
- ⚪ Urlaubssperre als Nice-to-Have

---

## 8. Genehmigungsworkflows

| # | Konkurrenz-Feature | CuraFlow | Status | Anmerkung |
|---|---|---|---|---|
| 8.1 | Mehrstufige Genehmigung (MA → Teamleiter → HR) | – | ❌ | CuraFlow hat nur Admin/User-Rollen |
| 8.2 | Dienstwunsch-Genehmigung | WishRequest: pending → approved/rejected | ✅ | Vollständig mit Auto-Genehmigung |
| 8.3 | Urlaubsantrags-Genehmigung | – | ❌ | Siehe §7.3 |
| 8.4 | Überstunden-Genehmigung | – | ❌ | |
| 8.5 | Zeitkorrektur-Genehmigung | – | ❌ | |
| 8.6 | Monatsabschluss-Freigabe | TimeAccount.is_closed geplant | 📋 | Phase 2.3 |
| 8.7 | Benachrichtigung bei ausstehender Genehmigung | checkAndSendWishReminders(): E-Mail-Erinnerungen für Dienstwünsche | 🔄 | Nur für Wünsche, nicht für Urlaub etc. |
| 8.8 | Vertretungs-Genehmigung (Abwesenheit des Genehmigenden) | – | ❌ | |
| 8.9 | Override bei Regelverstoß (Admin) | OverrideConfirmDialog + useOverrideValidation | ✅ | Validierungs-Override vorhanden |

**Bewertung:** CuraFlow hat einen **pragmatischen Admin-Ansatz** – der Admin entscheidet direkt. Ein mehrstufiger Workflow ist für kleine Abteilungen nicht unbedingt nötig, aber ein Urlaubsantrag-Workflow ist für die Akzeptanz durch die Mitarbeiter wichtig.

**Empfehlung:**
- 🔴 Urlaubsantrags-Workflow (§7.3) – wichtigster fehlender Workflow
- 🟡 Monatsabschluss-Freigabe (Phase 2.3) wie geplant umsetzen
- ⚪ Mehrstufige Genehmigung nur für größere Organisationen relevant

---

## 9. Monatsabschluss

| # | Konkurrenz-Feature | CuraFlow | Status | Anmerkung |
|---|---|---|---|---|
| 9.1 | Periodenabschluss (Monat sperren) | TimeAccount.is_closed geplant | 📋 | Phase 2.3 |
| 9.2 | Vorläufiger Abschluss (Review-Phase) | Workflow: Offen → Vorläufig → Abgeschlossen geplant | 📋 | |
| 9.3 | Nachbuchung trotz Sperre (mit Berechtigung) | Middleware-Check bei shift_entries geplant | 📋 | |
| 9.4 | Saldo-Übernahme ins Folgemonat | carry_over in TimeAccount | 📋 | Phase 2.4 |
| 9.5 | Monatsblatt / Stundenzettel pro MA | – | ❌ | Kein druckbarer Monatsnachweis |
| 9.6 | Loga-Datenübergabe bei Abschluss | Loga-Schnittstelle geplant (Format unklar) | 📋 | Phase 4 |
| 9.7 | Differenzprotokoll (was wurde nach Abschluss geändert) | – | ❌ | |
| 9.8 | Sammelabschluss (alle MA einer Abteilung) | – | ❌ | |
| 9.9 | Abschluss-Checkliste (offene Buchungen, fehlende Tage) | – | ❌ | |

**Bewertung:** Der geplante Monatsabschluss (Phase 2) deckt die Kernfunktionalität ab. Das fehlende **Monatsblatt** ist für die Praxis wichtig (Mitarbeiter und Vorgesetzte brauchen einen Stundennachweis).

**Empfehlung:**
- 🔴 Druckbarer Monatsnachweis / Stundenzettel (PDF oder Print-CSS)
- 🟡 Abschluss-Checkliste: Automatische Prüfung auf offene Buchungen, fehlende Tage, ungenehmigte Anträge
- 🟡 Sammelabschluss für alle MA

---

## 10. Auswertungen & Reports

| # | Konkurrenz-Feature | CuraFlow | Status | Anmerkung |
|---|---|---|---|---|
| 10.1 | Monatliche Stundenübersicht pro MA | WorkingTimeReport: Ist-Stunden pro MA/Tag/Woche/Monat | ✅ | |
| 10.2 | Soll/Ist-Vergleich mit Ampel | Geplant in Phase 1.2 (Grün/Gelb/Rot) | 📋 | |
| 10.3 | Fehlzeiten-Statistik | MasterAbsences + Statistics.jsx | ✅ | Mandantenübergreifend |
| 10.4 | Überstunden-Report | – | 📋 | Teil des Soll/Ist-Vergleichs |
| 10.5 | Compliance-Report (ArbZG) | ComplianceReport: Wochenend-Last, Max-Serien, Spätdienste | ✅ | Gute Basis, ArbZG-Grenzen ergänzen |
| 10.6 | Krankheitsquote / Bradford-Faktor | – | ❌ | Keine automatische Berechnung |
| 10.7 | Abteilungsvergleich | MasterTimeTracking: Cross-Tenant-Vergleich | 🔄 | Zwischen Mandanten, nicht innerhalb |
| 10.8 | Jahresvergleich (aktuelles vs. Vorjahr) | – | ❌ | |
| 10.9 | Individuelle Auswertungsdefinition | – | ❌ | Kein Report-Builder |
| 10.10 | Excel-Export von Auswertungen | CSV-Export in Statistics.jsx | 🔄 | CSV vorhanden, kein formatierter Excel-Export für Statistiken |
| 10.11 | PDF-Export | jspdf/html2canvas referenziert aber nicht aktiv | ❌ | |
| 10.12 | Dashboard mit KPI-Karten | Statistics.jsx + MasterDashboard | ✅ | |
| 10.13 | Grafische Auswertung (Charts) | Recharts: Jahresverlauf, Dienste/Person, Arbeitsplätze/Person | ✅ | |
| 10.14 | Wunscherfüllungs-Report | WishFulfillmentReport mit Balkendiagramm | ✅ | |

**Bewertung:** Berichte und Statistiken sind eine CuraFlow-Stärke, besonders die mandantenübergreifende Sicht im Master-Frontend.

**Empfehlung:**
- 🟡 PDF-Export aktivieren/fertigstellen
- 🟡 Excel-Export (formatiert mit ExcelJS, analog zum Wochenplan-Export)
- 🟡 Krankheitsquote als neuen Report ergänzen
- ⚪ Report-Builder nur für Enterprise-Kunden relevant

---

## 11. Schnittstellen / Integrationen

| # | Konkurrenz-Feature | CuraFlow | Status | Anmerkung |
|---|---|---|---|---|
| 11.1 | P&I Loga Import/Export | Geplant in Phase 4 (Format unklar) | 📋 | Abhängig von Kundenfeedback |
| 11.2 | SAP HR-Anbindung | – | ⊘ | Kunde nutzt Loga, nicht SAP |
| 11.3 | DATEV-Export | – | ❌ | Ggf. als Alternative zu Loga für andere Kunden |
| 11.4 | Kalender-Sync (iCal/Google) | syncCalendar.ts + ICS-Anhang in E-Mails | ✅ | |
| 11.5 | E-Mail-Benachrichtigungen | sendScheduleEmails, sendShiftNotification, Wish-Reminders | ✅ | Umfangreich |
| 11.6 | REST-API | Vollständige Express-API mit JWT-Auth | ✅ | |
| 11.7 | Excel-Import | – | ❌ | Kein Import, nur Export |
| 11.8 | Zutrittskontroll-Anbindung | – | ⊘ | Keine Terminals |
| 11.9 | Projektzeit-Anbindung | – | ⊘ | Nicht relevant für Klinik |
| 11.10 | Webhooks / Event-Notifications | – | ❌ | |

**Bewertung:** Die Loga-Schnittstelle ist die entscheidende Integration. Alle anderen sind entweder vorhanden oder nicht relevant.

**Empfehlung:**
- 🔴 Loga-Schnittstellenformat **prioritär mit dem Kunden klären** (offene Frage #1)
- 🟡 Generischen CSV-Export als Fallback implementieren
- ⚪ DATEV nur relevant falls weitere Kunden akquiriert werden

---

## 12. Überstundenregelung

| # | Konkurrenz-Feature | CuraFlow | Status | Anmerkung |
|---|---|---|---|---|
| 12.1 | Überstunden-Erkennung (automatisch ab Soll-Überschreitung) | – | 📋 | Teil des Soll/Ist-Vergleichs (Phase 1.2) |
| 12.2 | Überstunden-Genehmigung | – | ❌ | Kein Workflow |
| 12.3 | Überstunden-Abbau (Freizeitausgleich) | Auto-Frei nach Dienst (pro Workplace konfigurierbar) | 🔄 | Automatisch für Dienste, nicht für allg. Überstunden |
| 12.4 | Überstunden-Kappung (Verfall nach X Monaten) | – | ❌ | Offene Frage #4 |
| 12.5 | Anordnung von Überstunden | – | ❌ | |
| 12.6 | Überstunden-Auszahlung | – | ❌ | Kein Auszahlungs-Workflow |

**Bewertung:** Überstundenregelung hängt direkt vom Soll/Ist-Vergleich und Zeitkonten ab. Die automatische Erkennung kommt mit Phase 1, die Verwaltung mit Phase 2.

**Empfehlung:**
- 🟡 Standardmäßig Freizeitausgleich, Auszahlung nur wenn Loga-Mapping steht
- 🟡 Kappungsregeln als konfigurierbare Parameter

---

## 13. Rechtliche Konformität

| # | Konkurrenz-Feature | CuraFlow | Status | Anmerkung |
|---|---|---|---|---|
| 13.1 | ArbZG-Prüfung (10h-Grenze) | ComplianceReport: Max-Serien, Wochenend-Last | 🔄 | Keine explizite 10h/Tag-Prüfung |
| 13.2 | 11h-Ruhezeit-Prüfung | – | ❌ | Nicht implementiert |
| 13.3 | Wöchentliche 48h-Grenze | – | ❌ | |
| 13.4 | Sonntags-/Feiertagsarbeit-Dokumentation | Schichtplan-Einträge an So/Feiertagen erkennbar | 🔄 | Vorhanden in Daten, kein dedizierter Report |
| 13.5 | Jugendarbeitsschutz | – | ⊘ | In der Regel nicht relevant für Kliniken |
| 13.6 | Mutterschutz-Regelungen | StaffingPlanEntry: Sonderstatus MS | ✅ | Nicht-Verfügbarkeit wird automatisch gesetzt |
| 13.7 | Aufbewahrungsfristen (Zeitnachweise 2 Jahre) | – | ❌ | Keine automatische Archivierung |
| 13.8 | Datenschutz (DSGVO-konforme Speicherung) | Mandantentrennung, JWT-Auth, Passwort-Hashing | 🔄 | Grundregeln eingehalten, kein formelles DSGVO-Konzept |
| 13.9 | Betriebsrat-Zugriffsrechte | – | ❌ | Keine BR-spezifische Rolle |
| 13.10 | EuGH-Urteil-Compliance (Arbeitszeiterfassungspflicht) | Grundlage vorhanden über shift_entries + Timeslots | 🔄 | Infrastruktur da, aber nicht als formelle Arbeitszeiterfassung zertifiziert |

**Bewertung:** Die rechtliche Konformität ist der Bereich mit dem **höchsten Nachholbedarf**. Insbesondere die ArbZG-Prüfungen (10h, 11h Ruhezeit, 48h/Woche) sollten als Validierungsregeln implementiert werden.

**Empfehlung:**
- 🔴 **11h-Ruhezeit-Prüfung** implementieren (kritisch für Schichtbetrieb)
- 🔴 **10h/Tag- und 48h/Woche-Prüfung** als Blocker oder Warnung
- 🟡 ArbZG-Report erstellen (Verstöße auflisten statt nur Ampel)
- ⚪ Aufbewahrungsfristen: Datenbank archiviert implizit, explizite Löschroutine für DSGVO

---

## 14. Berechtigungen & Rollen

| # | Konkurrenz-Feature | CuraFlow | Status | Anmerkung |
|---|---|---|---|---|
| 14.1 | Rollenbasierte Zugriffskontrolle | admin / user / readonly + konfigurierbare TeamRoles | ✅ | |
| 14.2 | Funktionsbezogene Berechtigungen (nur Urlaub, nur Dienstplan etc.) | – | ❌ | Grobe Granularität: Admin sieht alles, User sieht eigene Daten |
| 14.3 | Mandantenübergreifende Berechtigung | `allowed_tenants` auf `app_users` + Master-Admin | ✅ | |
| 14.4 | Stellvertreter-Berechtigung (im Vertretungsfall) | – | ❌ | |
| 14.5 | Datensichtbarkeit pro Rolle (eigene Daten vs. Team vs. alle) | user/readonly sieht gefiltertes Dashboard, Admin sieht alles | 🔄 | Basiskonzept vorhanden |
| 14.6 | Audit-Log (wer hat was wann geändert) | `created_by`, `created_date`, `updated_date` auf ShiftEntry | 🔄 | Grundfelder vorhanden, kein vollständiges Audit-Log |
| 14.7 | Feature-Toggles (Funktionen pro Mandant aktivieren/deaktivieren) | – | ❌ | Alle Mandanten haben gleichen Funktionsumfang |

**Bewertung:** Das Berechtigungskonzept ist funktional für den aktuellen Bedarf. Feinere Granularität (z. B. HR darf nur Zeitkonten, Teamleiter nur eigenes Team) wird bei wachsender Nutzerbasis relevant.

**Empfehlung:**
- 🟡 Audit-Log ausbauen (separate Tabelle `AuditLog` mit user, action, entity, old_value, new_value, timestamp)
- ⚪ Funktionsspezifische Berechtigungen erst bei Bedarf

---

## 15. Benachrichtigungen

| # | Konkurrenz-Feature | CuraFlow | Status | Anmerkung |
|---|---|---|---|---|
| 15.1 | E-Mail bei Plan-Erstellung | sendScheduleEmails + sendShiftNotification | ✅ | |
| 15.2 | E-Mail bei Dienstwunsch-Status | checkAndSendWishReminders | ✅ | |
| 15.3 | Erinnerung: Offene Genehmigungen | MyDashboard: Offene Aufgaben | ✅ | |
| 15.4 | Push-Notifications (Mobile) | – | ❌ | manifest.json vorhanden (PWA-fähig), aber keine Push implementiert |
| 15.5 | In-App-Benachrichtigungen | – | ❌ | |
| 15.6 | Kalender-Einladung (ICS) | ICS-Anhang in Dienstplan-E-Mails | ✅ | |
| 15.7 | Eskalation bei überfälligen Aktionen | – | ❌ | |

**Bewertung:** E-Mail-Benachrichtigungen sind gut abgedeckt. Push-Notifications wären ein sinnvolles Upgrade, da CuraFlow bereits als PWA vorbereitet ist (manifest.json).

---

## 16. Sprachsteuerung / KI

| # | Konkurrenz-Feature | CuraFlow | Status | Anmerkung |
|---|---|---|---|---|
| 16.1 | Sprachgesteuerte Zeitbuchung | processVoiceCommand.ts, processVoiceAudio.ts, transcribeAudio.ts | ✅ | Unique Feature – Konkurrenz hat das nicht |
| 16.2 | KI-gestützte Dienstplanerstellung | AIRulesDialog → POST /api/schedule/generate | ✅ | Unique Feature |
| 16.3 | Chatbot für Zeitauskunft | – | ❌ | |

**Bewertung:** CuraFlow hat hier mit Spracheingabe und KI-Dienstplanung **klare Alleinstellungsmerkmale** gegenüber der Konkurrenzsoftware.

---

## Zusammenfassung: Deckungsgrad

### Quantitative Übersicht

| Kategorie | Gesamt | ✅ | 🔄 | 📋 | ❌ | ⊘ |
|---|---|---|---|---|---|---|
| 1. Stammdaten | 11 | 4 | 3 | 0 | 4 | 0 |
| 2. Arbeitszeitmodelle | 12 | 4 | 1 | 1 | 5 | 1 |
| 3. Zeitbuchungen | 12 | 0 | 3 | 3 | 2 | 4 |
| 4. Zeitkonten | 12 | 0 | 1 | 4 | 7 | 0 |
| 5. Zuschläge | 10 | 0 | 1 | 0 | 9 | 0 |
| 6. Fehlzeiten | 15 | 8 | 2 | 0 | 3 | 2 |
| 7. Urlaubsplanung | 10 | 6 | 1 | 0 | 3 | 0 |
| 8. Genehmigungen | 9 | 2 | 1 | 1 | 5 | 0 |
| 9. Monatsabschluss | 9 | 0 | 0 | 4 | 5 | 0 |
| 10. Auswertungen | 14 | 6 | 2 | 2 | 4 | 0 |
| 11. Schnittstellen | 10 | 3 | 0 | 1 | 3 | 3 |
| 12. Überstunden | 6 | 0 | 1 | 1 | 4 | 0 |
| 13. Recht & Compliance | 10 | 1 | 4 | 0 | 4 | 1 |
| 14. Berechtigungen | 7 | 2 | 2 | 0 | 3 | 0 |
| 15. Benachrichtigungen | 7 | 4 | 0 | 0 | 3 | 0 |
| 16. KI & Sprache | 3 | 2 | 0 | 0 | 1 | 0 |
| **Gesamt** | **157** | **42 (27%)** | **22 (14%)** | **17 (11%)** | **65 (41%)** | **11 (7%)** |

### Gesamtbild

```
Vorhanden + Teilweise:           64 Features (41%)  → Solide Basis
Geplant (in TIMETRACKING.md):    17 Features (11%)  → In Pipeline
Fehlt:                           65 Features (41%)  → Zu prüfen
Nicht benötigt:                  11 Features  (7%)  → Entfällt
```

### Bereinigter Deckungsgrad (ohne "Nicht benötigt")

Von **146 relevanten Features** sind **81 (55%)** vorhanden, teilweise oder geplant.

---

## Top-10 Prioritäten für die Umsetzung

| Prio | Feature | Aufwand | Begründung |
|------|---------|---------|------------|
| 1 | **Pausenregelung** (§2.8) | mittel | Rechtlich erforderlich (ArbZG §4) |
| 2 | **Soll-Stunden + Soll/Ist-Vergleich** (§2.1, §4.5) | gering–mittel | Kernfunktion der Zeiterfassung, bereits geplant (Phase 1) |
| 3 | **Manuelle Buchungsmaske (HR)** (§3.4) | mittel | Hauptinteraktionspunkt für HR, geplant (Phase 1.3) |
| 4 | **TimeAccount + Monatsabschluss** (§4.1, §9.1) | mittel | Gleitzeitkonto ist Kern-Feature, geplant (Phase 2) |
| 5 | **11h-Ruhezeit- & 10h/Tag-Prüfung** (§13.1, §13.2) | gering | Rechtlich kritisch, Daten vorhanden |
| 6 | **Urlaubsantrags-Workflow** (§7.3, §8.3) | mittel | Akzeptanz bei Mitarbeitern, Differenzierung zur Konkurrenz |
| 7 | **Monatsblatt / Stundenzettel** (§9.5) | gering | Gesetzlich gefordert, Print-CSS oder PDF |
| 8 | **Loga-Schnittstelle** (§11.1) | variabel | Blockiert durch offene Format-Frage, Phase 4 |
| 9 | **Korrektur-Audit-Trail** (§3.5, §14.6) | mittel | Revisionssicherheit, HR-Compliance |
| 10 | **Halbe Urlaubstage** (§6.9) | gering | Häufige Nutzeranforderung |

---

## Stärken von CuraFlow gegenüber der Konkurrenz

| CuraFlow-Vorteil | Konkurrenz |
|---|---|
| 🤖 **KI-gestützte Dienstplanerstellung** | Manuelle Planung |
| 🎤 **Sprachsteuerung** | Nicht vorhanden |
| 🏥 **Medizin-spezifische Funktionen** (Qualifikationen, Dienste, Rotationen) | Generische Zeiterfassung |
| 📱 **Mobile-optimierte Ansicht** | Desktop-orientiert |
| 🔀 **Multi-Tenant-Architektur** mit Master-Frontend | Mandantentrennung ohne übergeordnete Sicht |
| 📊 **Wunscherfüllungs-Report** | Nicht vorhanden |
| ⚡ **Drag-and-Drop Dienstplanung** mit Undo/Redo | Formular-basiert |
| 🔄 **Stellenplan-Sync** (KO/EZ/MS → automatische Abwesenheit) | Manuelle Pflege |

---

## Abgleich mit bestehendem Umsetzungsplan

Der bestehende [TIMETRACKING.md](TIMETRACKING.md)-Plan mit 4 Phasen deckt die **kritischsten Lücken** korrekt ab:

| Phase | Features in TIMETRACKING.md | Gap-Analyse-Deckung |
|---|---|---|
| Phase 1 | Soll-Stunden, Soll/Ist, Buchungsmaske, Monatsübersicht | §2.1, §3.4, §4.5, §10.2 ✅ |
| Phase 2 | TimeAccount, Saldo, Monatsabschluss, Vortrag, Sperre | §4.1–4.6, §9.1–9.4 ✅ |
| Phase 3 | Master-Frontend ausbauen, Cross-Tenant-API, Exports | §10.7, §10.10–10.11 ✅ |
| Phase 4 | Loga-Schnittstelle | §11.1 ✅ |

### Ergänzungsempfehlung zum Umsetzungsplan

Folgende Features sollten in die bestehenden Phasen aufgenommen werden:

**Phase 1 erweitern um:**
- Pausenregelung (automatischer Abzug) → §2.8
- ArbZG-Basisprüfungen (10h, 11h Ruhezeit) → §13.1, §13.2

**Phase 2 erweitern um:**
- Kappungsgrenzen für Zeitkonten → §4.7
- Manuelle Korrekturbuchung → §4.9
- Monatsblatt/Stundenzettel → §9.5

**Phase 3 erweitern um:**
- Urlaubsantrags-Workflow → §7.3
- Audit-Log-Tabelle → §14.6
- BEM-Frühwarnung → §6.11

**Neue Phase 5 (optional, nach Go-Live):**
- Erweiterte Abwesenheitstypen → §6.3–6.8
- Halbe Urlaubstage → §6.9
- Zuschlagskatalog (falls nicht via Loga) → §5.9
- Push-Notifications → §15.4

---

*Erstellt auf Basis der öffentlich verfügbaren Konkurrenzdokumentation und des CuraFlow-Codebase-Audits. Feature-Details der Konkurrenzsoftware sollten anhand der aktuellen Produktdokumentation verifiziert werden.*
