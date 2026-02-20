# Feature: Adminbereich

> Vollständige Admin-Dokumentation (Benutzerverwaltung, Einstellungen, Datenbank, Logs) ist in [STATISTICS.md](./STATISTICS.md#feature-adminbereich) enthalten.

---

## Kurzreferenz

| Sub-Feature | Komponente | Route |
|---|---|---|
| Benutzerverwaltung | `admin/UserManagement.jsx` | `/Admin` (Tab: users) |
| Systemeinstellungen | `admin/AdminSettings.jsx` | `/Admin` (Tab: settings) |
| Datenbank-Wartung | `admin/DatabaseManagement.jsx` | `/Admin` (Tab: database) |
| System-Logs | `admin/SystemLogs.jsx` | `/Admin` (Tab: logs) |
| DB-Tokens (Multi-Tenant) | `admin/ServerTokenManager.jsx` | `/Admin` (Tab: database) |
| Zeitfenster-Editor | `admin/TimeslotEditor.jsx` | `/Admin` (Tab: settings) |

## Zugriffskontrolle

```jsx
// Admin.jsx – Zugriffsschutz
if (!isAuthenticated) return <div>Bitte anmelden.</div>;
if (user?.role !== 'admin') return <div>Zugriff verweigert.</div>;
```

API-seitig schützt `adminMiddleware` alle Admin-Endpunkte:

```javascript
// server/routes/admin.js
router.get('/logs', authMiddleware, adminMiddleware, async (req, res) => { ... });
```

## Test-Szenarien

Detaillierte Szenarien: [STATISTICS.md – Admin-Szenarien](./STATISTICS.md#test-szenarien--admin)

### T-ADM-05: Readonly-Benutzer kann Admin nicht öffnen

```
Voraussetzung: Login als 'readonly' Benutzer
Aktion: Direkt zu /Admin navigieren
Erwartet: "Zugriff verweigert" Meldung
```

### T-ADM-06: System-Log-Einträge prüfen

```
Aktion: Admin → Logs-Tab → Aktivitätsliste anzeigen
Erwartet:
  - Letzte Aktionen (Login, Dienstplan-Änderungen) sichtbar
  - Keine passwort_hash-Werte im Log
```

### T-ADM-07: Farbschema ändern

```
Aktion: Admin → Einstellungen → Farbe für 'CT' ändern → Speichern
Erwartet:
  - color_settings in DB aktualisiert
  - Im Dienstplan sofort neue Farbe
```
