export interface APIClientCrudMethods {
  list(table: string, options?: Record<string, unknown>): Promise<unknown>;
  filter(table: string, query: unknown, options?: Record<string, unknown>): Promise<unknown>;
  get(table: string, id: string | number): Promise<unknown>;
  create(table: string, data: Record<string, unknown>): Promise<unknown>;
  update(table: string, id: string | number, data: Record<string, unknown>): Promise<unknown>;
  delete(table: string, id: string | number): Promise<unknown>;
  bulkCreate(table: string, dataArray: Record<string, unknown>[]): Promise<unknown>;
}

let defaultApiClient: APIClientCrudMethods | null = null;

function getDefaultApiClient(): APIClientCrudMethods {
  if (!defaultApiClient) {
    throw new Error('EntityClient default API client has not been initialized');
  }
  return defaultApiClient;
}

export function setDefaultEntityApi(apiClient: APIClientCrudMethods): void {
  defaultApiClient = apiClient;
}

export class EntityClient {
  entityName: string;
  apiClient: APIClientCrudMethods;

  constructor(entityName: string, apiClient: APIClientCrudMethods = getDefaultApiClient()) {
    this.entityName = entityName;
    this.apiClient = apiClient;
  }

  async list(options: Record<string, unknown> = {}): Promise<unknown> {
    return this.apiClient.list(this.entityName, options);
  }

  async filter(query: unknown, options: Record<string, unknown> = {}): Promise<unknown> {
    return this.apiClient.filter(this.entityName, query, options);
  }

  async get(id: string | number): Promise<unknown> {
    return this.apiClient.get(this.entityName, id);
  }

  async create(data: Record<string, unknown>): Promise<unknown> {
    return this.apiClient.create(this.entityName, data);
  }

  async update(id: string | number, data: Record<string, unknown>): Promise<unknown> {
    return this.apiClient.update(this.entityName, id, data);
  }

  async delete(id: string | number): Promise<unknown> {
    return this.apiClient.delete(this.entityName, id);
  }

  async bulkCreate(dataArray: Record<string, unknown>[]): Promise<unknown> {
    return this.apiClient.bulkCreate(this.entityName, dataArray);
  }
}

export function createDbCollections(apiClient: APIClientCrudMethods) {
  setDefaultEntityApi(apiClient);

  return {
    Doctor: new EntityClient('Doctor', apiClient),
    ShiftEntry: new EntityClient('ShiftEntry', apiClient),
    WishRequest: new EntityClient('WishRequest', apiClient),
    Workplace: new EntityClient('Workplace', apiClient),
    WorkplaceTimeslot: new EntityClient('WorkplaceTimeslot', apiClient),
    TimeslotTemplate: new EntityClient('TimeslotTemplate', apiClient),
    ShiftNotification: new EntityClient('ShiftNotification', apiClient),
    DemoSetting: new EntityClient('DemoSetting', apiClient),
    TrainingRotation: new EntityClient('TrainingRotation', apiClient),
    ScheduleRule: new EntityClient('ScheduleRule', apiClient),
    ColorSetting: new EntityClient('ColorSetting', apiClient),
    ScheduleNote: new EntityClient('ScheduleNote', apiClient),
    SystemSetting: new EntityClient('SystemSetting', apiClient),
    CustomHoliday: new EntityClient('CustomHoliday', apiClient),
    StaffingPlanEntry: new EntityClient('StaffingPlanEntry', apiClient),
    BackupLog: new EntityClient('BackupLog', apiClient),
    SystemLog: new EntityClient('SystemLog', apiClient),
    VoiceAlias: new EntityClient('VoiceAlias', apiClient),
    User: new EntityClient('User', apiClient),
    TeamRole: new EntityClient('TeamRole', apiClient),
    Qualification: new EntityClient('Qualification', apiClient),
    DoctorQualification: new EntityClient('DoctorQualification', apiClient),
    WorkplaceQualification: new EntityClient('WorkplaceQualification', apiClient),
    ShiftTimeRule: new EntityClient('ShiftTimeRule', apiClient),
    ScheduleBlock: new EntityClient('ScheduleBlock', apiClient),
    collection: (name: string): EntityClient => new EntityClient(name, apiClient),
  };
}

export type DbCollections = ReturnType<typeof createDbCollections>;
