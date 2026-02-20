# Feature: Authentifizierung & Multi-Tenant

---

## Funktionsumfang

- **JWT-basiertes Login** mit E-Mail + Passwort
- **Rollenmodell**: `admin`, `user`, `readonly`
- **Passwort-Änderung** (selbst und erzwungen)
- **E-Mail-Verifizierung**
- **Multi-Tenant-Betrieb**: Mehrere MySQL-Datenbanken über einen Backend-Server
- **Mandanten-Auswahl** nach Login (für Multi-Tenant-Benutzer)
- **"Passwort muss geändert werden"**-Flag für Reset-Flow
- **Mitarbeiter-Verknüpfung**: Jeder Benutzer kann mit einem Mitarbeiter-Datensatz verknüpft sein

---

## Implementierung

### Relevante Dateien

| Datei | Funktion |
|---|---|
| `src/components/AuthProvider.jsx` | React Context: Auth-State, login/logout |
| `src/pages/AuthLogin.jsx` | Login-Seite mit Formular |
| `src/api/client.js` | JWT + DB-Token in Requests einbetten |
| `src/components/dbTokenStorage.jsx` | DB-Token im localStorage verwalten |
| `server/routes/auth.js` | Alle Auth-Endpunkte (Login, Register, Users) |
| `server/utils/crypto.js` | DB-Token verschlüsseln/entschlüsseln |
| `src/components/admin/UserManagement.jsx` | Admin-UI: Benutzer verwalten |
| `src/components/admin/ServerTokenManager.jsx` | Admin-UI: DB-Tokens verwalten |

### Authentifizierungs-Flow

```
Login-Seite                  AuthProvider             Backend
     │                            │                      │
     │── POST /api/auth/login ────────────────────────> │
     │                            │              bcrypt.compare()
     │<── { token, user } ─────────────────────────────│
     │                            │                      │
     │── setToken() ──────────────>│                     │
     │── setUser() ───────────────>│                     │
     │── navigate('/') ──────────>│                     │
```

### JWT-Token-Struktur

```json
{
  "id": 1,
  "email": "mitarbeiter@klinikum.de",
  "role": "admin",
  "iat": 1704067200,
  "exp": 1704153600   // 24h Gültigkeit
}
```

Der Token wird in `localStorage` unter dem Key `radioplan_jwt_token` gespeichert.

### Multi-Tenant-Flow

```
1. Benutzer hat mehrere Mandanten → allowedTenants im Login-Response
2. AuthProvider zeigt Mandanten-Auswahl (needsTenantSelection = true)
3. Benutzer wählt Mandant → completeTenantSelection()
4. DB-Token wird via /api/auth/activate-tenant/:id abgerufen
5. DB-Token in localStorage gespeichert (Schlüssel: 'db_credentials')
6. Ab jetzt enthält jeder Request 'X-DB-Token' Header
7. Backend wählt corrketen Connection-Pool (tenantPools Map)
```

### Rollensystem

```javascript
// server/routes/auth.js
export function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.substring(7);
  const payload = verifyToken(token);
  req.user = payload;
  next();
}

export function adminMiddleware(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Nur Administratoren haben Zugriff' });
  }
  next();
}
```

**Frontend-Prüfung:**
```javascript
const { user, isAuthenticated, isReadOnly } = useAuth();
if (user?.role !== 'admin') return <div>Zugriff verweigert</div>;
```

---

## Test-Szenarien

### T-AUTH-01: Erfolgreicher Login

```
Aktion: Login mit gültiger E-Mail + Passwort
Erwartet:
  - JWT-Token in localStorage
  - Weiterleitung zur Startseite
  - Benutzerinfo im Header sichtbar
```

### T-AUTH-02: Login mit falschem Passwort

```
Aktion: Login mit falscher E-Mail oder falschem Passwort
Erwartet:
  - HTTP 401 vom Backend
  - Fehlermeldung: "Ungültige Anmeldedaten"
  - Kein Token gespeichert
```

### T-AUTH-03: Token-Ablauf

```
Voraussetzung: JWT_SECRET ändern oder Token manuell manipulieren
Aktion: API-Request mit abgelaufenem Token
Erwartet:
  - HTTP 401
  - AuthProvider leitet auf Login-Seite weiter
  - localStorage-Token wird gelöscht
```

### T-AUTH-04: Admin-Seite ohne Admin-Rolle

```
Voraussetzung: Login als Benutzer mit Rolle 'user'
Aktion: Navigieren zu /Admin
Erwartet:
  - Meldung: "Zugriff verweigert. Nur für Administratoren."
  - Admin-Tabs nicht sichtbar
```

### T-AUTH-05: Passwort-Änderung erzwungen

```
Voraussetzung: must_change_password = 1 für Testbenutzer
Aktion: Login
Erwartet:
  - Passwort-Änderungs-Dialog erscheint
  - Navigation zur Startseite erst nach Passwort-Änderung möglich
```

### T-AUTH-06: Multi-Tenant-Auswahl

```
Voraussetzung: Benutzer hat 2 Mandanten in server_tokens
Aktion: Login
Erwartet:
  - Mandanten-Auswahldialog erscheint
  - Nach Auswahl: X-DB-Token in allen folgenden Requests
  - Daten aus korrekter Mandanten-DB geladen
```

### T-AUTH-07: Rate Limiting (Login)

```
Aktion: 11 Login-Versuche schnell hintereinander
Erwartet:
  - Nach 10 Versuchen: HTTP 429 "Too Many Requests"
  - Retry-After Header vorhanden
```
