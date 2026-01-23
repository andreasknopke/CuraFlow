/**
 * Einfacher API Client für Railway Backend
 * Kommuniziert direkt mit Express API über MySQL
 */

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const TOKEN_KEY = 'radioplan_jwt_token';

class APIClient {
  constructor() {
    this.baseURL = API_URL;
  }

  getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }

  setToken(token) {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  }

  async request(endpoint, options = {}) {
    const token = this.getToken();
    const headers = {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
      ...options.headers,
    };

    const config = {
      ...options,
      headers,
    };

    const url = `${this.baseURL}${endpoint}`;
    const response = await fetch(url, config);

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(error.error || error.message || `HTTP ${response.status}`);
    }

    return response.json();
  }

  // ==================== Auth ====================

  async login(email, password) {
    const data = await this.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    if (data.token) {
      this.setToken(data.token);
    }
    return data;
  }

  async register(userData) {
    return this.request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(userData),
    });
  }

  async me() {
    return this.request('/api/auth/me');
  }

  async updateMe(updates) {
    return this.request('/api/auth/me', {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  }

  async changePassword(currentPassword, newPassword) {
    return this.request('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  }

  async changeEmail(newEmail, password) {
    return this.request('/api/auth/change-email', {
      method: 'POST',
      body: JSON.stringify({ newEmail, password }),
    });
  }

  async logout() {
    this.setToken(null);
    return { success: true };
  }

  async verify() {
    try {
      await this.me();
      return true;
    } catch {
      return false;
    }
  }

  // ==================== Admin User Management ====================

  async listUsers() {
    return this.request('/api/auth/users');
  }

  async updateUser(userId, data) {
    return this.request(`/api/auth/users/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ data }),
    });
  }

  async deleteUser(userId) {
    return this.request(`/api/auth/users/${userId}`, {
      method: 'DELETE',
    });
  }

  // ==================== Database Operations ====================

  async dbAction(action, table, params = {}) {
    return this.request('/api/db', {
      method: 'POST',
      body: JSON.stringify({ action, table, ...params }),
    });
  }

  async list(table, options = {}) {
    return this.dbAction('list', table, options);
  }

  async filter(table, query, options = {}) {
    return this.dbAction('filter', table, { query, ...options });
  }

  async get(table, id) {
    return this.dbAction('get', table, { id });
  }

  async create(table, data) {
    return this.dbAction('create', table, { data });
  }

  async update(table, id, data) {
    return this.dbAction('update', table, { id, data });
  }

  async delete(table, id) {
    return this.dbAction('delete', table, { id });
  }

  async bulkCreate(table, dataArray) {
    return this.dbAction('bulkCreate', table, { data: dataArray });
  }

  // ==================== Schedule ====================

  async getSchedule(year, month) {
    return this.request(`/api/schedule/${year}/${month}`);
  }

  async updateSchedule(year, month, entries) {
    return this.request(`/api/schedule/${year}/${month}`, {
      method: 'POST',
      body: JSON.stringify({ entries }),
    });
  }

  async exportScheduleToExcel(year, month) {
    const token = this.getToken();
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    
    const response = await fetch(
      `${this.baseURL}/api/schedule/${year}/${month}/export`,
      { headers }
    );

    if (!response.ok) {
      throw new Error('Export failed');
    }

    return response.blob();
  }

  // ==================== Holidays ====================

  async getHolidays(year, state = 'NW') {
    return this.request(`/api/holidays?year=${year}&state=${state}`);
  }

  // ==================== Staff ====================

  async notifyStaff(params) {
    return this.request('/api/staff/notify', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  async sendScheduleNotifications(year, month) {
    return this.request('/api/staff/schedule-notifications', {
      method: 'POST',
      body: JSON.stringify({ year, month }),
    });
  }

  async sendShiftNotification(shiftData) {
    return this.request('/api/staff/shift-notification', {
      method: 'POST',
      body: JSON.stringify(shiftData),
    });
  }

  // ==================== Calendar ====================

  async syncCalendar(year, month) {
    return this.request('/api/calendar/sync', {
      method: 'POST',
      body: JSON.stringify({ year, month }),
    });
  }

  async getServiceAccountEmail() {
    return this.request('/api/calendar/service-account-email');
  }

  // ==================== Voice ====================

  async processVoiceCommand(command) {
    return this.request('/api/voice/process', {
      method: 'POST',
      body: JSON.stringify({ command }),
    });
  }

  async transcribeAudio(audioBlob) {
    const formData = new FormData();
    formData.append('audio', audioBlob);

    const token = this.getToken();
    const headers = token ? { Authorization: `Bearer ${token}` } : {};

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

  async getDatabaseStats() {
    return this.request('/api/admin/stats');
  }

  async optimizeDatabase() {
    return this.request('/api/admin/optimize', {
      method: 'POST',
    });
  }

  async getLogs(limit = 100) {
    return this.request(`/api/admin/logs?limit=${limit}`);
  }
}

// Singleton Instance
export const api = new APIClient();

// Entity-spezifische Wrapper für Kompatibilität
export class EntityClient {
  constructor(entityName) {
    this.entityName = entityName;
  }

  async list(options = {}) {
    return api.list(this.entityName, options);
  }

  async filter(query, options = {}) {
    return api.filter(this.entityName, query, options);
  }

  async get(id) {
    return api.get(this.entityName, id);
  }

  async create(data) {
    return api.create(this.entityName, data);
  }

  async update(id, data) {
    return api.update(this.entityName, id, data);
  }

  async delete(id) {
    return api.delete(this.entityName, id);
  }

  async bulkCreate(dataArray) {
    return api.bulkCreate(this.entityName, dataArray);
  }
}

// Database Collections - für Abwärtskompatibilität
export const db = {
  Doctor: new EntityClient('Doctor'),
  ShiftEntry: new EntityClient('ShiftEntry'),
  WishRequest: new EntityClient('WishRequest'),
  Workplace: new EntityClient('Workplace'),
  ShiftNotification: new EntityClient('ShiftNotification'),
  DemoSetting: new EntityClient('DemoSetting'),
  TrainingRotation: new EntityClient('TrainingRotation'),
  ScheduleRule: new EntityClient('ScheduleRule'),
  ColorSetting: new EntityClient('ColorSetting'),
  ScheduleNote: new EntityClient('ScheduleNote'),
  SystemSetting: new EntityClient('SystemSetting'),
  CustomHoliday: new EntityClient('CustomHoliday'),
  StaffingPlanEntry: new EntityClient('StaffingPlanEntry'),
  BackupLog: new EntityClient('BackupLog'),
  SystemLog: new EntityClient('SystemLog'),
  VoiceAlias: new EntityClient('VoiceAlias'),
  User: new EntityClient('User'),
  
  collection: (name) => new EntityClient(name)
};

// Base44-Kompatibilitätsschicht für base44.functions.invoke()
// Wird schrittweise durch direkte API-Aufrufe ersetzt
export const base44 = {
  functions: {
    invoke: async (functionName, params) => {
      console.warn(`[Deprecated] base44.functions.invoke('${functionName}') - migrate to direct API calls`);
      
      // Map alte Base44-Funktionen zu neuen API-Endpunkten
      switch (functionName) {
        case 'getHolidays':
          return { data: await api.getHolidays(params.year, params.stateCode) };
        
        case 'transcribeAudio':
          return { data: { text: await api.transcribeAudio(params.audioBlob) } };
        
        case 'processVoiceAudio':
          return { data: await api.processVoiceCommand(params.text) };
        
        case 'exportScheduleToExcel':
          return { data: await api.exportScheduleToExcel(params.year, params.month) };
        
        case 'sendShiftEmails':
        case 'sendScheduleNotifications':
          return { data: await api.sendScheduleNotifications(params.year, params.month) };
        
        case 'sendShiftNotification':
          return { data: await api.sendShiftNotification(params) };
        
        case 'syncCalendar':
          return { data: await api.syncCalendar(params.year, params.month) };
        
        case 'getServiceAccountEmail':
          return { data: await api.getServiceAccountEmail() };
        
        case 'notifyStaff':
          return { data: await api.notifyStaff(params) };
        
        case 'auth':
          // Auth-Funktionen direkt ausführen
          switch (params.action) {
            case 'login':
              return { data: await api.login(params.email, params.password) };
            case 'me':
              return { data: await api.me() };
            case 'updateMe':
              return { data: await api.updateMe(params.data) };
            case 'register':
              return { data: await api.register(params) };
            default:
              throw new Error(`Unknown auth action: ${params.action}`);
          }
        
        case 'dbProxy':
          // DB-Proxy-Funktionen
          const { action, table, ...rest } = params;
          return { data: await api.dbAction(action, table, rest) };
        
        case 'atomicOperations':
        case 'adminTools':
        case 'renamePosition':
          // Diese Funktionen haben keine direkte API-Entsprechung
          // Sie müssen manuell migriert werden
          console.error(`Function '${functionName}' not yet migrated to Railway API`);
          throw new Error(`Function '${functionName}' requires manual migration`);
        
        default:
          console.error(`Unknown function: ${functionName}`);
          throw new Error(`Unknown function: ${functionName}`);
      }
    }
  },
  // Auth-Kompatibilitätsschicht für base44.auth.*
  auth: {
    updateMe: async (data) => {
      return api.updateMe(data);
    },
    me: async () => {
      return api.me();
    },
    login: async (email, password) => {
      return api.login(email, password);
    },
    logout: () => {
      return api.logout();
    }
  },
  analytics: {
    track: () => {
      // Analytics deaktiviert
      console.log('[Analytics disabled]');
    }
  }
};
