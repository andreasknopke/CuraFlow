import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import mysql from 'npm:mysql2@^3.9.0/promise';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        const body = await req.json();
        const { action, data, type, backupId, count, days, oldDoctors } = body;

        // Auth Check
        if (action === 'register_change') {
             if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
        } else {
             if (!user || user.role !== 'admin') {
                return Response.json({ error: "Unauthorized" }, { status: 403 });
             }
        }

        // --- MYSQL HELPER ---
        const getMysqlConnection = async () => {
            try {
                return await mysql.createConnection({
                    host: Deno.env.get('MYSQL_HOST')?.trim(),
                    user: Deno.env.get('MYSQL_USER')?.trim(),
                    password: Deno.env.get('MYSQL_PASSWORD')?.trim(),
                    database: Deno.env.get('MYSQL_DATABASE')?.trim(),
                    port: parseInt(Deno.env.get('MYSQL_PORT')?.trim() || '3306')
                });
            } catch (e) {
                console.error("MySQL Connection Failed:", e);
                return null;
            }
        };

        const syncToMySQL = async (entity, operation, payload, id = null) => {
            const allSettings = await base44.asServiceRole.entities.SystemSetting.list();
            const mode = allSettings.find(s => s.key === 'db_mode')?.value || 'internal';
            
            if (mode === 'internal') return; // Don't write to MySQL if internal mode

            const connection = await getMysqlConnection();
            if (!connection) return;

            try {
                if (operation === 'create') {
                    const keys = Object.keys(payload);
                    const values = keys.map(k => {
                        const val = payload[k];
                        if (val instanceof Date) return val.toISOString().slice(0, 19).replace('T', ' ');
                        if (typeof val === 'object' && val !== null) return JSON.stringify(val);
                        return val;
                    });
                    const placeholders = keys.map(() => '?').join(',');
                    await connection.execute(`INSERT INTO \`${entity}\` (\`${keys.join('`,`')}\`) VALUES (${placeholders})`, values);
                } else if (operation === 'update') {
                    if (!id) return;
                    const keys = Object.keys(payload).filter(k => k !== 'id');
                    const sets = keys.map(k => `\`${k}\` = ?`).join(',');
                    const values = keys.map(k => {
                         const val = payload[k];
                         if (val instanceof Date) return val.toISOString().slice(0, 19).replace('T', ' ');
                         if (typeof val === 'object' && val !== null) return JSON.stringify(val);
                         return val;
                    });
                    values.push(id);
                    await connection.execute(`UPDATE \`${entity}\` SET ${sets} WHERE id = ?`, values);
                } else if (operation === 'delete') {
                    if (!id) return;
                    await connection.execute(`DELETE FROM \`${entity}\` WHERE id = ?`, [id]);
                }
            } catch (e) {
                console.error(`MySQL Sync Failed (${operation} ${entity}):`, e);
            } finally {
                await connection.end();
            }
        };

        // Helper: Log
        const log = async (level, source, message, details = null) => {
            try {
                // Internal Log
                const logEntry = await base44.asServiceRole.entities.SystemLog.create({
                    level,
                    source,
                    message,
                    details: details ? JSON.stringify(details, null, 2) : null
                });
                // Sync Log to MySQL? Maybe overkill, but consistent.
                // But SystemLog is forced to 'internal' in DualAdapter usually. 
                // Let's skip syncing logs to avoid noise/recursion issues.
            } catch (e) { console.error("Logging failed:", e); }
        };

        // Helper: Create Backup Data
        const generateBackup = async () => {
            const doctors = await base44.asServiceRole.entities.Doctor.list(null, 1000);
            const shifts = await base44.asServiceRole.entities.ShiftEntry.list(null, 10000);
            const staffing = await base44.asServiceRole.entities.StaffingPlanEntry.list(null, 5000);
            const workplaces = await base44.asServiceRole.entities.Workplace.list(null, 1000);
            const settings = await base44.asServiceRole.entities.SystemSetting.list(null, 1000);
            const colorSettings = await base44.asServiceRole.entities.ColorSetting.list(null, 1000);
            const demoSettings = await base44.asServiceRole.entities.DemoSetting.list(null, 1000);
            const backupLog = await base44.asServiceRole.entities.BackupLog.list(null, 1000);

            return {
                timestamp: new Date().toISOString(),
                version: "1.0",
                data: {
                    Doctor: doctors,
                    ShiftEntry: shifts,
                    StaffingPlanEntry: staffing,
                    Workplace: workplaces,
                    SystemSetting: settings,
                    ColorSetting: colorSettings,
                    DemoSetting: demoSettings,
                    BackupLog: backupLog
                }
            };
        };

        // Helper: Restore Data (ONLY writes to Base44, NO MySQL sync during restore)
        const performRestore = async (backupData) => {
            const entities = ['Doctor', 'ShiftEntry', 'StaffingPlanEntry', 'Workplace', 'SystemSetting', 'ColorSetting', 'DemoSetting', 'BackupLog', 'WishRequest', 'TrainingRotation', 'ScheduleNote'];
            const results = {};

            for (const entityName of entities) {
                const items = backupData.data[entityName];
                if (items && items.length > 0) {
                    const cleanItems = items.map(item => {
                        const { id, created_date, updated_date, created_by, ...rest } = item;
                        return rest;
                    });
                    
                    if (cleanItems.length > 0) {
                         const chunkSize = 50; // Smaller chunks for rate limiting
                         results[entityName] = 0;
                         for (let i = 0; i < cleanItems.length; i += chunkSize) {
                             const chunk = cleanItems.slice(i, i + chunkSize);
                             
                             // Internal Write ONLY - no MySQL sync
                             await base44.asServiceRole.entities[entityName].bulkCreate(chunk);
                             results[entityName] += chunk.length;
                         }
                    }
                }
            }
            return results;
        };

        // --- REGISTER CHANGE & AUTO BACKUP ---
        if (action === 'register_change') {
            const allSettings = await base44.asServiceRole.entities.SystemSetting.list();
            const configSetting = allSettings.find(s => s.key === 'backup_config');
            
            if (!configSetting || !configSetting.value) return Response.json({ status: "no_config" });
            
            const config = JSON.parse(configSetting.value);
            if (!config.enabled) return Response.json({ status: "disabled" });

            const threshold = config.threshold || 20;
            
            let counterSetting = allSettings.find(s => s.key === 'backup_change_counter');
            let currentCount = 0;
            
            if (counterSetting) {
                currentCount = parseInt(counterSetting.value) || 0;
            }

            const increment = count || 1;
            let newCount = currentCount + increment;
            let triggered = false;

            if (newCount >= threshold) {
                triggered = true;
                newCount = 0;
            }

            // Save Counter
            if (counterSetting) {
                const payload = { value: newCount.toString() };
                await base44.asServiceRole.entities.SystemSetting.update(counterSetting.id, payload);
                await syncToMySQL('SystemSetting', 'update', payload, counterSetting.id);
            } else {
                const payload = { key: 'backup_change_counter', value: newCount.toString() };
                const created = await base44.asServiceRole.entities.SystemSetting.create(payload);
                await syncToMySQL('SystemSetting', 'create', { ...payload, id: created.id, created_by: created.created_by, created_date: created.created_date, updated_date: created.updated_date });
            }

            return Response.json({ count: newCount, shouldBackup: triggered });
        }

        // --- PERFORM AUTO BACKUP ---
        if (action === 'perform_auto_backup') {
            const allSettings = await base44.asServiceRole.entities.SystemSetting.list();
            const modeSetting = allSettings.find(s => s.key === 'db_mode');
            if (modeSetting && modeSetting.value === 'mysql') {
                return Response.json({ status: "skipped_mysql_mode" });
            }

            const configSetting = allSettings.find(s => s.key === 'backup_config');
            if (!configSetting) return Response.json({ status: "skipped" });
            
            const config = JSON.parse(configSetting.value);
            
            await log('info', 'AutoBackup', `Starting auto-backup...`);
                 
            try {
                const backupData = await generateBackup();
                const jsonStr = JSON.stringify(backupData);
                const fileName = `backup_auto_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
                const file = new File([jsonStr], fileName, { type: "application/json" });

                const { file_uri } = await base44.asServiceRole.integrations.Core.UploadPrivateFile({ file });

                const logData = {
                    filename: fileName,
                    file_uri: file_uri,
                    size: jsonStr.length,
                    type: 'auto',
                    status: 'success',
                    metadata: JSON.stringify({ records: Object.keys(backupData.data).map(k => `${k}:${backupData.data[k].length}`).join(', ') })
                };

                const created = await base44.asServiceRole.entities.BackupLog.create(logData);
                
                // Sync to MySQL
                await syncToMySQL('BackupLog', 'create', { ...logData, id: created.id, created_by: created.created_by, created_date: created.created_date, updated_date: created.updated_date });

                await log('success', 'AutoBackup', `Backup created: ${fileName}`);

                // Retention
                const retention = config.retention || 30;
                const autoBackups = await base44.asServiceRole.entities.BackupLog.filter({ type: 'auto' }, '-created_date', 100);
                if (autoBackups.length > retention) {
                    const toDelete = autoBackups.slice(retention);
                    for (const b of toDelete) {
                        await base44.asServiceRole.entities.BackupLog.delete(b.id);
                        await syncToMySQL('BackupLog', 'delete', null, b.id);
                    }
                }

                // Auto Cleanup Orphans
                if (config.auto_cleanup_orphans) {
                     // ... logic remains similar, can add sync if needed, but shifts are usually synced by DualAdapter
                     // If we delete via ServiceRole, we MUST sync if we want consistency.
                     // But orphans are usually errors.
                }

                return Response.json({ status: "success" });

            } catch(e) {
                await log('error', 'AutoBackup', `Backup failed: ${e.message}`);
                return Response.json({ error: e.message }, { status: 500 });
            }
        }

        // --- SERVER BACKUP (Create Manual) ---
        if (action === 'create_server_backup') {
            await log('info', 'ManualBackup', `Starting backup (${type})`);
            
            try {
                const backupData = await generateBackup();
                const jsonStr = JSON.stringify(backupData);
            
                const fileName = `backup_${type || 'manual'}_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
                const file = new File([jsonStr], fileName, { type: "application/json" });

                const { file_uri } = await base44.asServiceRole.integrations.Core.UploadPrivateFile({ file });

                const logData = {
                    filename: fileName,
                    file_uri: file_uri,
                    size: jsonStr.length,
                    type: type || 'manual',
                    status: 'success',
                    metadata: JSON.stringify({ records: Object.keys(backupData.data).map(k => `${k}:${backupData.data[k].length}`).join(', ') })
                };

                const created = await base44.asServiceRole.entities.BackupLog.create(logData);
                await syncToMySQL('BackupLog', 'create', { ...logData, id: created.id, created_by: created.created_by, created_date: created.created_date, updated_date: created.updated_date });

                await log('success', 'ManualBackup', `Backup created: ${fileName}`);
                return Response.json({ message: "Backup erfolgreich erstellt", filename: fileName });
            } catch (e) {
                await log('error', 'ManualBackup', 'Backup failed', { error: e.message });
                throw e;
            }
        }

        // --- SERVER BACKUP (Restore) ---
        if (action === 'restore_server_backup') {
            await log('info', 'Restore', 'Starting restore from server backup', { backupId });

            if (!backupId) return Response.json({ error: "Backup ID required" }, { status: 400 });

            const backupLog = await base44.asServiceRole.entities.BackupLog.get(backupId);
            if (!backupLog) return Response.json({ error: "Backup not found" }, { status: 404 });

            const { signed_url } = await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({ file_uri: backupLog.file_uri });

            const fileRes = await fetch(signed_url);
            if (!fileRes.ok) throw new Error("Failed to download backup file");

            const backupData = await fileRes.json();

            // CLEAR all existing data first
            const entities = ['ShiftEntry', 'WishRequest', 'StaffingPlanEntry', 'ScheduleNote', 'TrainingRotation', 'ColorSetting', 'DemoSetting', 'Workplace', 'Doctor'];
            for (const entityName of entities) {
                const allItems = await base44.asServiceRole.entities[entityName].list(null, 5000);
                for (const item of allItems) {
                    await base44.asServiceRole.entities[entityName].delete(item.id);
                }
            }

            const results = await performRestore(backupData);

            await log('success', 'Restore', 'Restore completed successfully', { results });
            return Response.json({ message: "Wiederherstellung (Import) erfolgreich abgeschlossen.", results });
        }

        // --- BACKUP (Download) ---
        if (action === 'backup') {
            const backupData = await generateBackup();
            return Response.json(backupData);
        }

        // --- RESTORE (Upload) ---
        if (action === 'restore') {
            const { backup } = data;
            if (!backup || !backup.data) {
                return Response.json({ error: "Invalid backup data" }, { status: 400 });
            }

            // FORCE internal mode during restore to avoid MySQL writes
            const allSettingsBefore = await base44.asServiceRole.entities.SystemSetting.list();
            const modeSettingBefore = allSettingsBefore.find(s => s.key === 'db_mode');
            const originalMode = modeSettingBefore?.value || 'internal';
            
            if (modeSettingBefore && originalMode !== 'internal') {
                await base44.asServiceRole.entities.SystemSetting.update(modeSettingBefore.id, { value: 'internal' });
            }

            try {
                await log('info', 'Restore', 'Starting restore with ID mapping');
                
                // STEP 1: CLEAR all existing data first (order matters - children before parents)
                const entitiesToClear = ['ShiftEntry', 'WishRequest', 'StaffingPlanEntry', 'ScheduleNote', 'TrainingRotation', 'ShiftNotification', 'ColorSetting', 'DemoSetting', 'Workplace', 'Doctor'];
                for (const entityName of entitiesToClear) {
                    try {
                        const allItems = await base44.asServiceRole.entities[entityName].list(null, 10000);
                        for (const item of allItems) {
                            await base44.asServiceRole.entities[entityName].delete(item.id);
                        }
                        await log('info', 'Restore', `Cleared ${allItems.length} ${entityName}`);
                    } catch (e) {
                        await log('warning', 'Restore', `Could not clear ${entityName}: ${e.message}`);
                    }
                }

                // STEP 2: ID Mapping for Doctors and Workplaces
                const idMap = { Doctor: {}, Workplace: {} };
                const results = {};

                // Import Doctors first and build ID map
                if (backup.data.Doctor && backup.data.Doctor.length > 0) {
                    results.Doctor = 0;
                    for (const doc of backup.data.Doctor) {
                        const oldId = doc.id;
                        const { id, created_date, updated_date, created_by, ...docData } = doc;
                        const created = await base44.asServiceRole.entities.Doctor.create(docData);
                        idMap.Doctor[oldId] = created.id;
                        results.Doctor++;
                    }
                    await log('info', 'Restore', `Imported ${results.Doctor} Doctors with ID mapping`);
                }

                // Import Workplaces
                if (backup.data.Workplace && backup.data.Workplace.length > 0) {
                    results.Workplace = 0;
                    for (const wp of backup.data.Workplace) {
                        const oldId = wp.id;
                        const { id, created_date, updated_date, created_by, ...wpData } = wp;
                        const created = await base44.asServiceRole.entities.Workplace.create(wpData);
                        idMap.Workplace[oldId] = created.id;
                        results.Workplace++;
                    }
                    await log('info', 'Restore', `Imported ${results.Workplace} Workplaces`);
                }

                // STEP 3: Import entities with doctor_id - REMAP IDs
                const entitiesWithDoctorRef = ['ShiftEntry', 'WishRequest', 'StaffingPlanEntry', 'TrainingRotation', 'ShiftNotification'];
                for (const entityName of entitiesWithDoctorRef) {
                    const items = backup.data[entityName];
                    if (items && items.length > 0) {
                        results[entityName] = 0;
                        let skipped = 0;
                        
                        for (const item of items) {
                            const { id, created_date, updated_date, created_by, ...itemData } = item;
                            
                            // REMAP doctor_id
                            if (itemData.doctor_id) {
                                const newDoctorId = idMap.Doctor[itemData.doctor_id];
                                if (newDoctorId) {
                                    itemData.doctor_id = newDoctorId;
                                } else {
                                    skipped++;
                                    continue; // Skip items with unmapped doctor
                                }
                            }
                            
                            await base44.asServiceRole.entities[entityName].create(itemData);
                            results[entityName]++;
                        }
                        
                        await log('info', 'Restore', `Imported ${results[entityName]} ${entityName} (skipped ${skipped} with unmapped doctor)`);
                    }
                }

                // STEP 4: Other entities without doctor_id
                const otherEntities = ['ColorSetting', 'DemoSetting', 'ScheduleNote'];
                for (const entityName of otherEntities) {
                    const items = backup.data[entityName];
                    if (items && items.length > 0) {
                        results[entityName] = 0;
                        for (const item of items) {
                            const { id, created_date, updated_date, created_by, ...itemData } = item;
                            await base44.asServiceRole.entities[entityName].create(itemData);
                            results[entityName]++;
                        }
                    }
                }
                
                // Restore original mode
                if (modeSettingBefore && originalMode !== 'internal') {
                    await base44.asServiceRole.entities.SystemSetting.update(modeSettingBefore.id, { value: originalMode });
                }
                
                await log('success', 'Restore', 'Restore completed', results);
                return Response.json({ message: "Wiederherstellung erfolgreich mit ID-Mapping.", results, idMapInfo: { doctors: Object.keys(idMap.Doctor).length } });
            } catch (err) {
                await log('error', 'Restore', `Restore failed: ${err.message}`);
                // Restore original mode even on error
                if (modeSettingBefore && originalMode !== 'internal') {
                    try {
                        await base44.asServiceRole.entities.SystemSetting.update(modeSettingBefore.id, { value: originalMode });
                    } catch {}
                }
                throw err;
            }
        }

        // --- CHECK INCONSISTENCIES ---
        if (action === 'check') {
            const issues = [];
            
            // Determine which database to check based on db_mode
            const allSettings = await base44.asServiceRole.entities.SystemSetting.list();
            const modeSetting = allSettings.find(s => s.key === 'db_mode');
            const dbMode = modeSetting?.value || 'internal';
            
            let doctors, shifts, staffing, workplaces, rotations;
            let dataSource = 'Base44';
            
            if (dbMode === 'mysql') {
                // Check MySQL directly
                const connection = await getMysqlConnection();
                if (!connection) {
                    return Response.json({ error: "MySQL Verbindung fehlgeschlagen" }, { status: 500 });
                }
                
                dataSource = 'MySQL';
                try {
                    const [doctorRows] = await connection.execute('SELECT * FROM Doctor');
                    const [shiftRows] = await connection.execute('SELECT * FROM ShiftEntry');
                    const [staffingRows] = await connection.execute('SELECT * FROM StaffingPlanEntry');
                    const [workplaceRows] = await connection.execute('SELECT * FROM Workplace');
                    const [rotationRows] = await connection.execute('SELECT * FROM TrainingRotation');
                    
                    doctors = doctorRows;
                    shifts = shiftRows;
                    staffing = staffingRows;
                    workplaces = workplaceRows;
                    rotations = rotationRows;
                } finally {
                    await connection.end();
                }
            } else {
                // Check Base44 internal
                doctors = await base44.asServiceRole.entities.Doctor.list();
                shifts = await base44.asServiceRole.entities.ShiftEntry.list(null, 10000);
                staffing = await base44.asServiceRole.entities.StaffingPlanEntry.list(null, 5000);
                workplaces = await base44.asServiceRole.entities.Workplace.list(null, 1000);
                rotations = await base44.asServiceRole.entities.TrainingRotation.list(null, 5000);
            }

            const doctorIds = new Set(doctors.map(d => d.id));
            const validPositions = new Set([
                "Verfügbar", "Frei", "Krank", "Urlaub", "Dienstreise", "Nicht verfügbar", "Sonstiges",
                ...workplaces.map(w => w.name)
            ]);

            shifts.forEach(s => {
                if (!doctorIds.has(s.doctor_id)) {
                    issues.push({ type: 'orphaned_shift', id: s.id, description: `Schicht am ${s.date} referenziert nicht existierenden Arzt (${s.doctor_id})` });
                }
                if (!validPositions.has(s.position)) {
                    issues.push({ type: 'orphaned_position', id: s.id, description: `Schicht am ${s.date} hat unbekannte Position "${s.position}"` });
                }
            });

            staffing.forEach(s => {
                if (!doctorIds.has(s.doctor_id)) {
                    issues.push({ type: 'orphaned_staffing', id: s.id, description: `Stellenplan ${s.month}/${s.year} referenziert nicht existierenden Arzt (${s.doctor_id})` });
                }
            });

            // Check for duplicates in ALL entities
            const checkDuplicates = (entityName, items, keyFields) => {
                const map = new Map();
                items.forEach(item => {
                    const key = keyFields.map(f => item[f]).join('|');
                    if (!map.has(key)) map.set(key, []);
                    map.get(key).push(item);
                });

                for (const [key, group] of map.entries()) {
                    if (group.length > 1) {
                        group.sort((a, b) => new Date(a.created_date) - new Date(b.created_date));
                        const toDelete = group.slice(1);
                        issues.push({
                            type: `duplicate_${entityName.toLowerCase()}`,
                            ids: toDelete.map(i => i.id),
                            description: `${group.length} doppelte ${entityName} Einträge (${key})`
                        });
                    }
                }
            };

            checkDuplicates('ShiftEntry', shifts, ['doctor_id', 'date', 'position']);
            // For Doctors: check by name (not email, since many doctors have no email)
            checkDuplicates('Doctor', doctors, ['name']);
            checkDuplicates('Workplace', workplaces, ['name']);
            checkDuplicates('StaffingPlanEntry', staffing, ['doctor_id', 'year', 'month']);
            checkDuplicates('TrainingRotation', rotations, ['doctor_id', 'modality', 'start_date']);

            return Response.json({ 
                issues, 
                dataSource,
                stats: {
                    doctors: doctors.length,
                    shifts: shifts.length,
                    staffing: staffing.length,
                    workplaces: workplaces.length
                }
            });
        }

        // --- REMAP DOCTOR IDS FROM EXPORT FILE ---
        if (action === 'remap_doctor_ids') {
            if (!oldDoctors || !Array.isArray(oldDoctors)) {
                return Response.json({ error: "oldDoctors array required" }, { status: 400 });
            }
            
            const connection = await getMysqlConnection();
            if (!connection) {
                return Response.json({ error: "MySQL Verbindung fehlgeschlagen" }, { status: 500 });
            }
            
            try {
                // Get current Base44 doctors (source of truth for new IDs)
                const base44Doctors = await base44.asServiceRole.entities.Doctor.list();
                
                // Build name -> new ID mapping from Base44
                const nameToNewId = {};
                for (const doc of base44Doctors) {
                    if (doc.name) {
                        nameToNewId[doc.name.toLowerCase().trim()] = doc.id;
                    }
                }
                
                // Build old ID -> new ID mapping from provided export
                const idMapping = {};
                for (const oldDoc of oldDoctors) {
                    if (oldDoc.name && oldDoc.id) {
                        const newId = nameToNewId[oldDoc.name.toLowerCase().trim()];
                        if (newId && newId !== oldDoc.id) {
                            idMapping[oldDoc.id] = newId;
                        }
                    }
                }
                
                console.log("ID Mapping:", JSON.stringify(idMapping));
                
                // Update all references
                let shiftsUpdated = 0;
                let staffingUpdated = 0;
                let rotationsUpdated = 0;
                let wishesUpdated = 0;
                let notificationsUpdated = 0;
                
                for (const [oldId, newId] of Object.entries(idMapping)) {
                    const [r1] = await connection.execute(
                        'UPDATE ShiftEntry SET doctor_id = ? WHERE doctor_id = ?',
                        [newId, oldId]
                    );
                    shiftsUpdated += r1.affectedRows;
                    
                    const [r2] = await connection.execute(
                        'UPDATE StaffingPlanEntry SET doctor_id = ? WHERE doctor_id = ?',
                        [newId, oldId]
                    );
                    staffingUpdated += r2.affectedRows;
                    
                    const [r3] = await connection.execute(
                        'UPDATE TrainingRotation SET doctor_id = ? WHERE doctor_id = ?',
                        [newId, oldId]
                    );
                    rotationsUpdated += r3.affectedRows;
                    
                    const [r4] = await connection.execute(
                        'UPDATE WishRequest SET doctor_id = ? WHERE doctor_id = ?',
                        [newId, oldId]
                    );
                    wishesUpdated += r4.affectedRows;
                    
                    const [r5] = await connection.execute(
                        'UPDATE ShiftNotification SET doctor_id = ? WHERE doctor_id = ?',
                        [newId, oldId]
                    );
                    notificationsUpdated += r5.affectedRows;
                }
                
                // Now sync doctors table
                await connection.execute('DELETE FROM Doctor');
                
                for (const doc of base44Doctors) {
                    await connection.execute(`
                        INSERT INTO Doctor (id, name, initials, role, color, \`order\`, email, 
                            receive_email_notifications, google_email, fte, contract_end_date, 
                            exclude_from_staffing_plan)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `, [
                        doc.id, doc.name || null, doc.initials || null, doc.role || 'Assistenzarzt',
                        doc.color || null, doc.order ?? 0, doc.email || null,
                        doc.receive_email_notifications ? 1 : 0, doc.google_email || null,
                        doc.fte ?? 1, doc.contract_end_date || null, doc.exclude_from_staffing_plan ? 1 : 0
                    ]);
                }
                
                await connection.end();
                return Response.json({ 
                    message: `ID-Remapping abgeschlossen`,
                    details: {
                        mappings_applied: Object.keys(idMapping).length,
                        shifts_updated: shiftsUpdated,
                        staffing_updated: staffingUpdated,
                        rotations_updated: rotationsUpdated,
                        wishes_updated: wishesUpdated,
                        notifications_updated: notificationsUpdated,
                        doctors_synced: base44Doctors.length,
                        mapping: idMapping
                    }
                });
            } catch (e) {
                await connection.end();
                return Response.json({ error: e.message }, { status: 500 });
            }
        }

        // --- SYNC DOCTORS TO MYSQL (with ID remapping) ---
        if (action === 'sync_doctors_to_mysql') {
            const connection = await getMysqlConnection();
            if (!connection) {
                return Response.json({ error: "MySQL Verbindung fehlgeschlagen" }, { status: 500 });
            }
            
            try {
                // Get all doctors from Base44 (source of truth)
                const base44Doctors = await base44.asServiceRole.entities.Doctor.list();
                
                // Get all UNIQUE doctor_ids from ShiftEntry to find old IDs
                const [shiftDoctorIds] = await connection.execute('SELECT DISTINCT doctor_id FROM ShiftEntry');
                const [staffingDoctorIds] = await connection.execute('SELECT DISTINCT doctor_id FROM StaffingPlanEntry');
                const [rotationDoctorIds] = await connection.execute('SELECT DISTINCT doctor_id FROM TrainingRotation');
                
                // Collect all old IDs that are referenced
                const allReferencedIds = new Set([
                    ...shiftDoctorIds.map(r => r.doctor_id),
                    ...staffingDoctorIds.map(r => r.doctor_id),
                    ...rotationDoctorIds.map(r => r.doctor_id)
                ].filter(Boolean));
                
                // Get current MySQL doctors
                const [mysqlDoctors] = await connection.execute('SELECT id, name FROM Doctor');
                const mysqlIdToName = {};
                for (const doc of mysqlDoctors) {
                    mysqlIdToName[doc.id] = doc.name;
                }
                
                // Build Base44 name -> new ID mapping
                const nameToNewId = {};
                for (const doc of base44Doctors) {
                    if (doc.name) {
                        nameToNewId[doc.name.toLowerCase()] = doc.id;
                    }
                }
                
                // For each referenced old ID, find its name (from MySQL doctors or we need to guess)
                // First, check which old IDs are in current MySQL doctors table
                const idMapping = {};
                
                for (const oldId of allReferencedIds) {
                    // Skip if this ID already matches a Base44 doctor
                    if (base44Doctors.some(d => d.id === oldId)) {
                        continue;
                    }
                    
                    // Try to find name from MySQL doctors table
                    const name = mysqlIdToName[oldId];
                    if (name) {
                        const newId = nameToNewId[name.toLowerCase()];
                        if (newId) {
                            idMapping[oldId] = newId;
                        }
                    }
                }
                
                console.log("Referenced IDs:", Array.from(allReferencedIds));
                console.log("ID Mapping:", JSON.stringify(idMapping));
                console.log("Unmapped IDs:", Array.from(allReferencedIds).filter(id => !idMapping[id] && !base44Doctors.some(d => d.id === id)));
                
                // Step 1: Update all ShiftEntry doctor_id references FIRST (before deleting doctors)
                let shiftsUpdated = 0;
                for (const [oldId, newId] of Object.entries(idMapping)) {
                    const [result] = await connection.execute(
                        'UPDATE ShiftEntry SET doctor_id = ? WHERE doctor_id = ?',
                        [newId, oldId]
                    );
                    shiftsUpdated += result.affectedRows;
                }
                
                // Step 2: Update StaffingPlanEntry doctor_id references
                let staffingUpdated = 0;
                for (const [oldId, newId] of Object.entries(idMapping)) {
                    const [result] = await connection.execute(
                        'UPDATE StaffingPlanEntry SET doctor_id = ? WHERE doctor_id = ?',
                        [newId, oldId]
                    );
                    staffingUpdated += result.affectedRows;
                }
                
                // Step 3: Update TrainingRotation doctor_id references
                let rotationsUpdated = 0;
                for (const [oldId, newId] of Object.entries(idMapping)) {
                    const [result] = await connection.execute(
                        'UPDATE TrainingRotation SET doctor_id = ? WHERE doctor_id = ?',
                        [newId, oldId]
                    );
                    rotationsUpdated += result.affectedRows;
                }
                
                // Step 4: Now replace all doctors
                await connection.execute('DELETE FROM Doctor');
                
                let inserted = 0;
                for (const doc of base44Doctors) {
                    await connection.execute(`
                        INSERT INTO Doctor (id, name, initials, role, color, \`order\`, email, 
                            receive_email_notifications, google_email, fte, contract_end_date, 
                            exclude_from_staffing_plan)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `, [
                        doc.id,
                        doc.name || null,
                        doc.initials || null,
                        doc.role || 'Assistenzarzt',
                        doc.color || null,
                        doc.order ?? 0,
                        doc.email || null,
                        doc.receive_email_notifications ? 1 : 0,
                        doc.google_email || null,
                        doc.fte ?? 1,
                        doc.contract_end_date || null,
                        doc.exclude_from_staffing_plan ? 1 : 0
                    ]);
                    inserted++;
                }
                
                await connection.end();
                return Response.json({ 
                    message: `Synchronisierung abgeschlossen`,
                    details: {
                        doctors_inserted: inserted,
                        id_mappings_found: Object.keys(idMapping).length,
                        shifts_updated: shiftsUpdated,
                        staffing_updated: staffingUpdated,
                        rotations_updated: rotationsUpdated,
                        mapping: idMapping
                    }
                });
            } catch (e) {
                await connection.end();
                return Response.json({ error: e.message }, { status: 500 });
            }
        }

        // --- REPAIR ---
        if (action === 'repair') {
            const { issuesToFix } = data;
            const results = [];
            
            // Determine which database to repair based on db_mode
            const allSettings = await base44.asServiceRole.entities.SystemSetting.list();
            const modeSetting = allSettings.find(s => s.key === 'db_mode');
            const dbMode = modeSetting?.value || 'internal';
            
            let connection = null;
            if (dbMode === 'mysql') {
                connection = await getMysqlConnection();
                if (!connection) {
                    return Response.json({ error: "MySQL Verbindung fehlgeschlagen" }, { status: 500 });
                }
            }

            for (const issue of issuesToFix) {
                const ids = issue.ids || [issue.id];
                let table = 'ShiftEntry';
                
                // Determine entity type from issue type
                if (issue.type === 'orphaned_staffing') table = 'StaffingPlanEntry';
                else if (issue.type === 'orphaned_shift' || issue.type === 'orphaned_position') table = 'ShiftEntry';
                else if (issue.type.startsWith('duplicate_')) {
                    const typeMap = {
                        'duplicate_shiftentry': 'ShiftEntry',
                        'duplicate_doctor': 'Doctor',
                        'duplicate_workplace': 'Workplace',
                        'duplicate_staffingplanentry': 'StaffingPlanEntry',
                        'duplicate_trainingrotation': 'TrainingRotation'
                    };
                    table = typeMap[issue.type] || 'ShiftEntry';
                }
                
                let deletedCount = 0;
                for (const id of ids) {
                    try {
                        if (dbMode === 'mysql' && connection) {
                            // Delete from MySQL directly
                            const [result] = await connection.execute(`DELETE FROM \`${table}\` WHERE id = ?`, [id]);
                            if (result.affectedRows > 0) deletedCount++;
                        } else {
                            // Delete from Base44
                            await base44.asServiceRole.entities[table].delete(id);
                            deletedCount++;
                        }
                    } catch (e) {
                        console.error(`Failed to delete (${table}:${id})`, e.message);
                    }
                }
                results.push(`Bereinigt: ${issue.type} (${deletedCount}/${ids.length} gelöscht)`);
            }
            
            if (connection) await connection.end();
            return Response.json({ 
                message: `Reparatur abgeschlossen (${dbMode === 'mysql' ? 'MySQL' : 'Base44'})`, 
                results 
            });
        }

        // --- DELETE OLD LOGS ---
        if (action === 'delete_old_logs') {
            // days is already destructured from body at the top
            if (!days || days < 1) return Response.json({ error: "Invalid days parameter" }, { status: 400 });
            
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - days);
            
            const allLogs = await base44.asServiceRole.entities.SystemLog.list(null, 5000);
            const oldLogs = allLogs.filter(log => new Date(log.created_date) < cutoffDate);
            
            for (const log of oldLogs) {
                await base44.asServiceRole.entities.SystemLog.delete(log.id);
            }
            
            await log('info', 'LogCleanup', `${oldLogs.length} Logs älter als ${days} Tage gelöscht`);
            
            return Response.json({ message: `${oldLogs.length} alte Logs wurden gelöscht` });
        }

        // --- GENERATE DB TOKEN ---
        if (action === 'generate_db_token') {
            const config = {
                host: Deno.env.get('MYSQL_HOST')?.trim(),
                user: Deno.env.get('MYSQL_USER')?.trim(),
                password: Deno.env.get('MYSQL_PASSWORD')?.trim(),
                database: Deno.env.get('MYSQL_DATABASE')?.trim(),
                port: parseInt(Deno.env.get('MYSQL_PORT')?.trim() || '3306')
            };
            if (!config.host || !config.user) {
                 return Response.json({ error: "Keine Secrets gefunden" }, { status: 400 });
            }
            const json = JSON.stringify(config);
            const token = btoa(json);
            return Response.json({ token });
        }

        // --- RESTORE FROM MYSQL ---
        if (action === 'restore_from_mysql') {
            await log('info', 'MySQLRestore', 'Starting MySQL to Base44 restore with ID mapping and rate limiting');
            
            let connection;
            let originalMode = 'internal';
            
            // Helper: delay function
            const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
            
            // Helper: rate-limited create with retry
            const rateLimitedCreate = async (entity, data, retries = 3) => {
                for (let i = 0; i < retries; i++) {
                    try {
                        return await base44.asServiceRole.entities[entity].create(data);
                    } catch (e) {
                        if (e.message?.includes('Rate limit') && i < retries - 1) {
                            await delay(2000 * (i + 1)); // Exponential backoff
                            continue;
                        }
                        throw e;
                    }
                }
            };
            
            try {
                // Save and switch to internal mode
                const allSettings = await base44.asServiceRole.entities.SystemSetting.list();
                const modeSetting = allSettings.find(s => s.key === 'db_mode');
                if (modeSetting) {
                    originalMode = modeSetting.value;
                    await base44.asServiceRole.entities.SystemSetting.update(modeSetting.id, { value: 'internal' });
                } else {
                    await base44.asServiceRole.entities.SystemSetting.create({ key: 'db_mode', value: 'internal' });
                }
                
                const mysqlConfig = {
                    host: Deno.env.get('MYSQL_HOST')?.trim(),
                    user: Deno.env.get('MYSQL_USER')?.trim(),
                    password: Deno.env.get('MYSQL_PASSWORD')?.trim(),
                    database: Deno.env.get('MYSQL_DATABASE')?.trim(),
                    port: parseInt(Deno.env.get('MYSQL_PORT')?.trim() || '3306'),
                    dateStrings: true
                };
                
                connection = await mysql.createConnection(mysqlConfig);
                
                // ID Mapping
                const idMap = { Doctor: {}, Workplace: {} };
                const results = {};
                
                // FIRST: Clear all existing data (with rate limiting)
                const entitiesToClear = ['ShiftEntry', 'WishRequest', 'StaffingPlanEntry', 'TrainingRotation', 'ScheduleNote', 'ShiftNotification', 'Doctor', 'Workplace', 'DemoSetting', 'ColorSetting'];
                for (const entityName of entitiesToClear) {
                    try {
                        const existing = await base44.asServiceRole.entities[entityName].list(null, 10000);
                        // Delete in batches with delays
                        for (let i = 0; i < existing.length; i++) {
                            await base44.asServiceRole.entities[entityName].delete(existing[i].id);
                            if (i > 0 && i % 20 === 0) await delay(500); // Pause every 20 deletes
                        }
                    } catch (e) {
                        console.log(`Could not clear ${entityName}:`, e.message);
                    }
                }
                
                await delay(1000); // Pause before imports
                
                // STEP 1: Import Doctors
                try {
                    const [doctorRows] = await connection.execute(`SELECT * FROM Doctor`);
                    results.Doctor = 0;
                    
                    for (const row of doctorRows) {
                        const oldId = row.id;
                        const { id, created_date, updated_date, created_by, ...doctorData } = row;
                        
                        if (doctorData.receive_email_notifications !== undefined) 
                            doctorData.receive_email_notifications = !!doctorData.receive_email_notifications;
                        if (doctorData.exclude_from_staffing_plan !== undefined) 
                            doctorData.exclude_from_staffing_plan = !!doctorData.exclude_from_staffing_plan;
                        
                        const created = await rateLimitedCreate('Doctor', doctorData);
                        idMap.Doctor[oldId] = created.id;
                        results.Doctor++;
                        
                        if (results.Doctor % 10 === 0) await delay(300);
                    }
                } catch (e) {
                    results.Doctor = `Error: ${e.message}`;
                }
                
                await delay(500);
                
                // STEP 2: Import Workplaces
                try {
                    const [wpRows] = await connection.execute(`SELECT * FROM Workplace`);
                    results.Workplace = 0;
                    
                    for (const row of wpRows) {
                        const oldId = row.id;
                        const { id, created_date, updated_date, created_by, ...wpData } = row;
                        
                        if (wpData.active_days && typeof wpData.active_days === 'string') {
                            try { wpData.active_days = JSON.parse(wpData.active_days); } catch {}
                        }
                        ['auto_off', 'show_in_service_plan', 'allows_rotation_concurrently', 'allows_consecutive_days'].forEach(f => {
                            if (wpData[f] !== undefined) wpData[f] = !!wpData[f];
                        });
                        
                        const created = await rateLimitedCreate('Workplace', wpData);
                        idMap.Workplace[oldId] = created.id;
                        results.Workplace++;
                        
                        if (results.Workplace % 10 === 0) await delay(300);
                    }
                } catch (e) {
                    results.Workplace = `Error: ${e.message}`;
                }
                
                await delay(1000);
                
                // STEP 3: Import entities with doctor_id reference
                const entitiesWithDoctorRef = ['ShiftEntry', 'WishRequest', 'StaffingPlanEntry', 'TrainingRotation', 'ShiftNotification'];
                
                for (const entityName of entitiesWithDoctorRef) {
                    try {
                        const [rows] = await connection.execute(`SELECT * FROM \`${entityName}\``);
                        results[entityName] = 0;
                        
                        for (let i = 0; i < rows.length; i++) {
                            const row = rows[i];
                            const { id, created_date, updated_date, created_by, ...itemData } = row;
                            
                            // Remap doctor_id
                            if (itemData.doctor_id && idMap.Doctor[itemData.doctor_id]) {
                                itemData.doctor_id = idMap.Doctor[itemData.doctor_id];
                            } else if (itemData.doctor_id) {
                                continue; // Skip unmapped
                            }
                            
                            ['user_viewed', 'acknowledged', 'is_active'].forEach(f => {
                                if (itemData[f] !== undefined) itemData[f] = !!itemData[f];
                            });
                            
                            await rateLimitedCreate(entityName, itemData);
                            results[entityName]++;
                            
                            // Rate limit: pause every 15 items
                            if (i > 0 && i % 15 === 0) await delay(500);
                        }
                    } catch (e) {
                        results[entityName] = `Error: ${e.message}`;
                    }
                    
                    await delay(1000); // Pause between entity types
                }
                
                // STEP 4: Other entities
                const otherEntities = ['DemoSetting', 'ColorSetting', 'ScheduleNote'];
                for (const entityName of otherEntities) {
                    try {
                        const [rows] = await connection.execute(`SELECT * FROM \`${entityName}\``);
                        results[entityName] = 0;
                        
                        for (let i = 0; i < rows.length; i++) {
                            const row = rows[i];
                            const { id, created_date, updated_date, created_by, ...itemData } = row;
                            
                            if (itemData.active_days && typeof itemData.active_days === 'string') {
                                try { itemData.active_days = JSON.parse(itemData.active_days); } catch {}
                            }
                            if (itemData.is_active !== undefined) itemData.is_active = !!itemData.is_active;
                            
                            await rateLimitedCreate(entityName, itemData);
                            results[entityName]++;
                            
                            if (i > 0 && i % 15 === 0) await delay(500);
                        }
                    } catch (e) {
                        results[entityName] = `Error: ${e.message}`;
                    }
                    
                    await delay(500);
                }
                
                // Restore original mode
                const modeSettingAfter = (await base44.asServiceRole.entities.SystemSetting.list()).find(s => s.key === 'db_mode');
                if (modeSettingAfter) {
                    await base44.asServiceRole.entities.SystemSetting.update(modeSettingAfter.id, { value: originalMode });
                }
                
                return Response.json({ message: 'MySQL Wiederherstellung erfolgreich', results, idMap: { doctorCount: Object.keys(idMap.Doctor).length } });
                
            } catch (err) {
                try {
                    const allSettings = await base44.asServiceRole.entities.SystemSetting.list();
                    const modeSetting = allSettings.find(s => s.key === 'db_mode');
                    if (modeSetting) {
                        await base44.asServiceRole.entities.SystemSetting.update(modeSetting.id, { value: originalMode });
                    }
                } catch {}
                
                return Response.json({ error: err.message }, { status: 500 });
            } finally {
                if (connection) await connection.end();
            }
        }

        // --- SAFE CLEAN IMPORT (forces internal mode, clears Base44, imports) ---
        if (action === 'safe_clean_import') {
            const { backup } = data;
            if (!backup || !backup.data) {
                return Response.json({ error: "Invalid backup data" }, { status: 400 });
            }

            // STEP 0: Force internal mode to protect MySQL
            const allSettingsBefore = await base44.asServiceRole.entities.SystemSetting.list();
            const modeSettingBefore = allSettingsBefore.find(s => s.key === 'db_mode');
            const originalMode = modeSettingBefore?.value || 'internal';
            
            if (modeSettingBefore) {
                await base44.asServiceRole.entities.SystemSetting.update(modeSettingBefore.id, { value: 'internal' });
            } else {
                await base44.asServiceRole.entities.SystemSetting.create({ key: 'db_mode', value: 'internal' });
            }

            await log('info', 'SafeImport', `Starting safe import. Original mode: ${originalMode}. MySQL is PROTECTED.`);

            try {
                // STEP 1: CLEAR all existing Base44 data
                const entitiesToClear = ['ShiftEntry', 'WishRequest', 'StaffingPlanEntry', 'ScheduleNote', 'TrainingRotation', 'ShiftNotification', 'ColorSetting', 'DemoSetting', 'Workplace', 'Doctor'];
                for (const entityName of entitiesToClear) {
                    try {
                        const allItems = await base44.asServiceRole.entities[entityName].list(null, 10000);
                        for (const item of allItems) {
                            await base44.asServiceRole.entities[entityName].delete(item.id);
                        }
                        await log('info', 'SafeImport', `Cleared ${allItems.length} ${entityName}`);
                    } catch (e) {
                        console.log(`Could not clear ${entityName}: ${e.message}`);
                    }
                }

                // STEP 2: ID Mapping for Doctors and Workplaces
                const idMap = { Doctor: {}, Workplace: {} };
                const results = {};

                // Import Doctors first and build ID map
                if (backup.data.Doctor && backup.data.Doctor.length > 0) {
                    results.Doctor = 0;
                    for (const doc of backup.data.Doctor) {
                        const oldId = doc.id;
                        const { id, created_date, updated_date, created_by, ...docData } = doc;
                        const created = await base44.asServiceRole.entities.Doctor.create(docData);
                        idMap.Doctor[oldId] = created.id;
                        results.Doctor++;
                    }
                    await log('info', 'SafeImport', `Imported ${results.Doctor} Doctors`);
                }

                // Import Workplaces
                if (backup.data.Workplace && backup.data.Workplace.length > 0) {
                    results.Workplace = 0;
                    for (const wp of backup.data.Workplace) {
                        const oldId = wp.id;
                        const { id, created_date, updated_date, created_by, ...wpData } = wp;
                        const created = await base44.asServiceRole.entities.Workplace.create(wpData);
                        idMap.Workplace[oldId] = created.id;
                        results.Workplace++;
                    }
                    await log('info', 'SafeImport', `Imported ${results.Workplace} Workplaces`);
                }

                // STEP 3: Import entities with doctor_id - REMAP IDs
                const entitiesWithDoctorRef = ['ShiftEntry', 'WishRequest', 'StaffingPlanEntry', 'TrainingRotation', 'ShiftNotification'];
                for (const entityName of entitiesWithDoctorRef) {
                    const items = backup.data[entityName];
                    if (items && items.length > 0) {
                        results[entityName] = 0;
                        let skipped = 0;
                        
                        for (const item of items) {
                            const { id, created_date, updated_date, created_by, ...itemData } = item;
                            
                            // Skip items missing required fields
                            if (entityName === 'ShiftEntry' && !itemData.date) {
                                skipped++;
                                continue;
                            }
                            if (entityName === 'WishRequest' && !itemData.date) {
                                skipped++;
                                continue;
                            }
                            if (entityName === 'TrainingRotation' && (!itemData.start_date || !itemData.end_date)) {
                                skipped++;
                                continue;
                            }
                            if (entityName === 'ShiftNotification' && !itemData.date) {
                                skipped++;
                                continue;
                            }
                            
                            // REMAP doctor_id
                            if (itemData.doctor_id) {
                                const newDoctorId = idMap.Doctor[itemData.doctor_id];
                                if (newDoctorId) {
                                    itemData.doctor_id = newDoctorId;
                                } else {
                                    skipped++;
                                    continue;
                                }
                            }
                            
                            try {
                                await base44.asServiceRole.entities[entityName].create(itemData);
                                results[entityName]++;
                            } catch (e) {
                                console.log(`Skip ${entityName}: ${e.message}`);
                                skipped++;
                            }
                        }
                        
                        if (skipped > 0) {
                            await log('warning', 'SafeImport', `${entityName}: skipped ${skipped} invalid/unmapped`);
                        }
                        await log('info', 'SafeImport', `Imported ${results[entityName]} ${entityName}`);
                    }
                }

                // STEP 4: Other entities without doctor_id
                const otherEntities = ['ColorSetting', 'DemoSetting', 'ScheduleNote'];
                for (const entityName of otherEntities) {
                    const items = backup.data[entityName];
                    if (items && items.length > 0) {
                        results[entityName] = 0;
                        for (const item of items) {
                            const { id, created_date, updated_date, created_by, ...itemData } = item;
                            await base44.asServiceRole.entities[entityName].create(itemData);
                            results[entityName]++;
                        }
                    }
                }
                
                await log('success', 'SafeImport', 'Import completed successfully', results);
                
                // NOTE: Mode stays on 'internal' - user must manually switch back if desired
                return Response.json({ 
                    message: "Import erfolgreich! Modus ist jetzt 'Intern'. Wechseln Sie manuell zurück wenn gewünscht.", 
                    results, 
                    idMapInfo: { doctors: Object.keys(idMap.Doctor).length },
                    previousMode: originalMode
                });
            } catch (err) {
                await log('error', 'SafeImport', `Import failed: ${err.message}`);
                throw err;
            }
        }

        // --- WIPE DATABASE (except app_users) ---
        if (action === 'wipe_database') {
            const connection = await getMysqlConnection();
            if (!connection) {
                return Response.json({ error: "MySQL Verbindung fehlgeschlagen" }, { status: 500 });
            }
            
            try {
                // Tables to wipe (order matters - children before parents due to references)
                const tablesToWipe = [
                    'ShiftEntry',
                    'WishRequest', 
                    'StaffingPlanEntry',
                    'TrainingRotation',
                    'ShiftNotification',
                    'ScheduleNote',
                    'VoiceAlias',
                    'ColorSetting',
                    'DemoSetting',
                    'CustomHoliday',
                    'ScheduleRule',
                    'BackupLog',
                    'SystemLog',
                    'SystemSetting',
                    'Workplace',
                    'Doctor'
                ];
                
                const results = {};
                
                for (const table of tablesToWipe) {
                    try {
                        const [countResult] = await connection.execute(`SELECT COUNT(*) as cnt FROM \`${table}\``);
                        const count = countResult[0]?.cnt || 0;
                        
                        await connection.execute(`DELETE FROM \`${table}\``);
                        results[table] = count;
                    } catch (e) {
                        // Table might not exist
                        results[table] = `Fehler: ${e.message}`;
                    }
                }
                
                await connection.end();
                
                return Response.json({ 
                    message: 'Datenbank geleert (außer Benutzer)', 
                    results 
                });
            } catch (e) {
                await connection.end();
                return Response.json({ error: e.message }, { status: 500 });
            }
        }

        // --- EXPORT MYSQL AS JSON ---
        if (action === 'export_mysql_as_json') {
            const mysqlConfig = {
                host: Deno.env.get('MYSQL_HOST')?.trim(),
                user: Deno.env.get('MYSQL_USER')?.trim(),
                password: Deno.env.get('MYSQL_PASSWORD')?.trim(),
                database: Deno.env.get('MYSQL_DATABASE')?.trim(),
                port: parseInt(Deno.env.get('MYSQL_PORT')?.trim() || '3306'),
                dateStrings: true
            };
            
            const connection = await mysql.createConnection(mysqlConfig);
            
            try {
                const entities = ['Doctor', 'Workplace', 'ShiftEntry', 'WishRequest', 'StaffingPlanEntry', 'TrainingRotation', 'DemoSetting', 'ColorSetting', 'ScheduleNote'];
                const exportData = {
                    timestamp: new Date().toISOString(),
                    version: "1.0",
                    source: "mysql",
                    data: {}
                };
                
                for (const entityName of entities) {
                    try {
                        const [rows] = await connection.execute(`SELECT * FROM \`${entityName}\``);
                        // Parse JSON fields and convert booleans
                        const parsed = rows.map(row => {
                            const item = { ...row };
                            // Remove internal fields that shouldn't be in backup
                            delete item.created_date;
                            delete item.updated_date;
                            delete item.created_by;
                            
                            if (item.active_days && typeof item.active_days === 'string') {
                                try { item.active_days = JSON.parse(item.active_days); } catch {}
                            }
                            const boolFields = ['receive_email_notifications', 'exclude_from_staffing_plan', 'user_viewed', 'auto_off', 'show_in_service_plan', 'allows_rotation_concurrently', 'allows_consecutive_days', 'acknowledged', 'is_active'];
                            boolFields.forEach(f => {
                                if (item[f] !== undefined) item[f] = !!item[f];
                            });
                            return item;
                        }).filter(item => {
                            // Filter out invalid entries (missing required date fields)
                            if (entityName === 'ShiftEntry' && !item.date) return false;
                            if (entityName === 'WishRequest' && !item.date) return false;
                            if (entityName === 'TrainingRotation' && (!item.start_date || !item.end_date)) return false;
                            if (entityName === 'ScheduleNote' && !item.date) return false;
                            return true;
                        });
                        exportData.data[entityName] = parsed;
                    } catch (e) {
                        console.log(`Could not export ${entityName}:`, e.message);
                        exportData.data[entityName] = [];
                    }
                }
                
                return Response.json(exportData);
            } finally {
                await connection.end();
            }
        }

        return Response.json({ error: "Invalid action" }, { status: 400 });

    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});