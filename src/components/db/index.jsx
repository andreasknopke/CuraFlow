import { Base44Adapter } from './Base44Adapter';
import { MySQLAdapter } from './MySQLAdapter';
import { DualAdapter, setDbMode } from './DualAdapter';

// Using DualAdapter to support parallel operation modes
const createAdapter = (entityName) => new DualAdapter(entityName);

// Export setDbMode for external use
export { setDbMode };

export const db = {
  Doctor: createAdapter('Doctor'),
  ShiftEntry: createAdapter('ShiftEntry'),
  WishRequest: createAdapter('WishRequest'),
  Workplace: createAdapter('Workplace'),
  ShiftNotification: createAdapter('ShiftNotification'),
  DemoSetting: createAdapter('DemoSetting'),
  TrainingRotation: createAdapter('TrainingRotation'),
  ScheduleRule: createAdapter('ScheduleRule'),
  ColorSetting: createAdapter('ColorSetting'),
  ScheduleNote: createAdapter('ScheduleNote'),
  SystemSetting: createAdapter('SystemSetting'),
  CustomHoliday: createAdapter('CustomHoliday'),
  StaffingPlanEntry: createAdapter('StaffingPlanEntry'),
  BackupLog: createAdapter('BackupLog'),
  SystemLog: createAdapter('SystemLog'),
  VoiceAlias: createAdapter('VoiceAlias'),
  User: createAdapter('User'),
  
  collection: (name) => createAdapter(name)
};