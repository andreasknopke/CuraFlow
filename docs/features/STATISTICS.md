# Feature: Statistiken & Berichte

---

## Funktionsumfang

- **Dashboard-Übersicht**: Dienst-Verteilung pro Mitarbeiter als Balkendiagramm
- **Monats-/Jahres-Filter**: Auswertung für beliebigen Zeitraum
- **Arbeitszeit-Report**: Auswertung nach Arbeitszeit-Kategorien
- **Wunscherfüllungs-Report**: Erfüllungsquote der Dienstwünsche je Mitarbeiter
- **Compliance-Report**: Einhaltung von Dienst-Limits und -Regeln
- **Tabellen-Ansicht**: Alle Daten als sortierbare Tabelle
- **CSV-Export** der Statistikdaten

> Nur für Benutzer mit Rolle `admin` zugänglich.

---

## Implementierung

### Relevante Dateien

| Datei | Funktion |
|---|---|
| `src/pages/Statistics.jsx` | Hauptseite: Datenabfragen, Tabs, Filter |
| `src/components/statistics/ChartCard.jsx` | Wiederverwendbare Diagramm-Karte |
| `src/components/statistics/WishFulfillmentReport.jsx` | Wunscherfüllungs-Tabelle |
| `src/components/statistics/ComplianceReport.jsx` | Compliance-Auswertung |
| `src/components/statistics/WorkingTimeReport.jsx` | Arbeitszeit-Report |

### Verwendete Bibliotheken

- **Recharts** (`recharts`): Balkendiagramme, interaktive Tooltips
- **date-fns**: Datumsberechnungen für Monatsgrenzen
- **jspdf + html2canvas**: PDF-Export (falls aktiviert)

### Datenfluss

```
Statistics.jsx
├── useQuery(['doctors'])        → alle Mitarbeitenden
├── useQuery(['workplaces'])     → alle Arbeitsbereiche
├── useQuery(['shifts', year])   → alle shift_entries des Jahres (max 5000)
└── useQuery(['wishes', year])   → alle wish_requests des Jahres
         │
         ▼
   useMemo() → aggregierte Daten
         │
         ▼
   Recharts BarChart / Table
```

### Aggregierungslogik (Beispiel)

```javascript
// Statistics.jsx – Dienste pro Mitarbeiter und Monat aggregieren
const aggregated = useMemo(() => {
  const result = {};
  for (const shift of shifts) {
    const key = `${shift.doctor_id}-${shift.date.substring(0, 7)}`;
    result[key] = (result[key] || 0) + 1;
  }
  return result;
}, [shifts]);
```

---

## Test-Szenarien

### T-STAT-01: Jahresauswertung laden

```
Voraussetzung: Dienstplan-Einträge für 2024 vorhanden
Aktion: Jahr 2024 auswählen
Erwartet:
  - Balkendiagramm zeigt Dienst-Verteilung je Mitarbeiter
  - Alle 12 Monate dargestellt
```

### T-STAT-02: Monatsfilter

```
Aktion: Monat auf "März" setzen
Erwartet:
  - Nur Daten für März angezeigt
  - Diagramm aktualisiert sich ohne Seitenneuladen
```

### T-STAT-03: Wunscherfüllungs-Report

```
Voraussetzung: wish_requests mit status='approved'/'rejected' vorhanden
Aktion: Tab "Wunscherfüllung" auswählen
Erwartet:
  - Tabelle zeigt: Mitarbeiter, Anzahl Wünsche, Erfüllungsquote (%)
```

### T-STAT-04: Zugriff ohne Admin-Rolle

```
Voraussetzung: Login als Benutzer mit Rolle 'user'
Aktion: Navigieren zu /Statistics
Erwartet:
  - Meldung "Nur für Administratoren"
  - Kein Datenzugriff
```

### T-STAT-05: Performance bei großen Datenmengen

```
Voraussetzung: >2000 shift_entries für das Jahr
Aktion: Statistikseite laden
Erwartet:
  - Ladezeit < 5 Sekunden
  - Kein Browser-Freeze
  - Spinner während Laden sichtbar
```

---

# Feature: Adminbereich

---

## Funktionsumfang

**Tab: Benutzer & Rollen**
- Alle Systembenutzer auflisten
- Neue Benutzer anlegen
- Passworte zurücksetzen
- Benutzerrollen ändern
- Benutzer (de-)aktivieren
- Mitarbeiter-Verknüpfung setzen

**Tab: Einstellungen**
- Systemweite Einstellungen (Key-Value)
- Farbschema konfigurieren
- Abschnittskonfiguration des Dienstplans
- Teamrollen konfigurieren

**Tab: Datenbank**
- DB-Verbindung testen
- Backup erstellen
- Migrationen ausführen
- Server-Tokens (Multi-Tenant) verwalten

**Tab: Logs**
- System-Aktivitätsprotokoll einsehen

---

## Relevante Dateien

| Datei | Funktion |
|---|---|
| `src/pages/Admin.jsx` | Admin-Seite mit Tabs |
| `src/components/admin/UserManagement.jsx` | Benutzerverwaltung |
| `src/components/admin/AdminSettings.jsx` | Einstellungs-Tab |
| `src/components/admin/DatabaseManagement.jsx` | Datenbank-Tab |
| `src/components/admin/SystemLogs.jsx` | Logs-Tab |
| `src/components/admin/ServerTokenManager.jsx` | DB-Tokens (Multi-Tenant) |
| `src/components/admin/TimeslotEditor.jsx` | Zeitfenster-Editor |
| `src/components/settings/WorkplaceConfigDialog.jsx` | Arbeitsbereiche konfigurieren |
| `src/components/settings/TeamRoleSettings.jsx` | Teamrollen konfigurieren |
| `src/components/settings/ColorSettingsDialog.jsx` | Farbkonfiguration |
| `server/routes/admin.js` | Admin-Backend-Endpunkte |

---

## Test-Szenarien – Admin

### T-ADM-01: Neuen Benutzer anlegen

```
Aktion: Admin → "Benutzer & Rollen" → "Benutzer hinzufügen"
        Formular ausfüllen: E-Mail, Passwort, Rolle
Erwartet:
  - app_users Eintrag erstellt
  - Neuer Benutzer kann sich einloggen
```

### T-ADM-02: Mitarbeiter-Verknüpfung setzen

```
Aktion: Benutzer bearbeiten → Doctor-Dropdown → Mitarbeiter auswählen
Erwartet:
  - app_users.doctor_id gesetzt
  - Benutzer sieht in WishList/Vacation nur eigenen Mitarbeiter
```

### T-ADM-03: Teamrolle konfigurieren

```
Aktion: Einstellungen → Teamrollen → Neue Rolle "Stipendiat" mit Priorität 50
Erwartet:
  - team_roles Eintrag erstellt
  - Mitarbeitende können dieser Rolle zugeordnet werden
  - Sortierung im Dienstplan entsprechend Priorität
```

### T-ADM-04: DB-Token erstellen (Multi-Tenant)

```
Aktion: Datenbank-Tab → "Neuen Token erstellen"
        MySQL-Verbindungsdaten eingeben
Erwartet:
  - Verbindungstest erfolgreich
  - server_tokens Eintrag erstellt (verschlüsselt)
  - Token Benutzern zuweisbar
```
