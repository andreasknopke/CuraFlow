/**
 * TicketService – API-Client für das Ticketsystem
 * Sendet Bug-Reports und Feature-Requests an den firmeneigenen Ticketserver.
 * Automatische Übertragung von System-, Nutzer- und Umgebungsinformationen.
 */

const TICKET_SYSTEM_URL = import.meta.env.VITE_TICKET_SYSTEM_URL
  || 'http://localhost:8010';

const TICKET_API_KEY = import.meta.env.VITE_TICKET_API_KEY || '';

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function getEmailLocalPart(email) {
  if (typeof email !== 'string') return '';

  const normalizedEmail = email.trim();
  if (!normalizedEmail) return '';

  const atIndex = normalizedEmail.indexOf('@');
  return atIndex > 0 ? normalizedEmail.slice(0, atIndex) : normalizedEmail;
}

function resolveUserName(...values) {
  const directValue = firstNonEmptyString(...values);
  return directValue ? getEmailLocalPart(directValue) : '';
}

/**
 * @typedef {Object} TicketOptions
 * @property {string} [urgency]
 * @property {string} [consoleLogs]
 * @property {string} [contactEmail]
 * @property {string} [reporterEmail]
 * @property {string} [reporterName]
 * @property {string} [reporterId]
 * @property {string} [userName]
 */

/**
 * Sammelt automatisch System-/Umgebungsinformationen
 */
function collectSystemInfo(overrides = {}) {
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
      const tokenEmail = firstNonEmptyString(payload.email);
      info.userId = payload.id || payload.sub;
      info.userEmail = tokenEmail || firstNonEmptyString(payload.username, payload.preferred_username, payload.login);
      info.userName = resolveUserName(
        payload.username,
        payload.preferred_username,
        payload.login,
        payload.userName,
        tokenEmail,
        payload.name,
      );
      info.reporterName = firstNonEmptyString(payload.full_name, payload.displayName, payload.name, info.userName);
    }
  } catch {
    // Ignorieren, wenn Token nicht lesbar ist
  }

  if (overrides.reporterId) {
    info.userId = overrides.reporterId;
  }

  const resolvedReporterEmail = overrides.reporterEmail || overrides.contactEmail;
  if (resolvedReporterEmail) {
    info.userEmail = resolvedReporterEmail;
    info.reporterEmail = resolvedReporterEmail;
  }

  const resolvedUserName = resolveUserName(overrides.userName, overrides.reporterName);
  if (resolvedUserName) {
    info.userName = resolvedUserName;
  }

  const resolvedReporterName = firstNonEmptyString(overrides.reporterName, overrides.userName);
  if (resolvedReporterName) {
    info.reporterName = resolvedReporterName;
  }

  if (info.userEmail && !info.reporterEmail) {
    info.reporterEmail = info.userEmail;
  }

  if (info.userName && !info.reporterName) {
    info.reporterName = info.userName;
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
    // Letzte 50 Console-Einträge sammeln (falls verfügbar)
    if (window['__capturedLogs'] && Array.isArray(window['__capturedLogs'])) {
      return window['__capturedLogs'].slice(-50).join('\n');
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
 * @param {TicketOptions} [options] - Optionale Zusatzinformationen
 * @returns {Promise<Object>} - Ticket-Response
 */
export async function createTicket(type, title, description, options = {}) {
  const systemInfo = collectSystemInfo(options);
  const consoleLogs = options.consoleLogs || collectConsoleLogs();
  const reporterUserName = resolveUserName(
    options.userName,
    systemInfo.userName,
    systemInfo.reporterName,
    systemInfo.userEmail,
  ) || 'Unbekannt';
  const reporterEmail = options.reporterEmail || options.contactEmail || systemInfo.reporterEmail || systemInfo.userEmail || '';

  const body = {
    type,
    title,
    description: description + '\n\n--- Automatisch übermittelte Informationen ---\n' +
      JSON.stringify(systemInfo, null, 2),
    username: reporterUserName,
    system_id: 1, // CuraFlow-System-ID (muss ggf. angepasst werden)
    software_info: JSON.stringify(systemInfo),
    console_logs: consoleLogs,
    location: systemInfo.url,
    contact_email: reporterEmail,
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

  if (!window['__capturedLogs']) {
    window['__capturedLogs'] = [];
  }

  const originalError = console.error;
  const originalWarn = console.warn;
  const originalLog = console.log;

  console.log = function (...args) {
    window['__capturedLogs'].push(`[LOG] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')}`);
    if (window['__capturedLogs'].length > 200) window['__capturedLogs'].shift();
    return originalLog.apply(console, args);
  };

  console.warn = function (...args) {
    window['__capturedLogs'].push(`[WARN] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')}`);
    if (window['__capturedLogs'].length > 200) window['__capturedLogs'].shift();
    return originalWarn.apply(console, args);
  };

  console.error = function (...args) {
    window['__capturedLogs'].push(`[ERROR] ${args.map(a => {
      if (a instanceof Error) return `${a.message}\n${a.stack}`;
      return typeof a === 'object' ? JSON.stringify(a) : String(a);
    }).join(' ')}`);
    if (window['__capturedLogs'].length > 200) window['__capturedLogs'].shift();
    return originalError.apply(console, args);
  };

  // Auch unhandled promise rejections aufzeichnen
  window.addEventListener('unhandledrejection', (event) => {
    window['__capturedLogs'].push(`[UNHANDLED] ${event.reason?.message || event.reason}`);
  });
}
