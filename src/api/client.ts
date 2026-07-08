/**
 * CuraFlow — API Client
 *
 * Communicates directly with the Express backend via HTTP.
 * Supports multi-tenant via X-DB-Token header, JWT auth, and automatic retry
 * for transient database errors.
 *
 * @module api/client
 */

import { toast as showToast } from '@/components/ui/use-toast';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  skipDbToken?: boolean;
  body?: BodyInit | Record<string, unknown>;
}

export interface ApiError extends Error {
  status?: number;
  code?: string;
  details?: unknown;
  databaseError?: boolean;
  retryable?: boolean;
}

export interface RetryableCheckParams {
  status: number;
  errorData: Record<string, unknown>;
  databaseError: boolean;
}

export interface ShiftData {
  doctor_id?: string;
  date?: string;
  position?: string;
  timeslot_id?: string | null;
  [key: string]: unknown;
}

export interface CertificateUploadParams {
  file: File;
  doctor_id: string;
  qualification_id?: string;
  doctor_qualification_id?: string;
  granted_date?: string;
  expiry_date?: string;
  notes?: string;
  evidence_role?: string;
  qualification_name?: string;
  qualification_description?: string;
  approval_token?: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const API_URL =
  import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:3000' : '');
const TOKEN_KEY = 'radioplan_jwt_token';
const DB_TOKEN_KEY = 'db_credentials';
const DB_TOKEN_ENABLED_KEY = 'db_token_enabled';
const REQUEST_RETRY_DELAYS_MS: number[] = [300, 900];
const DATABASE_TOAST_COOLDOWN_MS = 15000;

const DATABASE_ERROR_PATTERNS: RegExp[] = [
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

let lastDatabaseToastAt = 0;

function shouldAttachDbToken(endpoint: string): boolean {
  return (
    !endpoint.startsWith('/api/auth/') &&
    !endpoint.startsWith('/api/master/') &&
    !endpoint.startsWith('/api/admin/db-tokens') &&
    endpoint !== '/api/admin/migration-status' &&
    endpoint !== '/api/admin/run-migrations'
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractErrorMessage(errorData: unknown): string {
  if (!errorData) return '';
  if (typeof errorData === 'string') return errorData;
  if (typeof errorData === 'object' && errorData !== null) {
    const obj = errorData as Record<string, unknown>;
    return String(obj.error || obj.message || obj.details || '');
  }
  return '';
}

function isDatabaseProblem({
  status,
  errorData,
  error,
}: {
  status?: number;
  errorData?: Record<string, unknown> | null;
  error?: Partial<ApiError>;
}): boolean {
  if (errorData?.databaseError === true) return true;
  if (status === 503) return true;

  const code = (errorData?.code as string) || error?.code || '';
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
  if (now - lastDatabaseToastAt < DATABASE_TOAST_COOLDOWN_MS) return;

  lastDatabaseToastAt = now;
  showToast({
    variant: 'destructive',
    title: 'Datenbankproblem',
    description:
      message ||
      'Die Datenbank ist momentan nicht stabil erreichbar. Bitte versuchen Sie es erneut.',
  });
}

function createRequestError(message: string, extras: Record<string, unknown> = {}): ApiError {
  const error = new Error(message) as ApiError;
  Object.assign(error, extras);
  return error;
}

async function parseSuccessResponse(response: Response): Promise<unknown> {
  if (response.status === 204) return null;

  const rawBody = await response.text();
  if (!rawBody) return null;

  try {
    return JSON.parse(rawBody);
  } catch {
    return rawBody;
  }
}

export function resolveRequestRetryable({
  status,
  errorData,
  databaseError,
}: RetryableCheckParams): boolean {
  if (!databaseError) return false;

  if (typeof errorData?.retryable === 'boolean') {
    return errorData.retryable;
  }

  return status >= 500 || status === 503;
}

// ─── APIClient Class ─────────────────────────────────────────────────────────

class APIClient {
  baseURL: string;

  constructor() {
    this.baseURL = API_URL;
  }

  getToken(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  }

  setToken(token: string | null): void {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  }

  getDbToken(): string | null {
    const enabled = localStorage.getItem(DB_TOKEN_ENABLED_KEY) === 'true';
    if (!enabled) return null;
    return localStorage.getItem(DB_TOKEN_KEY);
  }

  async request(endpoint: string, options: RequestOptions = {}): Promise<unknown> {
    const token = this.getToken();
    const { skipDbToken = false, ...requestOptions } = options;
    const dbToken =
      !skipDbToken && shouldAttachDbToken(endpoint) ? this.getDbToken() : null;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
      ...(dbToken && { 'X-DB-Token': dbToken }),
    };

    // Merge in caller-provided headers
    if (options.headers) {
      const optsHeaders = options.headers as Record<string, string>;
      for (const key of Object.keys(optsHeaders)) {
        headers[key] = optsHeaders[key];
      }
    }

    const bodyIsObject =
      requestOptions.body && typeof requestOptions.body === 'object' && !(requestOptions.body instanceof FormData) && !(requestOptions.body instanceof Blob);
    const config: RequestInit = {
      ...requestOptions,
      headers,
      body: bodyIsObject
        ? JSON.stringify(requestOptions.body)
        : (requestOptions.body as BodyInit | undefined),
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
          const message =
            extractErrorMessage(errorData) || `HTTP ${response.status}`;
          const dbError = isDatabaseProblem({
            status: response.status,
            errorData,
          });
          throw createRequestError(message, {
            status: response.status,
            code: errorData?.code,
            details: errorData,
            databaseError: dbError,
            retryable: resolveRequestRetryable({
              status: response.status,
              errorData,
              databaseError: dbError,
            }),
          });
        }

        return parseSuccessResponse(response);
      } catch (error) {
        const apiError = error as ApiError;
        const dbError = isDatabaseProblem({
          status: apiError.status,
          errorData: apiError.details as Record<string, unknown> | undefined,
          error: apiError,
        });
        const networkError =
          apiError instanceof TypeError ||
          /Failed to fetch/i.test(apiError.message || '');
        const canRetry =
          attempt <= REQUEST_RETRY_DELAYS_MS.length &&
          (networkError || (dbError && apiError.retryable !== false));

        if (canRetry) {
          console.warn(
            `[API] Retry ${attempt}/${REQUEST_RETRY_DELAYS_MS.length + 1} for ${endpoint}`,
            {
              message: apiError.message,
              status: apiError.status || null,
              code: apiError.code || null,
            },
          );
          await wait(REQUEST_RETRY_DELAYS_MS[attempt - 1]);
          continue;
        }

        if (dbError || networkError) {
          console.error(`[API] Database/server issue on ${endpoint}`, {
            message: apiError.message,
            status: apiError.status || null,
            code: apiError.code || null,
            details: apiError.details || null,
          });
          notifyDatabaseProblem(
            'Beim Speichern oder Laden gab es ein Datenbankproblem. Bitte versuchen Sie es erneut.',
          );
        }

        // Global 403 handler: alert only on /api/db and /api/atomic mutations
        // (ShiftEntry, WishRequest, AbsenceRequest write operations).
        // All other endpoints (groups, rotations, auth, admin, master) are either
        // background-reads or have their own specific error handling already.
        if (apiError.status === 403) {
          if (endpoint.startsWith('/api/db') || endpoint.startsWith('/api/atomic')) {
            let isWriteOp = true;
            try {
              if (config.body && typeof config.body === 'string') {
                const parsed = JSON.parse(config.body);
                const action = parsed.action || parsed.operation || '';
                if (['list', 'filter', 'get'].includes(action)) {
                  isWriteOp = false;
                }
              }
            } catch { /* use default */ }
            if (isWriteOp) {
              window.alert(
                'Zugriff verweigert: Ihnen fehlt die Berechtigung für diese Aktion. '
                + 'Bitte wenden Sie sich an Ihren Super-Admin.',
              );
            }
          }
        }

        throw apiError;
      }
    }
  }

  // ==================== Auth ====================

  async login(email: string, password: string): Promise<{ token?: string; [key: string]: unknown }> {
    const data = (await this.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })) as { token?: string; [key: string]: unknown };
    if (data.token) {
      this.setToken(data.token);
    }
    return data;
  }

  async register(userData: Record<string, unknown>): Promise<unknown> {
    return this.request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(userData),
    });
  }

  async me(): Promise<unknown> {
    return this.request('/api/auth/me');
  }

  async updatePresence(): Promise<unknown> {
    return this.request('/api/auth/presence', { method: 'POST' });
  }

  async getJitsiToken(): Promise<unknown> {
    return this.request('/api/auth/jitsi-token');
  }

  async listCoworkContacts(): Promise<unknown> {
    return this.request(`/api/auth/cowork/contacts?_=${Date.now()}`, {
      cache: 'no-store',
    });
  }

  async listCoworkInvites(): Promise<unknown> {
    return this.request(`/api/auth/cowork/invites?_=${Date.now()}`, {
      cache: 'no-store',
    });
  }

  async sendCoworkInvite(inviteeUserId: string): Promise<unknown> {
    return this.request('/api/auth/cowork/invites', {
      method: 'POST',
      body: JSON.stringify({ inviteeUserId }),
    });
  }

  async declineCoworkInvite(inviteId: string): Promise<unknown> {
    return this.request(`/api/auth/cowork/invites/${inviteId}/decline`, {
      method: 'POST',
    });
  }

  async cancelCoworkInvite(inviteId: string): Promise<unknown> {
    return this.request(`/api/auth/cowork/invites/${inviteId}/cancel`, {
      method: 'POST',
    });
  }

  async joinCoworkInvite(inviteId: string): Promise<unknown> {
    return this.request(`/api/auth/cowork/session/${inviteId}`, {
      method: 'POST',
    });
  }

  async updateMe(updates: Record<string, unknown>): Promise<unknown> {
    return this.request('/api/auth/me', {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<unknown> {
    return this.request('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  }

  async forceChangePassword(newPassword: string): Promise<unknown> {
    return this.request('/api/auth/force-change-password', {
      method: 'POST',
      body: JSON.stringify({ newPassword }),
    });
  }

  async changeEmail(newEmail: string, password: string): Promise<unknown> {
    return this.request('/api/auth/change-email', {
      method: 'POST',
      body: JSON.stringify({ newEmail, password }),
    });
  }

  async logout(): Promise<{ success: boolean }> {
    this.setToken(null);
    return { success: true };
  }

  async verify(): Promise<boolean> {
    try {
      await this.me();
      return true;
    } catch {
      return false;
    }
  }

  async getMyTenants(): Promise<unknown> {
    return this.request('/api/auth/my-tenants');
  }

  async activateTenant(tokenId: string): Promise<unknown> {
    return this.request(`/api/auth/activate-tenant/${tokenId}`, {
      method: 'POST',
    });
  }

  // ==================== Tenant Groups ====================

  async getMyGroups(): Promise<unknown> {
    return this.request('/api/auth/my-groups');
  }

  async getVisiblePoolShifts({ from, to }: { from?: string; to?: string } = {}): Promise<unknown> {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const qs = params.toString();
    return this.request(`/api/groups/visible-shifts${qs ? `?${qs}` : ''}`);
  }

  async getGroupCentralAbsences({ from, to }: { from?: string; to?: string } = {}): Promise<unknown> {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const qs = params.toString();
    return this.request(`/api/groups/central-absences${qs ? `?${qs}` : ''}`);
  }

  async getGroupCentralWishes({ from, to }: { from?: string; to?: string } = {}): Promise<unknown> {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const qs = params.toString();
    return this.request(`/api/groups/central-wishes${qs ? `?${qs}` : ''}`);
  }

  async createGroupCentralWish(data: Record<string, unknown>): Promise<unknown> {
    return this.request('/api/groups/central-wishes', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateGroupCentralWish(id: string, data: Record<string, unknown>): Promise<unknown> {
    return this.request(`/api/groups/central-wishes/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deleteGroupCentralWish(id: string): Promise<unknown> {
    return this.request(`/api/groups/central-wishes/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  async listGroups(): Promise<unknown> {
    return this.request('/api/groups');
  }

  async getGroup(groupId: string): Promise<unknown> {
    return this.request(`/api/groups/${encodeURIComponent(groupId)}`);
  }

  async createGroup(data: Record<string, unknown>): Promise<unknown> {
    return this.request('/api/groups', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateGroup(groupId: string, data: Record<string, unknown>): Promise<unknown> {
    return this.request(`/api/groups/${encodeURIComponent(groupId)}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deleteGroup(groupId: string): Promise<unknown> {
    return this.request(`/api/groups/${encodeURIComponent(groupId)}`, {
      method: 'DELETE',
    });
  }

  async listGroupMembers(groupId: string): Promise<unknown> {
    return this.request(`/api/groups/${encodeURIComponent(groupId)}/members`);
  }

  async addGroupMember(groupId: string, tenantId: string): Promise<unknown> {
    return this.request(`/api/groups/${encodeURIComponent(groupId)}/members`, {
      method: 'POST',
      body: JSON.stringify({ tenant_id: tenantId }),
    });
  }

  async removeGroupMember(groupId: string, tenantId: string): Promise<unknown> {
    return this.request(
      `/api/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(tenantId)}`,
      { method: 'DELETE' },
    );
  }

  async listSharedWorkplaces(groupId: string): Promise<unknown> {
    return this.request(`/api/groups/${encodeURIComponent(groupId)}/workplaces`);
  }

  async createSharedWorkplace(groupId: string, data: Record<string, unknown>): Promise<unknown> {
    return this.request(`/api/groups/${encodeURIComponent(groupId)}/workplaces`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateSharedWorkplace(
    groupId: string,
    workplaceId: string,
    data: Record<string, unknown>,
  ): Promise<unknown> {
    return this.request(
      `/api/groups/${encodeURIComponent(groupId)}/workplaces/${encodeURIComponent(workplaceId)}`,
      { method: 'PATCH', body: JSON.stringify(data) },
    );
  }

  async deleteSharedWorkplace(groupId: string, workplaceId: string): Promise<unknown> {
    return this.request(
      `/api/groups/${encodeURIComponent(groupId)}/workplaces/${encodeURIComponent(workplaceId)}`,
      { method: 'DELETE' },
    );
  }

  async listSharedWorkplaceTimeslots(
    groupId: string,
    workplaceId: string,
  ): Promise<unknown> {
    return this.request(
      `/api/groups/${encodeURIComponent(groupId)}/workplaces/${encodeURIComponent(workplaceId)}/timeslots`,
    );
  }

  async createSharedWorkplaceTimeslot(
    groupId: string,
    workplaceId: string,
    data: Record<string, unknown>,
  ): Promise<unknown> {
    return this.request(
      `/api/groups/${encodeURIComponent(groupId)}/workplaces/${encodeURIComponent(workplaceId)}/timeslots`,
      { method: 'POST', body: JSON.stringify(data) },
    );
  }

  async updateSharedWorkplaceTimeslot(
    groupId: string,
    workplaceId: string,
    timeslotId: string,
    data: Record<string, unknown>,
  ): Promise<unknown> {
    return this.request(
      `/api/groups/${encodeURIComponent(groupId)}/workplaces/${encodeURIComponent(workplaceId)}/timeslots/${encodeURIComponent(timeslotId)}`,
      { method: 'PATCH', body: JSON.stringify(data) },
    );
  }

  async deleteSharedWorkplaceTimeslot(
    groupId: string,
    workplaceId: string,
    timeslotId: string,
  ): Promise<unknown> {
    return this.request(
      `/api/groups/${encodeURIComponent(groupId)}/workplaces/${encodeURIComponent(workplaceId)}/timeslots/${encodeURIComponent(timeslotId)}`,
      { method: 'DELETE' },
    );
  }

  async getWorkplaceQuotas(groupId: string, workplaceId: string): Promise<unknown> {
    return this.request(
      `/api/groups/${encodeURIComponent(groupId)}/workplaces/${encodeURIComponent(workplaceId)}/quotas`,
    );
  }

  async replaceWorkplaceQuotas(
    groupId: string,
    workplaceId: string,
    quotas: unknown[],
  ): Promise<unknown> {
    return this.request(
      `/api/groups/${encodeURIComponent(groupId)}/workplaces/${encodeURIComponent(workplaceId)}/quotas`,
      { method: 'PUT', body: JSON.stringify({ quotas }) },
    );
  }

  async getGroupStaff(groupId: string): Promise<unknown> {
    return this.request(`/api/groups/${encodeURIComponent(groupId)}/staff`);
  }

  async getGroupQualifications(groupId: string): Promise<unknown> {
    return this.request(`/api/groups/${encodeURIComponent(groupId)}/qualifications`);
  }

  async getWorkplaceQualifications(
    groupId: string,
    workplaceId: string,
  ): Promise<unknown> {
    return this.request(
      `/api/groups/${encodeURIComponent(groupId)}/workplaces/${encodeURIComponent(workplaceId)}/qualifications`,
    );
  }

  async replaceWorkplaceQualifications(
    groupId: string,
    workplaceId: string,
    qualifications: unknown[],
  ): Promise<unknown> {
    return this.request(
      `/api/groups/${encodeURIComponent(groupId)}/workplaces/${encodeURIComponent(workplaceId)}/qualifications`,
      { method: 'PUT', body: JSON.stringify({ qualifications }) },
    );
  }

  async getWorkplaceEligibleStaff(
    groupId: string,
    workplaceId: string,
  ): Promise<unknown> {
    return this.request(
      `/api/groups/${encodeURIComponent(groupId)}/workplaces/${encodeURIComponent(workplaceId)}/eligible-staff`,
    );
  }

  async getEmployeeRelationships(): Promise<unknown> {
    return this.request('/api/master/employee-relationships');
  }

  async checkRelationshipConflicts(
    employeeId: string,
    date: string,
  ): Promise<{ conflicts: unknown[] }> {
    return this.request('/api/master/check-relationship-conflicts', {
      method: 'POST',
      body: JSON.stringify({ employee_id: employeeId, date }),
    }) as Promise<{ conflicts: unknown[] }>;
  }

  async getGroupSchedule(
    groupId: string,
    { from, to }: { from?: string; to?: string } = {},
  ): Promise<unknown> {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const qs = params.toString();
    return this.request(
      `/api/groups/${encodeURIComponent(groupId)}/schedule${qs ? `?${qs}` : ''}`,
    );
  }

  async createGroupShift(
    groupId: string,
    data: Record<string, unknown>,
    { force = false } = {},
  ): Promise<unknown> {
    const qs = force ? '?force=1' : '';
    return this.request(
      `/api/groups/${encodeURIComponent(groupId)}/shifts${qs}`,
      { method: 'POST', body: JSON.stringify(data) },
    );
  }

  async updateGroupShift(
    groupId: string,
    shiftId: string,
    data: Record<string, unknown>,
    { force = false } = {},
  ): Promise<unknown> {
    const qs = force ? '?force=1' : '';
    return this.request(
      `/api/groups/${encodeURIComponent(groupId)}/shifts/${encodeURIComponent(shiftId)}${qs}`,
      { method: 'PATCH', body: JSON.stringify(data) },
    );
  }

  async deleteGroupShift(groupId: string, shiftId: string): Promise<unknown> {
    return this.request(
      `/api/groups/${encodeURIComponent(groupId)}/shifts/${encodeURIComponent(shiftId)}`,
      { method: 'DELETE' },
    );
  }

  async getGroupStats(
    groupId: string,
    { from, to }: { from?: string; to?: string } = {},
  ): Promise<unknown> {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const qs = params.toString();
    return this.request(
      `/api/groups/${encodeURIComponent(groupId)}/stats${qs ? `?${qs}` : ''}`,
    );
  }

  // ==================== Rotation Groups ====================

  async listRotationGroups(): Promise<unknown> {
    return this.request('/api/rotations');
  }

  async createRotationGroup(data: Record<string, unknown>): Promise<unknown> {
    return this.request('/api/rotations', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateRotationGroup(
    groupId: string,
    data: Record<string, unknown>,
  ): Promise<unknown> {
    return this.request(`/api/rotations/${encodeURIComponent(groupId)}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deleteRotationGroup(groupId: string): Promise<unknown> {
    return this.request(`/api/rotations/${encodeURIComponent(groupId)}`, {
      method: 'DELETE',
    });
  }

  async listRotationGroupMembers(groupId: string): Promise<unknown> {
    return this.request(
      `/api/rotations/${encodeURIComponent(groupId)}/members`,
    );
  }

  async addRotationGroupMember(
    groupId: string,
    tenantId: string,
    role: string,
  ): Promise<unknown> {
    return this.request(
      `/api/rotations/${encodeURIComponent(groupId)}/members`,
      { method: 'POST', body: JSON.stringify({ tenant_id: tenantId, role }) },
    );
  }

  async removeRotationGroupMember(
    groupId: string,
    tenantId: string,
  ): Promise<unknown> {
    return this.request(
      `/api/rotations/${encodeURIComponent(groupId)}/members/${encodeURIComponent(tenantId)}`,
      { method: 'DELETE' },
    );
  }

  async listRotationWorkplaces(groupId: string): Promise<unknown> {
    return this.request(
      `/api/rotations/${encodeURIComponent(groupId)}/workplaces`,
    );
  }

  async createRotationWorkplace(
    groupId: string,
    data: Record<string, unknown>,
  ): Promise<unknown> {
    return this.request(
      `/api/rotations/${encodeURIComponent(groupId)}/workplaces`,
      { method: 'POST', body: JSON.stringify(data) },
    );
  }

  async updateRotationWorkplace(
    groupId: string,
    workplaceId: string,
    data: Record<string, unknown>,
  ): Promise<unknown> {
    return this.request(
      `/api/rotations/${encodeURIComponent(groupId)}/workplaces/${encodeURIComponent(workplaceId)}`,
      { method: 'PATCH', body: JSON.stringify(data) },
    );
  }

  async deleteRotationWorkplace(
    groupId: string,
    workplaceId: string,
  ): Promise<unknown> {
    return this.request(
      `/api/rotations/${encodeURIComponent(groupId)}/workplaces/${encodeURIComponent(workplaceId)}`,
      { method: 'DELETE' },
    );
  }

  async listRotationTimeslots(
    groupId: string,
    workplaceId: string,
  ): Promise<unknown> {
    return this.request(
      `/api/rotations/${encodeURIComponent(groupId)}/workplaces/${encodeURIComponent(workplaceId)}/timeslots`,
    );
  }

  async createRotationTimeslot(
    groupId: string,
    workplaceId: string,
    data: Record<string, unknown>,
  ): Promise<unknown> {
    return this.request(
      `/api/rotations/${encodeURIComponent(groupId)}/workplaces/${encodeURIComponent(workplaceId)}/timeslots`,
      { method: 'POST', body: JSON.stringify(data) },
    );
  }

  async updateRotationTimeslot(
    groupId: string,
    workplaceId: string,
    timeslotId: string,
    data: Record<string, unknown>,
  ): Promise<unknown> {
    return this.request(
      `/api/rotations/${encodeURIComponent(groupId)}/workplaces/${encodeURIComponent(workplaceId)}/timeslots/${encodeURIComponent(timeslotId)}`,
      { method: 'PATCH', body: JSON.stringify(data) },
    );
  }

  async deleteRotationTimeslot(
    groupId: string,
    workplaceId: string,
    timeslotId: string,
  ): Promise<unknown> {
    return this.request(
      `/api/rotations/${encodeURIComponent(groupId)}/workplaces/${encodeURIComponent(workplaceId)}/timeslots/${encodeURIComponent(timeslotId)}`,
      { method: 'DELETE' },
    );
  }

  async getVisibleRotations({
    from,
    to,
  }: { from?: string; to?: string } = {}): Promise<unknown> {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const qs = params.toString();
    return this.request(
      `/api/rotations/visible-rotations${qs ? `?${qs}` : ''}`,
    );
  }

  async createRotationAssignment(
    groupId: string,
    data: Record<string, unknown>,
  ): Promise<unknown> {
    return this.request(
      `/api/rotations/${encodeURIComponent(groupId)}/assignments`,
      { method: 'POST', body: JSON.stringify(data) },
    );
  }

  async updateRotationAssignment(
    groupId: string,
    assignmentId: string,
    data: Record<string, unknown>,
  ): Promise<unknown> {
    return this.request(
      `/api/rotations/${encodeURIComponent(groupId)}/assignments/${encodeURIComponent(assignmentId)}`,
      { method: 'PATCH', body: JSON.stringify(data) },
    );
  }

  async deleteRotationAssignment(
    groupId: string,
    assignmentId: string,
  ): Promise<unknown> {
    return this.request(
      `/api/rotations/${encodeURIComponent(groupId)}/assignments/${encodeURIComponent(assignmentId)}`,
      { method: 'DELETE' },
    );
  }

  async getRotationDemands({
    from,
    to,
    status,
  }: { from?: string; to?: string; status?: string } = {}): Promise<unknown> {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (status) params.set('status', status);
    const qs = params.toString();
    return this.request(`/api/rotations/demands${qs ? `?${qs}` : ''}`);
  }

  async createRotationDemand(data: Record<string, unknown>): Promise<unknown> {
    return this.request('/api/rotations/demands', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateRotationDemand(
    id: string,
    data: Record<string, unknown>,
  ): Promise<unknown> {
    return this.request(`/api/rotations/demands/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  // ==================== Workplace Links (read-only cross-tenant staffing mirror) ====================

  async getVisibleWorkplaceLinks({
    from,
    to,
  }: { from?: string; to?: string } = {}): Promise<unknown> {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const qs = params.toString();
    return this.request(`/api/workplace-links/visible-links${qs ? `?${qs}` : ''}`);
  }

  async listWorkplaceLinkGroups(): Promise<unknown> {
    return this.request('/api/workplace-links');
  }

  async createWorkplaceLinkGroup(data: Record<string, unknown>): Promise<unknown> {
    return this.request('/api/workplace-links', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateWorkplaceLinkGroup(groupId: string, data: Record<string, unknown>): Promise<unknown> {
    return this.request(`/api/workplace-links/${encodeURIComponent(groupId)}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deleteWorkplaceLinkGroup(groupId: string): Promise<unknown> {
    return this.request(`/api/workplace-links/${encodeURIComponent(groupId)}`, {
      method: 'DELETE',
    });
  }

  async addWorkplaceLinkMember(
    groupId: string,
    tenantId: string,
    workplaceName: string,
  ): Promise<unknown> {
    return this.request(`/api/workplace-links/${encodeURIComponent(groupId)}/members`, {
      method: 'POST',
      body: JSON.stringify({ tenant_id: tenantId, workplace_name: workplaceName }),
    });
  }

  async removeWorkplaceLinkMember(groupId: string, memberId: string): Promise<unknown> {
    return this.request(
      `/api/workplace-links/${encodeURIComponent(groupId)}/members/${encodeURIComponent(memberId)}`,
      { method: 'DELETE' },
    );
  }

  async getTenantWorkplaceNames(tenantId: string): Promise<unknown> {
    return this.request(`/api/workplace-links/tenant-workplaces/${encodeURIComponent(tenantId)}`);
  }

  // ==================== Admin Users ====================

  async listUsers(): Promise<unknown> {
    return this.request('/api/auth/users');
  }

  async updateUser(userId: string, data: Record<string, unknown>): Promise<unknown> {
    return this.request(`/api/auth/users/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ data }),
    });
  }

  async deleteUser(userId: string): Promise<unknown> {
    return this.request(`/api/auth/users/${userId}`, { method: 'DELETE' });
  }

  async sendPasswordEmail(userId: string): Promise<unknown> {
    return this.request(`/api/auth/users/${userId}/reset-password`, {
      method: 'POST',
    });
  }

  async getEmailVerificationStatus(userId: string): Promise<unknown> {
    return this.request(`/api/auth/email-verification-status/${userId}`);
  }

  // ==================== Database CRUD ====================

  async dbAction(
    action: string,
    table: string,
    params: Record<string, unknown> = {},
  ): Promise<unknown> {
    return this.request('/api/db', {
      method: 'POST',
      body: JSON.stringify({ action, table, ...params }),
    });
  }

  async list(table: string, options: Record<string, unknown> = {}): Promise<unknown> {
    return this.dbAction('list', table, options);
  }

  async filter(
    table: string,
    query: Record<string, unknown>,
    options: Record<string, unknown> = {},
  ): Promise<unknown> {
    return this.dbAction('filter', table, { query, ...options });
  }

  async get(table: string, id: string): Promise<unknown> {
    return this.dbAction('get', table, { id });
  }

  async create(table: string, data: Record<string, unknown>): Promise<unknown> {
    return this.dbAction('create', table, { data });
  }

  async update(
    table: string,
    id: string,
    data: Record<string, unknown>,
  ): Promise<unknown> {
    return this.dbAction('update', table, { id, data });
  }

  async delete(table: string, id: string): Promise<unknown> {
    return this.dbAction('delete', table, { id });
  }

  async bulkCreate(
    table: string,
    dataArray: Record<string, unknown>[],
  ): Promise<unknown> {
    return this.dbAction('bulkCreate', table, { data: dataArray });
  }

  // ==================== Schedule ====================

  async getSchedule(year: number, month: number): Promise<unknown> {
    return this.request(`/api/schedule/${year}/${month}`);
  }

  async updateSchedule(
    year: number,
    month: number,
    entries: unknown[],
  ): Promise<unknown> {
    return this.request(`/api/schedule/${year}/${month}`, {
      method: 'POST',
      body: JSON.stringify({ entries }),
    });
  }

  async exportScheduleToExcel(
    startDate: string,
    endDate: string,
    hiddenRows: string[] = [],
  ): Promise<unknown> {
    return this.request('/api/schedule/export', {
      method: 'POST',
      body: JSON.stringify({ startDate, endDate, hiddenRows }),
    });
  }

  // ==================== Holidays ====================

  async getHolidays(year: number, state = 'NW'): Promise<unknown> {
    return this.request(`/api/holidays?year=${year}&state=${state}`);
  }

  // ==================== Certificates ====================

  async listCertificates(
    params: { doctor_id?: string; qualification_id?: string } = {},
  ): Promise<unknown> {
    const search = new URLSearchParams();
    if (params.doctor_id) search.set('doctor_id', params.doctor_id);
    if (params.qualification_id)
      search.set('qualification_id', params.qualification_id);
    const qs = search.toString();
    return this.request(`/api/certificates${qs ? `?${qs}` : ''}`);
  }

  async listExpiringCertificates(days = 60): Promise<unknown> {
    return this.request(`/api/certificates/expiring?days=${encodeURIComponent(days)}`);
  }

  async checkCertificate({
    file,
    qualification_name,
    qualification_description,
  }: {
    file: File;
    qualification_name: string;
    qualification_description?: string;
  }): Promise<unknown> {
    if (!file) throw new Error('Datei fehlt');
    if (!qualification_name) throw new Error('qualification_name fehlt');

    const formData = new FormData();
    formData.append('file', file);
    formData.append('qualification_name', qualification_name);
    if (qualification_description)
      formData.append('qualification_description', qualification_description);

    const token = this.getToken();
    const dbToken = this.getDbToken();
    const headers: Record<string, string> = {
      ...(token && { Authorization: `Bearer ${token}` }),
      ...(dbToken && { 'X-DB-Token': dbToken }),
    };

    const response = await fetch(`${this.baseURL}/api/certificates/check`, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.error || `Prüfung fehlgeschlagen (HTTP ${response.status})`,
      );
    }
    return response.json();
  }

  async uploadCertificate({
    file,
    doctor_id,
    qualification_id,
    doctor_qualification_id,
    granted_date,
    expiry_date,
    notes,
    evidence_role,
    qualification_name,
    qualification_description,
    approval_token,
  }: CertificateUploadParams): Promise<unknown> {
    if (!file) throw new Error('Datei fehlt');
    const formData = new FormData();
    formData.append('file', file);
    formData.append('doctor_id', doctor_id);
    if (qualification_id) formData.append('qualification_id', qualification_id);
    if (doctor_qualification_id)
      formData.append('doctor_qualification_id', doctor_qualification_id);
    if (granted_date) formData.append('granted_date', granted_date);
    if (expiry_date) formData.append('expiry_date', expiry_date);
    if (notes) formData.append('notes', notes);
    if (evidence_role) formData.append('evidence_role', evidence_role);
    if (qualification_name)
      formData.append('qualification_name', qualification_name);
    if (qualification_description)
      formData.append('qualification_description', qualification_description);
    if (approval_token) formData.append('approval_token', approval_token);

    const token = this.getToken();
    const dbToken = this.getDbToken();
    const headers: Record<string, string> = {
      ...(token && { Authorization: `Bearer ${token}` }),
      ...(dbToken && { 'X-DB-Token': dbToken }),
    };

    const response = await fetch(`${this.baseURL}/api/certificates/upload`, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.error || `Upload fehlgeschlagen (HTTP ${response.status})`,
      );
    }
    return response.json();
  }

  async updateCertificate(
    id: string,
    {
      granted_date,
      expiry_date,
      notes,
      evidence_role,
    }: {
      granted_date?: string;
      expiry_date?: string;
      notes?: string;
      evidence_role?: string;
    } = {},
  ): Promise<unknown> {
    return this.request(`/api/certificates/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ granted_date, expiry_date, notes, evidence_role }),
    });
  }

  async deleteCertificate(id: string): Promise<unknown> {
    return this.request(`/api/certificates/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  async reanalyzeCertificate(
    id: string,
    {
      qualification_name,
      qualification_description,
    }: { qualification_name?: string; qualification_description?: string } = {},
  ): Promise<unknown> {
    return this.request(`/api/certificates/${encodeURIComponent(id)}/analyze`, {
      method: 'POST',
      body: JSON.stringify({ qualification_name, qualification_description }),
    });
  }

  async fetchCertificateBlob(id: string): Promise<Blob> {
    const token = this.getToken();
    const dbToken = this.getDbToken();
    const headers: Record<string, string> = {
      ...(token && { Authorization: `Bearer ${token}` }),
      ...(dbToken && { 'X-DB-Token': dbToken }),
    };
    const response = await fetch(
      `${this.baseURL}/api/certificates/${encodeURIComponent(id)}/download`,
      { headers },
    );
    if (!response.ok) {
      throw new Error(`Download fehlgeschlagen (HTTP ${response.status})`);
    }
    return response.blob();
  }

  async sendCertificateReminderEmails(recipients: unknown[]): Promise<unknown> {
    return this.request('/api/certificates/reminders/send', {
      method: 'POST',
      body: JSON.stringify({ recipients }),
    });
  }

  // ==================== Staff ====================

  async notifyStaff(params: Record<string, unknown>): Promise<unknown> {
    return this.request('/api/staff/notify', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  async sendScheduleNotifications(
    year: number,
    month: number,
  ): Promise<unknown> {
    return this.request('/api/staff/schedule-notifications', {
      method: 'POST',
      body: JSON.stringify({ year, month }),
    });
  }

  async sendShiftNotification(shiftData: Record<string, unknown>): Promise<unknown> {
    return this.request('/api/staff/shift-notification', {
      method: 'POST',
      body: JSON.stringify(shiftData),
    });
  }

  // ==================== Calendar ====================

  async syncCalendar(year: number, month: number): Promise<unknown> {
    return this.request('/api/calendar/sync', {
      method: 'POST',
      body: JSON.stringify({ year, month }),
    });
  }

  async getServiceAccountEmail(): Promise<unknown> {
    return this.request('/api/calendar/service-account-email');
  }

  // ==================== Voice (unused / planned) ====================

  async processVoiceCommand(command: string): Promise<unknown> {
    return this.request('/api/voice/process', {
      method: 'POST',
      body: JSON.stringify({ command }),
    });
  }

  async transcribeAudio(audioBlob: Blob): Promise<unknown> {
    const formData = new FormData();
    formData.append('audio', audioBlob);

    const token = this.getToken();
    const headers: Record<string, string> = token
      ? { Authorization: `Bearer ${token}` }
      : {};

    const response = await fetch(`${this.baseURL}/api/voice/transcribe`, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (!response.ok) {
      throw new Error('Transcription failed');
    }

    return response.json();
  }

  // ==================== Admin ====================

  async getDatabaseStats(): Promise<unknown> {
    return this.request('/api/admin/stats');
  }

  async optimizeDatabase(): Promise<unknown> {
    return this.request('/api/admin/optimize', { method: 'POST' });
  }

  async getLogs(limit = 100): Promise<unknown> {
    return this.request(`/api/admin/logs?limit=${limit}`);
  }

  async renamePosition(oldName: string, newName: string): Promise<unknown> {
    return this.request('/api/admin/rename-position', {
      method: 'POST',
      body: JSON.stringify({ oldName, newName }),
    });
  }

  async adminTools(
    action: string,
    data: Record<string, unknown> = {},
  ): Promise<unknown> {
    return this.request('/api/admin/tools', {
      method: 'POST',
      body: JSON.stringify({ action, data }),
    });
  }

  // ==================== Atomic Operations ====================

  async atomicOperation(
    operation: string,
    entity: string,
    params: Record<string, unknown> = {},
  ): Promise<unknown> {
    return this.request('/api/atomic', {
      method: 'POST',
      body: JSON.stringify({ operation, entity, ...params }),
    });
  }

  async checkAndUpdate(
    entity: string,
    id: string,
    data: Record<string, unknown>,
    check: Record<string, unknown>,
  ): Promise<unknown> {
    return this.atomicOperation('checkAndUpdate', entity, { id, data, check });
  }

  async checkAndCreate(
    entity: string,
    data: Record<string, unknown>,
    check: Record<string, unknown>,
  ): Promise<unknown> {
    return this.atomicOperation('checkAndCreate', entity, { data, check });
  }

  async upsertStaffing(data: Record<string, unknown>): Promise<unknown> {
    return this.atomicOperation('upsertStaffing', 'StaffingPlanEntry', { data });
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

export const api = new APIClient();

// ─── Entity Client (compatibility wrapper) ───────────────────────────────────

export class EntityClient {
  entityName: string;

  constructor(entityName: string) {
    this.entityName = entityName;
  }

  async list(options: Record<string, any> = {}): Promise<any> {
    return api.list(this.entityName, options);
  }

  async filter(
    query: Record<string, any>,
    options: Record<string, any> = {},
  ): Promise<any> {
    return api.filter(this.entityName, query, options);
  }

  async get(id: string): Promise<any> {
    return api.get(this.entityName, id);
  }

  async create(data: Record<string, any>): Promise<any> {
    return api.create(this.entityName, data);
  }

  async update(id: string, data: Record<string, any>): Promise<any> {
    return api.update(this.entityName, id, data);
  }

  async delete(id: string): Promise<any> {
    return api.delete(this.entityName, id);
  }

  async bulkCreate(dataArray: Record<string, any>[]): Promise<any> {
    return api.bulkCreate(this.entityName, dataArray);
  }
}

// ─── Named Entity Clients ────────────────────────────────────────────────────

export const db = {
  Doctor: new EntityClient('Doctor'),
  ShiftEntry: new EntityClient('ShiftEntry'),
  WishRequest: new EntityClient('WishRequest'),
  Workplace: new EntityClient('Workplace'),
  WorkplaceTimeslot: new EntityClient('WorkplaceTimeslot'),
  TimeslotTemplate: new EntityClient('TimeslotTemplate'),
  ShiftNotification: new EntityClient('ShiftNotification'),
  DemoSetting: new EntityClient('DemoSetting'),
  TrainingRotation: new EntityClient('TrainingRotation'),
  ScheduleRule: new EntityClient('ScheduleRule'),
  ColorSetting: new EntityClient('ColorSetting'),
  ScheduleNote: new EntityClient('ScheduleNote'),
  SystemSetting: new EntityClient('SystemSetting'),
  CustomHoliday: new EntityClient('CustomHoliday'),
  StaffingPlanEntry: new EntityClient('StaffingPlanEntry'),
  StaffingPlanNote: new EntityClient('StaffingPlanNote'),
  BackupLog: new EntityClient('BackupLog'),
  SystemLog: new EntityClient('SystemLog'),
  VoiceAlias: new EntityClient('VoiceAlias'),
  User: new EntityClient('User'),
  TeamRole: new EntityClient('TeamRole'),
  Qualification: new EntityClient('Qualification'),
  DoctorQualification: new EntityClient('DoctorQualification'),
  WorkplaceQualification: new EntityClient('WorkplaceQualification'),
  ShiftTimeRule: new EntityClient('ShiftTimeRule'),
  ScheduleBlock: new EntityClient('ScheduleBlock'),

  collection: (name: string) => new EntityClient(name),
};

// ─── Base44 Compatibility Layer ──────────────────────────────────────────────

/**
 * Base44-Kompatibilitätsschicht für base44.functions.invoke().
 * Wird schrittweise durch direkte API-Aufrufe ersetzt.
 *
 * @deprecated Migrate consumers to direct `api.*` calls.
 */
export const base44 = {
  entities: db,

  functions: {
    invoke: async (
      functionName: string,
      params: Record<string, unknown>,
    ): Promise<unknown> => {
      console.warn(
        `[Deprecated] base44.functions.invoke('${functionName}') - migrate to direct API calls`,
      );

      switch (functionName) {
        case 'getHolidays':
          return {
            data: await api.getHolidays(
              params.year as number,
              (params.stateCode as string) || 'NW',
            ),
          };
        // Add more mappings as needed
        default:
          throw new Error(`Unknown Base44 function: ${functionName}`);
      }
    },
  },

  auth: db,
};
