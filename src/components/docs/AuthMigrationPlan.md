# Migrationsplan: Base44 Auth → Eigene Root-basierte Authentifizierung

**Dokument-Version:** 1.0  
**Erstellt:** 2026-01-02  
**Status:** Planung

---

## Inhaltsverzeichnis

1. [Übersicht](#1-übersicht)
2. [Voraussetzungen & Rücksprungpunkte](#2-voraussetzungen--rücksprungpunkte)
3. [Architektur](#3-architektur)
4. [Abhängigkeitsanalyse](#4-abhängigkeitsanalyse)
5. [Datenbank-Schema](#5-datenbank-schema)
6. [Backend-Implementierung](#6-backend-implementierung)
7. [Frontend-Implementierung](#7-frontend-implementierung)
8. [Migrationsprozess](#8-migrationsprozess)
9. [Rollback-Prozedur](#9-rollback-prozedur)
10. [Checkliste](#10-checkliste)

---

## 1. Übersicht

### Ziel
Ersetzung der Base44-Authentifizierung durch ein eigenes, root-basiertes Authentifizierungssystem.

### Anforderungen
- Root ist der einzige, der User anlegen kann
- Root weist initiales Login (Email) und Passwort zu
- Keine E-Mail-Verifizierung erforderlich
- Bestehende Daten müssen erhalten bleiben
- User müssen zur neuen Authentifizierung migriert werden

### Betroffene Systeme
- Frontend: AuthProvider, Layout, alle geschützten Seiten
- Backend: Alle Functions mit Auth-Check
- Datenbank: Neue User-Tabelle in MySQL

---

## 2. Voraussetzungen & Rücksprungpunkte

### 2.1 Vor der Migration: Backups erstellen

#### A) MySQL-Datenbank komplett sichern

```bash
# Vollständiges Backup aller Tabellen
mysqldump -h [HOST] -u [USER] -p[PASSWORD] [DATABASE] > backup_pre_auth_migration_$(date +%Y%m%d_%H%M%S).sql

# Alternativ mit Kompression
mysqldump -h [HOST] -u [USER] -p[PASSWORD] [DATABASE] | gzip > backup_pre_auth_migration_$(date +%Y%m%d_%H%M%S).sql.gz
```

#### B) Base44 Interne Daten sichern

1. Dashboard → Administration → Datenbank-Management
2. "Backup erstellen" klicken
3. JSON-Datei herunterladen und sicher aufbewahren

#### C) Aktuelle User-Liste exportieren

```sql
-- Aus MySQL (falls User-Daten dort liegen)
SELECT * FROM User INTO OUTFILE '/tmp/users_backup.csv';

-- Oder via App: AdminTools → backup action
```

### 2.2 Rücksprungpunkte definieren

| Checkpoint | Beschreibung | Rollback-Aktion |
|------------|--------------|-----------------|
| **CP0** | Vor jeglicher Änderung | MySQL-Dump + Base44-Backup wiederherstellen |
| **CP1** | Nach Tabellen-Erstellung | `DROP TABLE AppUser;` |
| **CP2** | Nach User-Migration | `TRUNCATE TABLE AppUser;` + Base44 Auth reaktivieren |
| **CP3** | Nach Backend-Umstellung | Git revert auf alte Functions |
| **CP4** | Nach Frontend-Umstellung | Git revert auf altes Frontend |

### 2.3 Voraussetzungen-Checkliste

- [ ] MySQL-Vollbackup erstellt und getestet
- [ ] Base44-JSON-Backup heruntergeladen
- [ ] Aktuelle User-Liste dokumentiert (Email, Rolle, doctor_id)
- [ ] Alle User über geplante Wartung informiert
- [ ] Wartungsfenster definiert (mind. 2 Stunden)
- [ ] Rollback-Prozedur getestet
- [ ] JWT_SECRET generiert und sicher gespeichert

---

## 3. Architektur

### 3.1 Neue Architektur

```
┌─────────────────────────────────────────────────────────────┐
│                        FRONTEND                              │
├─────────────────────────────────────────────────────────────┤
│  AuthProvider (neu)                                          │
│  ├── Login-Page (Email/Passwort)                            │
│  ├── Session via JWT (localStorage)                         │
│  ├── useAuth() Hook (Interface bleibt gleich)               │
│  └── ChangePassword-Page                                    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     BACKEND FUNCTIONS                        │
├─────────────────────────────────────────────────────────────┤
│  authLogin.js        → Login, JWT generieren                │
│  authVerify.js       → JWT prüfen (für alle Functions)      │
│  authUserMgmt.js     → User CRUD (nur Root/Admin)           │
│  authChangePassword.js → Passwort ändern                    │
│  authMe.js           → Aktuellen User abrufen               │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                       MYSQL DATABASE                         │
├─────────────────────────────────────────────────────────────┤
│  AppUser (NEU)                                              │
│  ├── id VARCHAR(255) PRIMARY KEY                            │
│  ├── email VARCHAR(255) UNIQUE                              │
│  ├── password_hash VARCHAR(255)                             │
│  ├── full_name VARCHAR(255)                                 │
│  ├── role ENUM('root', 'admin', 'user')                     │
│  ├── doctor_id VARCHAR(255)                                 │
│  ├── theme VARCHAR(50)                                      │
│  ├── preferences JSON                                       │
│  ├── must_change_password BOOLEAN                           │
│  ├── is_active BOOLEAN                                      │
│  ├── created_at DATETIME                                    │
│  └── last_login DATETIME                                    │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 JWT Flow

```
1. User gibt Email + Passwort ein
2. Frontend ruft authLogin Function auf
3. Backend prüft Credentials gegen AppUser-Tabelle
4. Bei Erfolg: JWT mit User-Daten wird generiert
5. Frontend speichert JWT in localStorage
6. Bei jedem API-Call: JWT im Authorization-Header
7. Backend-Functions validieren JWT vor Verarbeitung
```

---

## 4. Abhängigkeitsanalyse

### 4.1 Frontend-Komponenten mit Auth-Abhängigkeit

| Datei | Aktuelle Nutzung | Änderung erforderlich |
|-------|------------------|----------------------|
| `components/AuthProvider.jsx` | `base44.auth.isAuthenticated()`, `base44.auth.me()` | Komplett neu implementieren |
| `Layout.js` | `base44.auth.logout()`, `base44.auth.redirectToLogin()`, `base44.auth.updateMe()` | Auf neue Auth umstellen |
| `pages/Home.js` | `base44.auth.redirectToLogin()` | Redirect zu Login-Page |
| `pages/MyDashboard.jsx` | `useAuth()` Hook | Keine Änderung (Hook-Interface bleibt) |
| `components/schedule/ScheduleBoard.jsx` | `useAuth()`, `user.doctor_id` | Keine Änderung |
| `components/settings/SectionConfigDialog.jsx` | `base44.auth.updateMe()` | Neue Update-Function |
| `components/ThemeSelector.jsx` | `base44.auth.updateMe()` | Neue Update-Function |

### 4.2 Backend-Functions mit Auth-Abhängigkeit

| Function | Aktuelle Auth-Methode | Änderung |
|----------|----------------------|----------|
| `dbProxy.js` | `createClientFromRequest(req)` + `base44.auth.me()` | Neue JWT-Middleware |
| `sendShiftEmails.js` | `base44.auth.me()` | Neue JWT-Middleware |
| `exportScheduleToExcel.js` | `base44.auth.me()` | Neue JWT-Middleware |
| `getHolidays.js` | Keine Auth | Keine Änderung |
| `atomicOperations.js` | `base44.auth.me()` | Neue JWT-Middleware |
| `renamePosition.js` | `base44.auth.me()` + Admin-Check | Neue JWT-Middleware |
| `adminTools.js` | `base44.auth.me()` + Role-Check | Neue JWT-Middleware |
| `migrateToMysql.js` | `base44.auth.me()` + Admin-Check | Neue JWT-Middleware |
| `processVoiceAudio.js` | Prüfen | Prüfen |
| `transcribeAudio.js` | Prüfen | Prüfen |

### 4.3 Zu ersetzende Base44-Methoden

| Base44 Methode | Neue Implementierung |
|----------------|---------------------|
| `base44.auth.isAuthenticated()` | JWT im localStorage prüfen |
| `base44.auth.me()` | JWT dekodieren oder `/authMe` aufrufen |
| `base44.auth.redirectToLogin()` | `navigate('/Login')` |
| `base44.auth.logout()` | JWT aus localStorage löschen, redirect |
| `base44.auth.updateMe(data)` | `authUpdateMe` Function aufrufen |
| `createClientFromRequest(req)` | Eigene JWT-Middleware |
| `base44.asServiceRole.entities.*` | Direkte MySQL-Queries |

---

## 5. Datenbank-Schema

### 5.1 AppUser Tabelle

```sql
CREATE TABLE AppUser (
    id VARCHAR(255) PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255),
    role ENUM('root', 'admin', 'user') NOT NULL DEFAULT 'user',
    doctor_id VARCHAR(255),
    theme VARCHAR(50),
    preferences JSON,
    must_change_password BOOLEAN DEFAULT TRUE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    last_login DATETIME(3),
    
    UNIQUE INDEX idx_email (email),
    INDEX idx_doctor (doctor_id),
    INDEX idx_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 5.2 Session-Tabelle (Optional, für Token-Revocation)

```sql
CREATE TABLE AppSession (
    id VARCHAR(255) PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    token_hash VARCHAR(255) NOT NULL,
    created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
    expires_at DATETIME(3) NOT NULL,
    revoked BOOLEAN DEFAULT FALSE,
    
    INDEX idx_user (user_id),
    INDEX idx_token (token_hash),
    INDEX idx_expires (expires_at),
    
    FOREIGN KEY (user_id) REFERENCES AppUser(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 5.3 Root-User Initial-Setup

```sql
-- WICHTIG: Passwort-Hash muss mit bcrypt generiert werden!
-- Beispiel für Passwort "ChangeMe123!"
-- Hash generieren: https://bcrypt-generator.com/ oder via Code

INSERT INTO AppUser (
    id,
    email,
    password_hash,
    full_name,
    role,
    must_change_password,
    is_active
) VALUES (
    UUID(),
    'root@radioplan.local',
    '$2b$10$XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    'System Administrator',
    'root',
    TRUE,
    TRUE
);
```

---

## 6. Backend-Implementierung

### 6.1 Neue Secrets erforderlich

```
JWT_SECRET=<256-bit-random-string>
```

**JWT_SECRET generieren:**
```javascript
// Node.js
require('crypto').randomBytes(32).toString('hex')

// Oder online: https://generate-secret.vercel.app/32
```

### 6.2 Neue Backend Functions

#### authLogin.js
```javascript
// Pseudo-Code Struktur
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

// POST: { email, password }
// Returns: { token, user } oder { error }

1. Email + Password aus Request
2. User in AppUser-Tabelle suchen
3. Password mit bcrypt.compare() prüfen
4. Bei Erfolg: JWT generieren mit { sub, email, role, doctor_id }
5. last_login aktualisieren
6. Token + User-Daten zurückgeben
```

#### authVerify.js (Middleware-Helper)
```javascript
// Wird von anderen Functions importiert
// Prüft Authorization-Header, validiert JWT

export async function verifyAuth(req) {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
        return { error: 'No token', status: 401 };
    }
    
    const token = authHeader.substring(7);
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        // Optional: User aus DB laden für aktuelle Daten
        return { user: decoded };
    } catch (e) {
        return { error: 'Invalid token', status: 401 };
    }
}
```

#### authUserMgmt.js
```javascript
// Nur für Root/Admin
// Actions: list, create, update, delete, resetPassword

// create: { email, password, full_name, role, doctor_id }
// → Password hashen mit bcrypt
// → must_change_password = true
```

#### authChangePassword.js
```javascript
// Für alle authentifizierten User
// POST: { currentPassword, newPassword }
// → Altes Passwort prüfen
// → Neues Passwort hashen und speichern
// → must_change_password = false
```

#### authMe.js
```javascript
// GET mit Token
// → User-Daten aus Token/DB zurückgeben
```

#### authUpdateMe.js
```javascript
// PUT mit Token
// POST: { theme, preferences, ... }
// → Nur eigene Daten aktualisieren (nicht role, email)
```

### 6.3 Bestehende Functions anpassen

Jede Function mit Auth-Check muss geändert werden:

**Vorher:**
```javascript
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    // ...
});
```

**Nachher:**
```javascript
import { verifyAuth } from './authVerify.js';

Deno.serve(async (req) => {
    const { user, error, status } = await verifyAuth(req);
    if (error) {
        return Response.json({ error }, { status });
    }
    // user enthält: { sub, email, role, doctor_id }
    // ...
});
```

---

## 7. Frontend-Implementierung

### 7.1 Neue Dateien

| Datei | Zweck |
|-------|-------|
| `pages/Login.jsx` | Login-Formular |
| `pages/ChangePassword.jsx` | Passwort ändern (Pflicht bei must_change_password) |
| `pages/UserManagement.jsx` | User verwalten (nur Root/Admin) |
| `components/auth/AuthProvider.jsx` | Neuer Auth-Context |
| `components/auth/ProtectedRoute.jsx` | Route-Guard |

### 7.2 AuthProvider (Neu)

```jsx
// Pseudo-Code Struktur
const AuthContext = createContext();

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    
    useEffect(() => {
        // Token aus localStorage laden
        const token = localStorage.getItem('auth_token');
        if (token) {
            // Token validieren via authMe oder lokal dekodieren
            validateToken(token);
        } else {
            setIsLoading(false);
        }
    }, []);
    
    const login = async (email, password) => {
        const res = await fetch('/api/authLogin', { ... });
        if (res.ok) {
            const { token, user } = await res.json();
            localStorage.setItem('auth_token', token);
            setUser(user);
        }
    };
    
    const logout = () => {
        localStorage.removeItem('auth_token');
        setUser(null);
        navigate('/Login');
    };
    
    const updateMe = async (data) => {
        // authUpdateMe aufrufen
    };
    
    return (
        <AuthContext.Provider value={{
            user,
            isAuthenticated: !!user,
            isReadOnly: user?.role !== 'admin' && user?.role !== 'root',
            isLoading,
            login,
            logout,
            updateMe
        }}>
            {children}
        </AuthContext.Provider>
    );
}
```

### 7.3 API-Client anpassen

Alle API-Calls müssen JWT im Header senden:

```javascript
// utils/api.js oder ähnlich
export async function apiCall(functionName, payload) {
    const token = localStorage.getItem('auth_token');
    
    const res = await fetch(`/api/${functionName}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': token ? `Bearer ${token}` : ''
        },
        body: JSON.stringify(payload)
    });
    
    if (res.status === 401) {
        // Token ungültig/abgelaufen
        localStorage.removeItem('auth_token');
        window.location.href = '/Login';
        return;
    }
    
    return res.json();
}
```

---

## 8. Migrationsprozess

### 8.1 Zeitplan

```
Tag 1: Vorbereitung (2-4 Stunden)
├── Alle Backups erstellen
├── User-Liste dokumentieren
├── JWT_SECRET generieren und als Secret speichern
└── Wartungsfenster kommunizieren

Tag 2: Datenbank (1 Stunde)
├── AppUser-Tabelle erstellen
├── Root-User anlegen
└── Tabelle testen

Tag 3: Backend (4-6 Stunden)
├── Auth-Functions implementieren
├── Bestehende Functions anpassen
└── Backend testen

Tag 4: Frontend (4-6 Stunden)
├── AuthProvider neu implementieren
├── Login-Page erstellen
├── Layout anpassen
└── Frontend testen

Tag 5: Migration & Go-Live (2-4 Stunden)
├── User aus Base44 in AppUser migrieren
├── Initialpasswörter generieren und dokumentieren
├── Go-Live
└── Monitoring
```

### 8.2 User-Migration Script

```sql
-- Schritt 1: Bestehende User-Daten sammeln
-- (aus Base44 exportieren als JSON, dann verarbeiten)

-- Schritt 2: User in AppUser einfügen
-- Für jeden User:
INSERT INTO AppUser (
    id,
    email,
    password_hash,
    full_name,
    role,
    doctor_id,
    theme,
    preferences,
    must_change_password,
    is_active
) VALUES (
    UUID(),
    '[email aus Base44]',
    '[bcrypt hash von Initialpasswort]',
    '[full_name aus Base44]',
    '[admin/user - NICHT root]',
    '[doctor_id aus Base44]',
    '[theme aus Base44]',
    '[preferences JSON aus Base44]',
    TRUE,  -- Muss Passwort ändern
    TRUE
);
```

### 8.3 Initialpasswörter

Für jeden migrierten User:
1. Zufälliges Initialpasswort generieren (z.B. 12 Zeichen)
2. Mit bcrypt hashen und in DB speichern
3. Klartext-Passwort in sichere Liste für Root aufnehmen
4. Root verteilt Initialpasswörter an User

```javascript
// Passwort-Generator
function generatePassword(length = 12) {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%';
    let password = '';
    for (let i = 0; i < length; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
}
```

---

## 9. Rollback-Prozedur

### 9.1 Vollständiger Rollback zu Base44

```bash
# 1. MySQL auf Stand vor Migration zurücksetzen
mysql -h [HOST] -u [USER] -p[PASSWORD] [DATABASE] < backup_pre_auth_migration_YYYYMMDD_HHMMSS.sql

# 2. Base44-Backup wiederherstellen (über Dashboard)
# Dashboard → Administration → Datenbank → Wiederherstellen

# 3. Code auf alten Stand zurücksetzen
# (Falls Git verwendet: git revert oder git checkout)

# 4. Cache leeren, App neu laden
```

### 9.2 Partieller Rollback

| Situation | Aktion |
|-----------|--------|
| AppUser-Tabelle fehlerhaft | `DROP TABLE AppUser; DROP TABLE AppSession;` |
| Backend-Functions fehlerhaft | Alte Function-Versionen wiederherstellen |
| Frontend fehlerhaft | Alte Component-Versionen wiederherstellen |
| User-Migration fehlerhaft | `TRUNCATE TABLE AppUser;` und neu migrieren |

### 9.3 Notfall-Kontakte

- [ ] Technischer Ansprechpartner: _________________
- [ ] Datenbankzugang: _________________
- [ ] Server-Zugang: _________________

---

## 10. Checkliste

### Vor der Migration

- [ ] MySQL-Vollbackup erstellt
- [ ] Base44-JSON-Backup heruntergeladen
- [ ] User-Liste dokumentiert (Email, Rolle, doctor_id für jeden User)
- [ ] JWT_SECRET generiert
- [ ] JWT_SECRET als Secret in Base44 gespeichert
- [ ] Wartungsfenster an alle User kommuniziert
- [ ] Rollback-Prozedur verstanden und getestet

### Datenbank

- [ ] AppUser-Tabelle erstellt
- [ ] (Optional) AppSession-Tabelle erstellt
- [ ] Root-User angelegt
- [ ] Root-Login getestet

### Backend

- [ ] authLogin.js implementiert und getestet
- [ ] authVerify.js implementiert
- [ ] authUserMgmt.js implementiert und getestet
- [ ] authChangePassword.js implementiert und getestet
- [ ] authMe.js implementiert und getestet
- [ ] authUpdateMe.js implementiert und getestet
- [ ] dbProxy.js auf neue Auth umgestellt
- [ ] sendShiftEmails.js auf neue Auth umgestellt
- [ ] exportScheduleToExcel.js auf neue Auth umgestellt
- [ ] atomicOperations.js auf neue Auth umgestellt
- [ ] renamePosition.js auf neue Auth umgestellt
- [ ] adminTools.js auf neue Auth umgestellt
- [ ] migrateToMysql.js auf neue Auth umgestellt
- [ ] Alle anderen Functions geprüft

### Frontend

- [ ] AuthProvider.jsx neu implementiert
- [ ] Login.jsx erstellt
- [ ] ChangePassword.jsx erstellt
- [ ] UserManagement.jsx erstellt
- [ ] Layout.js angepasst
- [ ] Alle base44.auth.* Aufrufe ersetzt
- [ ] API-Client mit JWT-Header erweitert

### Go-Live

- [ ] Alle bestehenden User migriert
- [ ] Initialpasswörter dokumentiert
- [ ] Root hat Passwort-Liste
- [ ] Alle User über neue Login-Methode informiert
- [ ] Monitoring aktiv
- [ ] Erste User-Logins erfolgreich

### Nach Go-Live

- [ ] Alle User haben sich angemeldet
- [ ] Alle User haben Passwort geändert
- [ ] Keine Fehler in Logs
- [ ] Base44-Auth-Code entfernt (optional, nach Stabilisierung)
- [ ] Alte Backups archiviert

---

## Anhang

### A. Nützliche SQL-Queries

```sql
-- Alle User auflisten
SELECT id, email, full_name, role, doctor_id, is_active, last_login 
FROM AppUser 
ORDER BY role, full_name;

-- User mit ausstehender Passwortänderung
SELECT email, full_name 
FROM AppUser 
WHERE must_change_password = TRUE AND is_active = TRUE;

-- Inaktive User
SELECT email, full_name, last_login 
FROM AppUser 
WHERE is_active = FALSE;

-- User ohne doctor_id (evtl. Admins)
SELECT email, full_name, role 
FROM AppUser 
WHERE doctor_id IS NULL;
```

### B. bcrypt Passwort-Hash generieren

```javascript
// Node.js
const bcrypt = require('bcrypt');
const password = 'MeinPasswort123!';
const hash = bcrypt.hashSync(password, 10);
console.log(hash);

// Deno
import * as bcrypt from "https://deno.land/x/bcrypt/mod.ts";
const hash = await bcrypt.hash("MeinPasswort123!");
console.log(hash);
```

### C. JWT Struktur

```json
{
  "header": {
    "alg": "HS256",
    "typ": "JWT"
  },
  "payload": {
    "sub": "user-uuid",
    "email": "user@example.com",
    "full_name": "Max Mustermann",
    "role": "admin",
    "doctor_id": "doctor-uuid",
    "iat": 1735776000,
    "exp": 1735862400
  }
}
```

### D. Fehlercode-Referenz

| Code | Bedeutung | Aktion |
|------|-----------|--------|
| 401 | Nicht authentifiziert | Redirect zu Login |
| 403 | Keine Berechtigung | Fehlermeldung anzeigen |
| 409 | Passwortänderung erforderlich | Redirect zu ChangePassword |
| 423 | Account gesperrt | Admin kontaktieren |

---

**Ende des Dokuments**