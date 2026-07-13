/**
 * CuraFlow — Ticket Service
 *
 * Sends bug reports and feature requests to an external ticket system.
 * Automatically attaches system info, user context, and console logs.
 *
 * @module lib/ticketService
 * @unused Currently no active UI component calls this service.
 *         The ticket submission UI was removed / never deployed.
 *         If re-enabled, verify TICKET_API_KEY and endpoint URL.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

interface TicketOptions {
  urgency?: string;
  consoleLogs?: string;
  contactEmail?: string;
  reporterEmail?: string;
  reporterName?: string;
  reporterId?: string;
  userName?: string;
}

interface SystemInfo {
  system: string;
  url: string;
  userAgent: string;
  platform: string;
  language: string;
  screen: string;
  timestamp: string;
  appVersion: string;
  userId?: string;
  userEmail?: string;
  userName?: string;
  reporterName?: string;
  reporterEmail?: string;
  tenant?: string;
  referrer?: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const TICKET_SYSTEM_URL =
  import.meta.env.VITE_TICKET_SYSTEM_URL || 'http://localhost:8010';
const TICKET_API_KEY: string = import.meta.env.VITE_TICKET_API_KEY || '';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function firstNonEmptyString(...values: (string | null | undefined)[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function getEmailLocalPart(email: string | null | undefined): string {
  if (typeof email !== 'string') return '';
  const normalizedEmail = email.trim();
  if (!normalizedEmail) return '';
  const atIndex = normalizedEmail.indexOf('@');
  return atIndex > 0 ? normalizedEmail.slice(0, atIndex) : normalizedEmail;
}

function resolveUserName(...values: (string | null | undefined)[]): string {
  const directValue = firstNonEmptyString(...values);
  return directValue ? getEmailLocalPart(directValue) : '';
}

// ─── System Info Collection ─────────────────────────────────────────────────

function collectSystemInfo(overrides: Record<string, string> = {}): SystemInfo {
  const info: SystemInfo = {
    system: 'CuraFlow',
    url: window.location.origin,
    userAgent: navigator.userAgent,
    platform: navigator.platform || '',
    language: navigator.language,
    screen: `${window.screen?.width}x${window.screen?.height}`,
    timestamp: new Date().toISOString(),
    appVersion: import.meta.env.VITE_APP_VERSION || '1.0.0',
    referrer: document.referrer || '',
  };

  // Try to read user from JWT token
  try {
    const token = localStorage.getItem('radioplan_jwt_token');
    if (token) {
      const payload = JSON.parse(atob(token.split('.')[1]));
      const tokenEmail = firstNonEmptyString(payload.email);
      info.userId = payload.id || payload.sub;
      info.userEmail =
        tokenEmail ||
        firstNonEmptyString(
          payload.username,
          payload.preferred_username,
          payload.login,
        );
      info.userName = resolveUserName(
        payload.username,
        payload.preferred_username,
        payload.login,
        payload.userName,
        tokenEmail,
        payload.name,
      );
      info.reporterName = firstNonEmptyString(
        payload.full_name,
        payload.displayName,
        payload.name,
        info.userName,
      );
    }
  } catch {
    // Token not readable — ignore
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

  const resolvedReporterName = firstNonEmptyString(
    overrides.reporterName,
    overrides.userName,
  );
  if (resolvedReporterName) {
    info.reporterName = resolvedReporterName;
  }

  if (info.userEmail && !info.reporterEmail) {
    info.reporterEmail = info.userEmail;
  }
  if (info.userName && !info.reporterName) {
    info.reporterName = info.userName;
  }

  // Tenant info
  try {
    const dbToken = localStorage.getItem('db_credentials');
    if (dbToken) {
      info.tenant = dbToken.substring(0, 20) + '...';
    }
  } catch {
    // Ignore
  }

  return info;
}

// ─── Console Log Capture ────────────────────────────────────────────────────

declare global {
  interface Window {
    __capturedLogs?: string[];
  }
}

function collectConsoleLogs(): string {
  try {
    if (window.__capturedLogs && Array.isArray(window.__capturedLogs)) {
      return window.__capturedLogs.slice(-50).join('\n');
    }
    return '';
  } catch {
    return '';
  }
}

// ─── Ticket Creation ────────────────────────────────────────────────────────

export async function createTicket(
  type: 'bug' | 'feature',
  title: string,
  description: string,
  options: TicketOptions = {},
): Promise<unknown> {
  const systemInfo = collectSystemInfo(options as Record<string, string>);
  const consoleLogs = options.consoleLogs || collectConsoleLogs();
  const reporterUserName =
    resolveUserName(
      options.userName,
      systemInfo.userName,
      systemInfo.reporterName,
      systemInfo.userEmail,
    ) || 'Unbekannt';
  const reporterEmail =
    options.reporterEmail ||
    options.contactEmail ||
    systemInfo.reporterEmail ||
    systemInfo.userEmail ||
    '';

  const body = {
    type,
    title,
    description:
      description +
      '\n\n--- Automatisch übermittelte Informationen ---\n' +
      JSON.stringify(systemInfo, null, 2),
    username: reporterUserName,
    system_id: 1,
    software_info: JSON.stringify(systemInfo),
    console_logs: consoleLogs,
    location: systemInfo.url,
    contact_email: reporterEmail,
    urgency: options.urgency || 'normal',
  };

  const headers: Record<string, string> = {
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

/** Shortcut: bug report */
export async function reportBug(
  title: string,
  description: string,
  options: TicketOptions = {},
): Promise<unknown> {
  return createTicket('bug', title, description, {
    ...options,
    urgency: options.urgency || 'normal',
  });
}

/** Shortcut: feature request */
export async function requestFeature(
  title: string,
  description: string,
  options: TicketOptions = {},
): Promise<unknown> {
  return createTicket('feature', title, description, {
    ...options,
    urgency: options.urgency || 'normal',
  });
}

// ─── Console Capture Initialization ─────────────────────────────────────────

/**
 * Monkey-patches console.log/warn/error to capture the last 200 entries.
 * Call once in main.jsx. Captured logs are included in bug reports.
 */
export function initConsoleCapture(): void {
  if (typeof window === 'undefined') return;

  if (!window.__capturedLogs) {
    window.__capturedLogs = [];
  }

  const logs = window.__capturedLogs;
  const pushEntry = (level: string) => (...args: unknown[]) => {
    logs.push(
      `[${level}] ${args
        .map((a) =>
          a instanceof Error
            ? `${a.message}\n${a.stack}`
            : typeof a === 'object'
              ? JSON.stringify(a)
              : String(a),
        )
        .join(' ')}`,
    );
    if (logs.length > 200) logs.shift();
  };

  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  console.log = function (...args: unknown[]) {
    pushEntry('LOG')(...args);
    originalLog.apply(console, args);
  };

  console.warn = function (...args: unknown[]) {
    pushEntry('WARN')(...args);
    originalWarn.apply(console, args);
  };

  console.error = function (...args: unknown[]) {
    pushEntry('ERROR')(...args);
    originalError.apply(console, args);
  };
}
