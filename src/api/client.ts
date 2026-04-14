/**
 * Einfacher API Client für Railway Backend
 * Kommuniziert direkt mit Express API über MySQL
 * Unterstützt Multi-Tenant via DB-Token
 */

import {
  JWT_TOKEN_KEY,
  JWT_REFRESH_TOKEN_KEY,
  DB_CREDENTIALS_KEY,
  DB_TOKEN_ENABLED_KEY,
} from '@/constants/storageKeys';
import type { ReactNode } from 'react';
import { createDbCollections, EntityClient } from './dbCollections';
import { registerAPIClientMethods, type APIClientMethods } from './clientMethods';

type ToastFn = (props: {
  variant?: 'default' | 'destructive';
  title?: ReactNode;
  description?: ReactNode;
  [key: string]: unknown;
}) => unknown;

type RequestOptions = RequestInit & { headers?: Record<string, string> };

interface RequestErrorExtras {
  status?: number;
  code?: string;
  details?: unknown;
  databaseError?: boolean;
  retryable?: boolean;
}

interface RequestError extends Error {
  status?: number;
  code?: string;
  details?: unknown;
  databaseError?: boolean;
  retryable?: boolean;
}

interface DatabaseProblemCheck {
  status?: number;
  errorData?: Record<string, unknown> | null;
  error?: RequestError | null;
}

// Toast notification is injected at runtime to avoid circular dependency.
let _toastFn: ToastFn | null = null;
export function setApiToast(toastFn: ToastFn): void {
  _toastFn = toastFn;
}

const API_URL =
  import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:3000' : '');
const TOKEN_KEY = JWT_TOKEN_KEY;
const REFRESH_TOKEN_KEY = JWT_REFRESH_TOKEN_KEY;
const DB_TOKEN_KEY = DB_CREDENTIALS_KEY;
const DB_TOKEN_ENABLED = DB_TOKEN_ENABLED_KEY;
const REQUEST_RETRY_DELAYS_MS = [300, 900];
const DATABASE_TOAST_COOLDOWN_MS = 15000;
const AUTH_REFRESH_EXCLUDED_ENDPOINTS = ['/api/auth/login', '/api/auth/refresh'];
const DATABASE_ERROR_PATTERNS = [
  /database/i,
  /mysql/i,
  /sql/i,
  /connection.*closed/i,
  /lost connection/i,
  /server has gone away/i,
  /unknown column/i,
  /doesn't exist/i,
  /ECONNRESET/i,
  /ECONNREFUSED/i,
  /ETIMEDOUT/i,
  /PROTOCOL_CONNECTION_LOST/i,
  /ER_[A-Z_]+/i,
];

let lastDatabaseToastAt = 0;

