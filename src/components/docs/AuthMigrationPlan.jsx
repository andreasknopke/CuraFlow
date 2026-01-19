/**
 * =============================================================================
 * AUTH MIGRATION PLAN: Base44 Auth -> Custom JWT Auth (MySQL)
 * =============================================================================
 * 
 * ÜBERSICHT
 * ---------
 * Migration von Base44's eingebauter Authentifizierung zu einem eigenen
 * JWT-basierten System mit MySQL-Backend für volle Kontrolle über User-Daten.
 * 
 * 
 * PHASE 1: DATABASE SETUP
 * -----------------------
 * 
 * 1.1 MySQL Tabelle erstellen:
 * 
 *     CREATE TABLE app_users (
 *         id VARCHAR(36) PRIMARY KEY,
 *         email VARCHAR(255) UNIQUE NOT NULL,
 *         password_hash VARCHAR(255) NOT NULL,
 *         full_name VARCHAR(255),
 *         role ENUM('admin', 'user') DEFAULT 'user',
 *         doctor_id VARCHAR(36),
 *         
 *         -- User Preferences (migrated from Base44)
 *         theme TEXT,
 *         section_config TEXT,
 *         collapsed_sections JSON,
 *         schedule_hidden_rows JSON,
 *         schedule_show_sidebar BOOLEAN DEFAULT TRUE,
 *         highlight_my_name BOOLEAN DEFAULT TRUE,
 *         grid_font_size INT DEFAULT 14,
 *         
 *         -- Wish Overview Preferences
 *         wish_show_occupied BOOLEAN DEFAULT TRUE,
 *         wish_show_absences BOOLEAN DEFAULT TRUE,
 *         wish_hidden_doctors JSON,
 *         
 *         -- Metadata
 *         created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 *         updated_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 *         last_login TIMESTAMP,
 *         is_active BOOLEAN DEFAULT TRUE
 *     );
 * 
 * 
 * PHASE 2: BACKEND FUNCTIONS
 * --------------------------
 * 
 * 2.1 functions/auth.js - Endpoints:
 *     - POST /register - Neuen User erstellen (nur Admin)
 *     - POST /login - Login mit Email/Password, gibt JWT zurück
 *     - POST /logout - Token invalidieren (optional: Blacklist)
 *     - GET /me - Aktuellen User abrufen (via JWT)
 *     - PUT /me - User-Daten aktualisieren
 *     - POST /refresh - Token erneuern
 * 
 * 2.2 JWT Struktur:
 *     {
 *         sub: user_id,
 *         email: user_email,
 *         role: 'admin' | 'user',
 *         doctor_id: doctor_id | null,
 *         iat: issued_at,
 *         exp: expiration (24h)
 *     }
 * 
 * 2.3 Neue Secrets benötigt:
 *     - JWT_SECRET (für Token-Signierung)
 * 
 * 
 * PHASE 3: FRONTEND ANPASSUNGEN
 * -----------------------------
 * 
 * 3.1 Neuer AuthProvider (components/AuthProvider.js):
 *     - Token in localStorage/httpOnly Cookie speichern
 *     - Auto-Refresh bei Token-Ablauf
 *     - Redirect zu Login bei 401
 * 
 * 3.2 Neuer API Client Wrapper:
 *     - Authorization Header automatisch setzen
 *     - 401 Handling
 * 
 * 3.3 Login Page erstellen:
 *     - Email/Password Form
 *     - Error Handling
 *     - Redirect nach Login
 * 
 * 
 * PHASE 4: MIGRATION
 * ------------------
 * 
 * 4.1 Bestehende Base44 User migrieren:
 *     - User-Daten aus Base44 exportieren
 *     - In MySQL importieren
 *     - Temporäre Passwörter generieren
 *     - User zur Passwort-Änderung auffordern
 * 
 * 4.2 Parallelbetrieb (optional):
 *     - Beide Auth-Systeme temporär unterstützen
 *     - Schrittweise Migration
 * 
 * 
 * IMPLEMENTIERUNGS-REIHENFOLGE
 * ----------------------------
 * 
 * 1. [ ] JWT_SECRET als Secret hinzufügen
 * 2. [ ] MySQL Tabelle erstellen (via dbProxy oder manuell)
 * 3. [ ] Backend function: functions/auth.js
 * 4. [ ] Frontend: Neuer AuthProvider
 * 5. [ ] Frontend: Login Page
 * 6. [ ] Frontend: API Client anpassen
 * 7. [ ] Migration der bestehenden User
 * 8. [ ] Base44 Auth entfernen
 * 
 * 
 * ROLLBACK PLAN
 * -------------
 * 
 * Bei Problemen:
 * 1. AuthProvider zurück auf Base44 umstellen
 * 2. Login Page deaktivieren
 * 3. base44.auth.* wieder verwenden
 * 
 * 
 * SICHERHEITSHINWEISE
 * -------------------
 * 
 * - Passwörter mit bcrypt hashen (cost factor 12)
 * - JWT nur über HTTPS übertragen
 * - Token-Refresh vor Ablauf implementieren
 * - Rate Limiting für Login-Versuche
 * - Audit Log für Login-Ereignisse
 * 
 */

export const AUTH_MIGRATION_STATUS = {
    phase: 3,
    completed: [
        'JWT_SECRET einrichten',
        'Backend Auth Function (functions/auth.js)',
        'Setup Script (functions/setupAuthTable.js)',
        'Frontend AuthProvider (components/AuthProvider.jsx - mit Umschalter)',
        'Login Page (pages/AuthLogin.jsx)'
    ],
    pending: [
        'MySQL Tabelle erstellen (setupAuthTable aufrufen)',
        'Initial Admin erstellen',
        'User Migration von Base44',
        'USE_CUSTOM_AUTH auf true setzen'
    ],
    
    // Nächste Schritte:
    // 1. Als Admin einloggen (Base44)
    // 2. functions/setupAuthTable aufrufen mit: { action: 'createTable' }
    // 3. functions/setupAuthTable aufrufen mit: { action: 'createInitialAdmin', initialAdminEmail: '...', initialAdminPassword: '...' }
    // 4. functions/setupAuthTable aufrufen mit: { action: 'migrateFromBase44' }
    // 5. In components/AuthProvider.jsx: USE_CUSTOM_AUTH auf true setzen
    // 6. Testen: /AuthLogin aufrufen und einloggen
};