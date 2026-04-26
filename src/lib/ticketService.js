/**
 * TicketService – API-Client für das Ticketsystem
 * Sendet Bug-Reports und Feature-Requests an den firmeneigenen Ticketserver.
 * Automatische Übertragung von System-, Nutzer- und Umgebungsinformationen.
 */

const TICKET_SYSTEM_URL = import.meta.env.VITE_TICKET_SYSTEM_URL
  || 'http://localhost:8010';

const TICKET_API_KEY = import.meta.env.VITE_TICKET_API_KEY || '';

/**
 * Sammelt automatisch System-/Umgebungsinformationen
 */
function collectSystemInfo() {
  const info = {
    system: 'CuraFlow',
    url: window.location.origin,
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    screen: `${window.screen?.width}x${window.screen?.height}`,
    timestamp: new Date().toISOString(),
    appVersion: import.meta.env.VITE_APP_VERSION || '1.0.0',
  };

  // Versuche, den aktuellen Benutzer aus dem Auth-Kontext zu lesen
  try {
    const token = localStorage.getItem('radioplan_jwt_token');
    if (token) {
      const payload = JSON.parse(atob(token.split('.')[1]));
      info.userId = payload.id || payload.sub;
      info.userEmail = payload.email || payload.username;
      info.userName = payload.name || payload.email;
    }
  } catch {
    // Ignorieren, wenn Token nicht lesbar ist
  }

  // Mandant (DB-Token) Informationen
  try {
    const dbToken = localStorage.getItem('db_credentials');
    if (dbToken) {
      info.tenant = dbToken.substring(0, 20) + '...';
    }
  } catch {
    // Ignorieren
  }

  // IP-Adresse (via Server-seitige Ermittlung – wir senden sie als Referrer)
  info.referrer = document.referrer || '';

  return info;
}

/**
 * Sammelt Console-Logs für Bug-Reports
 */
function collectConsoleLogs() {
  try {
    const logs = [];
    // Letzte 50 Console-Einträge sammeln (falls verfügbar)
    if (window.__capturedLogs && Array.isArray(window.__capturedLogs)) {
      return window.__capturedLogs.slice(-50).join('\n');
    }
    return '';
  } catch {
    return '';
  }
}

/**
 * Ticket im Ticketsystem erstellen
 * @param {'bug'|'feature'} type - Typ des Tickets
 * @param {string} title - Titel
 * @param {string} description - Beschreibung
 * @param {Object} [options] - Optionale Zusatzinformationen
 * @param {string} [options.urgency] - Dringlichkeit (normal, emergency, safety)
 * @param {string} [options.consoleLogs] - Console-Logs
 * @param {string} [options.contactEmail] - Kontakt-E-Mail
 * @returns {Promise<Object>} - Ticket-Response
 */
export async function createTicket(type, title, description, options = {}) {
  const systemInfo = collectSystemInfo();
  const consoleLogs = options.consoleLogs || collectConsoleLogs();

  const body = {
    type,
    title,
    description: description + '\n\n--- Automatisch übermittelte Informationen ---\n' +
      JSON.stringify(systemInfo, null, 2),
    username: systemInfo.userName || systemInfo.userEmail || 'Unbekannt',
    system_id: 1, // CuraFlow-System-ID (muss ggf. angepasst werden)
    software_info: JSON.stringify(systemInfo),
    console_logs: consoleLogs,
    location: systemInfo.url,
    contact_email: options.contactEmail || systemInfo.userEmail || '',
    urgency: options.urgency || 'normal',
  };

  const headers = {
    'Content-Type': 'application/json',
  };

  if (TICKET_API_KEY) {
    headers['x-api-key'] = TICKET_API_KEY;
  }

  const response = await fetch(`${TICKET_SYSTEM_URL}/api/tickets`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unbekannter Fehler');
    throw new Error(`Ticket-Fehler (${response.status}): ${errorText}`);
  }

  return response.json();
}

/**
 * Bug-Report erstellen (Kurzform)
 */
export async function reportBug(title, description, options = {}) {
  return createTicket('bug', title, description, {
    ...options,
    urgency: options.urgency || 'normal',
  });
}

/**
 * Feature-Request erstellen (Kurzform)
 */
export async function requestFeature(title, description, options = {}) {
  return createTicket('feature', title, description, {
    ...options,
    urgency: options.urgency || 'normal',
  });
}

/**
 * Console-Logs global aufzeichnen (für Crash-Reports)
 * Aufruf einmalig in main.jsx
 */
export function initConsoleCapture() {
  if (typeof window === 'undefined') return;

  if (!window.__capturedLogs) {
    window.__capturedLogs = [];
  }

  const originalError = console.error;
  const originalWarn = console.warn;
  const originalLog = console.log;

  console.log = function (...args) {
    window.__capturedLogs.push(`[LOG] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')}`);
    if (window.__capturedLogs.length > 200) window.__capturedLogs.shift();
    return originalLog.apply(console, args);
  };

  console.warn = function (...args) {
    window.__capturedLogs.push(`[WARN] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')}`);
    if (window.__capturedLogs.length > 200) window.__capturedLogs.shift();
    return originalWarn.apply(console, args);
  };

  console.error = function (...args) {
    window.__capturedLogs.push(`[ERROR] ${args.map(a => {
      if (a instanceof Error) return `${a.message}\n${a.stack}`;
      return typeof a === 'object' ? JSON.stringify(a) : String(a);
    }).join(' ')}`);
    if (window.__capturedLogs.length > 200) window.__capturedLogs.shift();
    return originalError.apply(console, args);
  };

  // Auch unhandled promise rejections aufzeichnen
  window.addEventListener('unhandledrejection', (event) => {
    window.__capturedLogs.push(`[UNHANDLED] ${event.reason?.message || event.reason}`);
  });
}