function shouldAttachDbToken(endpoint: string): boolean {
  return !endpoint.startsWith('/api/auth/');
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractErrorMessage(errorData: unknown): string {
  if (!errorData) return '';
  if (typeof errorData === 'string') return errorData;
  const obj = errorData as Record<string, string>;
  return obj.error || obj.message || obj.details || '';
}

function isDatabaseProblem({ status, errorData, error }: DatabaseProblemCheck): boolean {
  if (errorData?.databaseError === true) {
    return true;
  }

  if (status === 503) {
    return true;
  }

  const code = errorData?.code || error?.code || '';
  if (
    typeof code === 'string' &&
    (code.startsWith('ER_') ||
      code.startsWith('PROTOCOL_') ||
      code === 'ECONNRESET' ||
      code === 'ECONNREFUSED' ||
      code === 'ETIMEDOUT')
  ) {
    return true;
  }

  const message = [extractErrorMessage(errorData), error?.message || ''].join(' ').trim();
  return DATABASE_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

function notifyDatabaseProblem(message: string): void {
  const now = Date.now();
  if (now - lastDatabaseToastAt < DATABASE_TOAST_COOLDOWN_MS) {
    return;
  }

  lastDatabaseToastAt = now;
  if (typeof _toastFn === 'function') {
    _toastFn({
      variant: 'destructive',
      title: 'Datenbankproblem',
      description:
        message ||
        'Die Datenbank ist momentan nicht stabil erreichbar. Bitte versuchen Sie es erneut.',
    });
  }
}

function createRequestError(message: string, extras: RequestErrorExtras = {}): RequestError {
  const error = new Error(message) as RequestError;
  Object.assign(error, extras);
  return error;
}

export class APIClient {
  baseURL: string;
  refreshPromise: Promise<string> | null;

  constructor() {
    this.baseURL = API_URL;
    this.refreshPromise = null;
  }

  getToken(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  }

  setToken(token: string | null): void {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(REFRESH_TOKEN_KEY);
    }
  }

  getRefreshToken(): string | null {
    return localStorage.getItem(REFRESH_TOKEN_KEY);
  }

  setRefreshToken(refreshToken: string | null): void {
    if (refreshToken) {
      localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
    } else {
      localStorage.removeItem(REFRESH_TOKEN_KEY);
    }
  }

  clearAuthTokens(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  }

  // Get active DB token (only if enabled)
  getDbToken(): string | null {
    const enabled = localStorage.getItem(DB_TOKEN_ENABLED) === 'true';
    if (!enabled) return null;
    return localStorage.getItem(DB_TOKEN_KEY);
  }

  shouldAttemptTokenRefresh(endpoint: string, error: RequestError): boolean {
    return (
      !AUTH_REFRESH_EXCLUDED_ENDPOINTS.includes(endpoint) &&
      error?.status === 401 &&
      Boolean(this.getRefreshToken())
    );
  }

  async refreshAccessToken(): Promise<string> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    const refreshToken = this.getRefreshToken();
    if (!refreshToken) {
      this.clearAuthTokens();
      throw createRequestError('Nicht autorisiert', { status: 401 });
    }

    this.refreshPromise = (async () => {
      const response = await fetch(`${this.baseURL}/api/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refreshToken }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(async () => {
          const text = await response.text().catch(() => 'Refresh failed');
          return { error: text || 'Refresh failed' };
        });

        this.clearAuthTokens();
        throw createRequestError(extractErrorMessage(errorData) || 'Refresh fehlgeschlagen', {
          status: response.status,
          details: errorData,
        });
      }

      const data = await response.json();
      if (!data?.token || !data?.refreshToken) {
        this.clearAuthTokens();
        throw createRequestError('Refresh-Antwort ist unvollständig', { status: 500 });
      }

      this.setToken(data.token);
      this.setRefreshToken(data.refreshToken);
      return data.token;
    })().finally(() => {
      this.refreshPromise = null;
    });

    return this.refreshPromise;
  }

  async request(
    endpoint: string,
    options: RequestOptions = {},
    internal: { allowRefresh: boolean } = { allowRefresh: true },
  ): Promise<any> {
    const token = this.getToken();
    const dbToken = shouldAttachDbToken(endpoint) ? this.getDbToken() : null;

    const headers = {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
      ...(dbToken && { 'X-DB-Token': dbToken }),
      ...options.headers,
    };

    const config = {
      ...options,
      headers,
    };

    const url = `${this.baseURL}${endpoint}`;

    for (let attempt = 1; attempt <= REQUEST_RETRY_DELAYS_MS.length + 1; attempt += 1) {
      try {
        const response = await fetch(url, config);

        if (!response.ok) {
          const errorData = await response.json().catch(async () => {
            const text = await response.text().catch(() => 'Request failed');
            return { error: text || 'Request failed' };
          });
          const message = extractErrorMessage(errorData) || `HTTP ${response.status}`;
          const databaseError = isDatabaseProblem({ status: response.status, errorData });
          throw createRequestError(message, {
            status: response.status,
            code: errorData?.code,
            details: errorData,
            databaseError,
            retryable: databaseError && (response.status >= 500 || response.status === 503),
          });
        }

        return response.json();
      } catch (error: any) {
        if (internal.allowRefresh && this.shouldAttemptTokenRefresh(endpoint, error)) {
          try {
            await this.refreshAccessToken();
            return this.request(endpoint, options, { allowRefresh: false });
          } catch (refreshError) {
            throw refreshError;
          }
        }

        const databaseError = isDatabaseProblem({
          status: error.status,
          errorData: error.details,
          error,
        });
        const networkError =
          error instanceof TypeError || /Failed to fetch/i.test(error.message || '');
        const canRetry =
          attempt <= REQUEST_RETRY_DELAYS_MS.length &&
          (networkError || (databaseError && error.retryable !== false));

        if (canRetry) {
          console.warn(
            `[API] Retry ${attempt}/${REQUEST_RETRY_DELAYS_MS.length + 1} for ${endpoint}`,
            {
              message: error.message,
              status: error.status || null,
              code: error.code || null,
            },
          );
          await wait(REQUEST_RETRY_DELAYS_MS[attempt - 1]);
          continue;
        }

        if (databaseError || networkError) {
          console.error(`[API] Database/server issue on ${endpoint}`, {
            message: error.message,
            status: error.status || null,
            code: error.code || null,
            details: error.details || null,
          });
          notifyDatabaseProblem(
            'Beim Speichern oder Laden gab es ein Datenbankproblem. Bitte versuchen Sie es erneut.',
          );
        }

        throw error;
      }
    }
  }
}

export interface APIClient extends APIClientMethods {}

registerAPIClientMethods(APIClient);

export const api = new APIClient();
export const db = createDbCollections(api);
export { EntityClient };
