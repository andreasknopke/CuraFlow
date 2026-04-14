type RequestOptions = RequestInit & { headers?: Record<string, string> };

export interface APIClientMethods {
  login(email: string, password: string): Promise<unknown>;
  register(userData: Record<string, unknown>): Promise<unknown>;
  me(): Promise<unknown>;
  updatePresence(): Promise<unknown>;
  getJitsiToken(): Promise<unknown>;
  listCoworkContacts(): Promise<unknown>;
  listCoworkInvites(): Promise<unknown>;
  sendCoworkInvite(inviteeUserId: string): Promise<unknown>;
  declineCoworkInvite(inviteId: string): Promise<unknown>;
  cancelCoworkInvite(inviteId: string): Promise<unknown>;
  joinCoworkInvite(inviteId: string): Promise<unknown>;
  updateMe(updates: Record<string, unknown>): Promise<unknown>;
  changePassword(currentPassword: string, newPassword: string): Promise<unknown>;
  forceChangePassword(newPassword: string): Promise<unknown>;
  changeEmail(newEmail: string, password: string): Promise<unknown>;
  logout(): Promise<{ success: boolean }>;
  verify(): Promise<boolean>;
  getMyTenants(): Promise<unknown>;
  activateTenant(tokenId: string): Promise<unknown>;
  listUsers(): Promise<unknown>;
  updateUser(userId: string, data: Record<string, unknown>): Promise<unknown>;
  deleteUser(userId: string): Promise<unknown>;
  sendPasswordEmail(userId: string): Promise<unknown>;
  getEmailVerificationStatus(userId: string): Promise<unknown>;
  dbAction(action: string, table: string, params?: Record<string, unknown>): Promise<unknown>;
  list(table: string, options?: Record<string, unknown>): Promise<unknown>;
  filter(table: string, query: unknown, options?: Record<string, unknown>): Promise<unknown>;
  get(table: string, id: string | number): Promise<unknown>;
  create(table: string, data: Record<string, unknown>): Promise<unknown>;
  update(table: string, id: string | number, data: Record<string, unknown>): Promise<unknown>;
  delete(table: string, id: string | number): Promise<unknown>;
  bulkCreate(table: string, dataArray: Record<string, unknown>[]): Promise<unknown>;
  getSchedule(year: number, month: number): Promise<unknown>;
  updateSchedule(year: number, month: number, entries: unknown[]): Promise<unknown>;
  exportScheduleToExcel(
    startDate: string,
    endDate: string,
    hiddenRows?: string[],
  ): Promise<unknown>;
  getHolidays(year: number, state?: string): Promise<unknown>;
  notifyStaff(params: Record<string, unknown>): Promise<unknown>;
  sendEmail(params: { to: string; subject: string; body: string; html?: string }): Promise<unknown>;
  sendScheduleNotifications(year: number, month: number): Promise<unknown>;
  sendShiftNotification(shiftData: Record<string, unknown>): Promise<unknown>;
  syncCalendar(year: number, month: number): Promise<unknown>;
  getServiceAccountEmail(): Promise<unknown>;
  processVoiceCommand(command: string): Promise<unknown>;
  transcribeAudio(audioBlob: Blob): Promise<unknown>;
  getDatabaseStats(): Promise<unknown>;
  optimizeDatabase(): Promise<unknown>;
  getLogs(limit?: number): Promise<unknown>;
  renamePosition(oldName: string, newName: string): Promise<unknown>;
  adminTools(action: string, data?: Record<string, unknown>): Promise<unknown>;
  atomicOperation(
    operation: string,
    entity: string,
    params?: Record<string, unknown>,
  ): Promise<unknown>;
  checkAndUpdate(
    entity: string,
    id: string | number,
    data: Record<string, unknown>,
    check: Record<string, unknown>,
  ): Promise<unknown>;
  checkAndCreate(
    entity: string,
    data: Record<string, unknown>,
    check: Record<string, unknown>,
  ): Promise<unknown>;
  upsertStaffing(data: Record<string, unknown>): Promise<unknown>;
}

