// Legacy file - use db from client.js instead
import { db } from './client';

// Re-export all entities from db
export const Doctor = db.Doctor;
export const ShiftEntry = db.ShiftEntry;
export const WishRequest = db.WishRequest;
export const Workplace = db.Workplace;
export const ShiftNotification = db.ShiftNotification;
export const DemoSetting = db.DemoSetting;
export const TrainingRotation = db.TrainingRotation;
export const ScheduleRule = db.ScheduleRule;
export const ColorSetting = db.ColorSetting;
export const ScheduleNote = db.ScheduleNote;
export const SystemSetting = db.SystemSetting;
export const CustomHoliday = db.CustomHoliday;
export const StaffingPlanEntry = db.StaffingPlanEntry;
export const BackupLog = db.BackupLog;
export const SystemLog = db.SystemLog;
export const VoiceAlias = db.VoiceAlias;
export const User = db.User;