interface APIClientCore {
  baseURL: string;
  request(
    endpoint: string,
    options?: RequestOptions,
    internal?: { allowRefresh: boolean },
  ): Promise<any>;
  getToken(): string | null;
  setToken(token: string | null): void;
  setRefreshToken(refreshToken: string | null): void;
  clearAuthTokens(): void;
}

interface APIClientCtor {
  prototype: APIClientCore & APIClientMethods;
}

export function registerAPIClientMethods(APIClientClass: APIClientCtor): void {
  Object.assign(APIClientClass.prototype, {
    async login(this: APIClientCore, email: string, password: string): Promise<unknown> {
      const data = await this.request('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      if (data.token) {
        this.setToken(data.token);
      }
      if (data.refreshToken) {
        this.setRefreshToken(data.refreshToken);
      }
      return data;
    },

    async register(this: APIClientCore, userData: Record<string, unknown>): Promise<unknown> {
      return this.request('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify(userData),
      });
    },

    async me(this: APIClientCore): Promise<unknown> {
      return this.request('/api/auth/me');
    },

    async updatePresence(this: APIClientCore): Promise<unknown> {
      return this.request('/api/auth/presence', {
        method: 'POST',
      });
    },

    async getJitsiToken(this: APIClientCore): Promise<unknown> {
      return this.request('/api/auth/jitsi-token');
    },

    async listCoworkContacts(this: APIClientCore): Promise<unknown> {
      return this.request(`/api/auth/cowork/contacts?_=${Date.now()}`, {
        cache: 'no-store',
      });
    },

    async listCoworkInvites(this: APIClientCore): Promise<unknown> {
      return this.request(`/api/auth/cowork/invites?_=${Date.now()}`, {
        cache: 'no-store',
      });
    },

    async sendCoworkInvite(this: APIClientCore, inviteeUserId: string): Promise<unknown> {
      return this.request('/api/auth/cowork/invites', {
        method: 'POST',
        body: JSON.stringify({ inviteeUserId }),
      });
    },

    async declineCoworkInvite(this: APIClientCore, inviteId: string): Promise<unknown> {
      return this.request(`/api/auth/cowork/invites/${inviteId}/decline`, {
        method: 'POST',
      });
    },

    async cancelCoworkInvite(this: APIClientCore, inviteId: string): Promise<unknown> {
      return this.request(`/api/auth/cowork/invites/${inviteId}/cancel`, {
        method: 'POST',
      });
    },

    async joinCoworkInvite(this: APIClientCore, inviteId: string): Promise<unknown> {
      return this.request(`/api/auth/cowork/session/${inviteId}`, {
        method: 'POST',
      });
    },

    async updateMe(this: APIClientCore, updates: Record<string, unknown>): Promise<unknown> {
      return this.request('/api/auth/me', {
        method: 'PATCH',
        body: JSON.stringify(updates),
      });
    },

    async changePassword(
      this: APIClientCore,
      currentPassword: string,
      newPassword: string,
    ): Promise<unknown> {
      return this.request('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
    },

    async forceChangePassword(this: APIClientCore, newPassword: string): Promise<unknown> {
      return this.request('/api/auth/force-change-password', {
        method: 'POST',
        body: JSON.stringify({ newPassword }),
      });
    },

    async changeEmail(this: APIClientCore, newEmail: string, password: string): Promise<unknown> {
      return this.request('/api/auth/change-email', {
        method: 'POST',
        body: JSON.stringify({ newEmail, password }),
      });
    },

    async logout(this: APIClientCore): Promise<{ success: boolean }> {
      this.clearAuthTokens();
      return { success: true };
    },

    async verify(this: APIClientCore): Promise<boolean> {
      try {
        await this.request('/api/auth/me');
        return true;
      } catch {
        return false;
      }
    },

    async getMyTenants(this: APIClientCore): Promise<unknown> {
      return this.request('/api/auth/my-tenants');
    },

    async activateTenant(this: APIClientCore, tokenId: string): Promise<unknown> {
      return this.request(`/api/auth/activate-tenant/${tokenId}`, {
        method: 'POST',
      });
    },

    async listUsers(this: APIClientCore): Promise<unknown> {
      return this.request('/api/auth/users');
    },

    async updateUser(
      this: APIClientCore,
      userId: string,
      data: Record<string, unknown>,
    ): Promise<unknown> {
      return this.request(`/api/auth/users/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ data }),
      });
    },

    async deleteUser(this: APIClientCore, userId: string): Promise<unknown> {
      return this.request(`/api/auth/users/${userId}`, {
        method: 'DELETE',
      });
    },

    async sendPasswordEmail(this: APIClientCore, userId: string): Promise<unknown> {
      return this.request('/api/auth/send-password-email', {
        method: 'POST',
        body: JSON.stringify({ userId }),
      });
    },

    async getEmailVerificationStatus(this: APIClientCore, userId: string): Promise<unknown> {
      return this.request(`/api/auth/email-verification-status/${userId}`);
    },

    async dbAction(
      this: APIClientCore,
      action: string,
      table: string,
      params: Record<string, unknown> = {},
    ): Promise<unknown> {
      return this.request('/api/db', {
        method: 'POST',
        body: JSON.stringify({ action, table, ...params }),
      });
    },

    async list(
      this: APIClientCore & APIClientMethods,
      table: string,
      options: Record<string, unknown> = {},
    ): Promise<unknown> {
      return this.dbAction('list', table, options);
    },

    async filter(
      this: APIClientCore & APIClientMethods,
      table: string,
      query: unknown,
      options: Record<string, unknown> = {},
    ): Promise<unknown> {
      return this.dbAction('filter', table, { query, ...options });
    },

    async get(
      this: APIClientCore & APIClientMethods,
      table: string,
      id: string | number,
    ): Promise<unknown> {
      return this.dbAction('get', table, { id });
    },

    async create(
      this: APIClientCore & APIClientMethods,
      table: string,
      data: Record<string, unknown>,
    ): Promise<unknown> {
      return this.dbAction('create', table, { data });
    },

    async update(
      this: APIClientCore & APIClientMethods,
      table: string,
      id: string | number,
      data: Record<string, unknown>,
    ): Promise<unknown> {
      return this.dbAction('update', table, { id, data });
    },

    async delete(
      this: APIClientCore & APIClientMethods,
      table: string,
      id: string | number,
    ): Promise<unknown> {
      return this.dbAction('delete', table, { id });
    },

    async bulkCreate(
      this: APIClientCore & APIClientMethods,
      table: string,
      dataArray: Record<string, unknown>[],
    ): Promise<unknown> {
      return this.dbAction('bulkCreate', table, { data: dataArray });
    },

    async getSchedule(this: APIClientCore, year: number, month: number): Promise<unknown> {
      return this.request(`/api/schedule/${year}/${month}`);
    },

    async updateSchedule(
      this: APIClientCore,
      year: number,
      month: number,
      entries: unknown[],
    ): Promise<unknown> {
      return this.request(`/api/schedule/${year}/${month}`, {
        method: 'POST',
        body: JSON.stringify({ entries }),
      });
    },

    async exportScheduleToExcel(
      this: APIClientCore,
      startDate: string,
      endDate: string,
      hiddenRows: string[] = [],
    ): Promise<unknown> {
      return this.request('/api/schedule/export', {
        method: 'POST',
        body: JSON.stringify({ startDate, endDate, hiddenRows }),
      });
    },

    async getHolidays(this: APIClientCore, year: number, state: string = 'NW'): Promise<unknown> {
      return this.request(`/api/holidays?year=${year}&state=${state}`);
    },

    async notifyStaff(this: APIClientCore, params: Record<string, unknown>): Promise<unknown> {
      return this.request('/api/staff/notify', {
        method: 'POST',
        body: JSON.stringify(params),
      });
    },

    async sendEmail(
      this: APIClientCore,
      params: {
        to: string;
        subject: string;
        body: string;
        html?: string;
      },
    ): Promise<unknown> {
      return this.request('/api/staff/send-email', {
        method: 'POST',
        body: JSON.stringify(params),
      });
    },

    async sendScheduleNotifications(
      this: APIClientCore,
      year: number,
      month: number,
    ): Promise<unknown> {
      return this.request('/api/staff/schedule-notifications', {
        method: 'POST',
        body: JSON.stringify({ year, month }),
      });
    },

    async sendShiftNotification(
      this: APIClientCore,
      shiftData: Record<string, unknown>,
    ): Promise<unknown> {
      return this.request('/api/staff/shift-notification', {
        method: 'POST',
        body: JSON.stringify(shiftData),
      });
    },

    async syncCalendar(this: APIClientCore, year: number, month: number): Promise<unknown> {
      return this.request('/api/calendar/sync', {
        method: 'POST',
        body: JSON.stringify({ year, month }),
      });
    },

    async getServiceAccountEmail(this: APIClientCore): Promise<unknown> {
      return this.request('/api/calendar/service-account-email');
    },

    async processVoiceCommand(this: APIClientCore, command: string): Promise<unknown> {
      return this.request('/api/voice/process', {
        method: 'POST',
        body: JSON.stringify({ command }),
      });
    },

    async transcribeAudio(this: APIClientCore, audioBlob: Blob): Promise<string> {
      const formData = new FormData();
      formData.append('audio', audioBlob);

      const token = this.getToken();
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

      const response = await fetch(`${this.baseURL}/api/voice/transcribe`, {
        method: 'POST',
        headers,
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Transcription failed');
      }

      const data = await response.json();
      return data?.transcript || data?.text || '';
    },

    async getDatabaseStats(this: APIClientCore): Promise<unknown> {
      return this.request('/api/admin/stats');
    },

    async optimizeDatabase(this: APIClientCore): Promise<unknown> {
      return this.request('/api/admin/optimize', {
        method: 'POST',
      });
    },

    async getLogs(this: APIClientCore, limit: number = 100): Promise<unknown> {
      return this.request(`/api/admin/logs?limit=${limit}`);
    },

    async renamePosition(this: APIClientCore, oldName: string, newName: string): Promise<unknown> {
      return this.request('/api/admin/rename-position', {
        method: 'POST',
        body: JSON.stringify({ oldName, newName }),
      });
    },

    async adminTools(
      this: APIClientCore,
      action: string,
      data: Record<string, unknown> = {},
    ): Promise<unknown> {
      return this.request('/api/admin/tools', {
        method: 'POST',
        body: JSON.stringify({ action, data }),
      });
    },

    async atomicOperation(
      this: APIClientCore,
      operation: string,
      entity: string,
      params: Record<string, unknown> = {},
    ): Promise<unknown> {
      return this.request('/api/atomic', {
        method: 'POST',
        body: JSON.stringify({ operation, entity, ...params }),
      });
    },

    async checkAndUpdate(
      this: APIClientCore & APIClientMethods,
      entity: string,
      id: string | number,
      data: Record<string, unknown>,
      check: Record<string, unknown>,
    ): Promise<unknown> {
      return this.atomicOperation('checkAndUpdate', entity, { id, data, check });
    },

    async checkAndCreate(
      this: APIClientCore & APIClientMethods,
      entity: string,
      data: Record<string, unknown>,
      check: Record<string, unknown>,
    ): Promise<unknown> {
      return this.atomicOperation('checkAndCreate', entity, { data, check });
    },

    async upsertStaffing(
      this: APIClientCore & APIClientMethods,
      data: Record<string, unknown>,
    ): Promise<unknown> {
      return this.atomicOperation('upsertStaffing', 'StaffingPlanEntry', { data });
    },
  });
}
