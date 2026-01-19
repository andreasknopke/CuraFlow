import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
import mysql from 'npm:mysql2@^3.9.0/promise';

// Helper to get MySQL connection
const getMysqlConnection = async () => {
    try {
        return await mysql.createConnection({
            host: Deno.env.get('MYSQL_HOST')?.trim(),
            user: Deno.env.get('MYSQL_USER')?.trim(),
            password: Deno.env.get('MYSQL_PASSWORD')?.trim(),
            database: Deno.env.get('MYSQL_DATABASE')?.trim(),
            port: parseInt(Deno.env.get('MYSQL_PORT')?.trim() || '3306'),
            dateStrings: true
        });
    } catch (e) {
        console.error("MySQL Connection Failed:", e);
        return null;
    }
};

// Helper to get db_mode
const getDbMode = async (base44) => {
    try {
        const settings = await base44.entities.SystemSetting.list();
        const modeSetting = settings.find(s => s.key === 'db_mode');
        return modeSetting?.value || 'internal';
    } catch {
        return 'internal';
    }
};

Deno.serve(async (req) => {
    let connection = null;
    
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Only admins should be able to rename positions as it affects all data
        if (user.role !== 'admin') {
            return Response.json({ error: 'Forbidden' }, { status: 403 });
        }

        const { oldName, newName } = await req.json();

        if (!oldName || !newName) {
            return Response.json({ error: 'Missing parameters' }, { status: 400 });
        }

        const dbMode = await getDbMode(base44);
        let shiftsUpdated = 0;
        let notesUpdated = 0;
        let rotationsUpdated = 0;

        if (dbMode === 'mysql') {
            // Use MySQL directly
            connection = await getMysqlConnection();
            if (!connection) {
                return Response.json({ error: 'MySQL connection failed' }, { status: 500 });
            }

            // Update ShiftEntry
            const [r1] = await connection.execute(
                'UPDATE ShiftEntry SET position = ? WHERE position = ?',
                [newName, oldName]
            );
            shiftsUpdated = r1.affectedRows;

            // Update ScheduleNote
            const [r2] = await connection.execute(
                'UPDATE ScheduleNote SET position = ? WHERE position = ?',
                [newName, oldName]
            );
            notesUpdated = r2.affectedRows;

            // Update TrainingRotation (modality field)
            const [r3] = await connection.execute(
                'UPDATE TrainingRotation SET modality = ? WHERE modality = ?',
                [newName, oldName]
            );
            rotationsUpdated = r3.affectedRows;

        } else {
            // Use Base44 SDK
            const shifts = await base44.entities.ShiftEntry.filter({ position: oldName }, null, 5000);
            const updatePromises = shifts.map(shift => 
                base44.entities.ShiftEntry.update(shift.id, { position: newName })
            );
            await Promise.all(updatePromises);
            shiftsUpdated = shifts.length;

            // Also update ScheduleNotes
            const notes = await base44.entities.ScheduleNote.filter({ position: oldName }, null, 5000);
            const updateNotesPromises = notes.map(note => 
                base44.entities.ScheduleNote.update(note.id, { position: newName })
            );
            await Promise.all(updateNotesPromises);
            notesUpdated = notes.length;

            // Also update TrainingRotations (modality field)
            const rotations = await base44.entities.TrainingRotation.filter({ modality: oldName }, null, 5000);
            const updateRotationsPromises = rotations.map(rot => 
                base44.entities.TrainingRotation.update(rot.id, { modality: newName })
            );
            await Promise.all(updateRotationsPromises);
            rotationsUpdated = rotations.length;
        }

        const stats = { 
            updatedShifts: shiftsUpdated, 
            updatedNotes: notesUpdated,
            updatedRotations: rotationsUpdated,
            dbMode
        };

        try {
            await base44.asServiceRole.entities.SystemLog.create({
                level: 'success',
                source: 'RenamePosition',
                message: `Renamed "${oldName}" to "${newName}"`,
                details: JSON.stringify(stats)
            });
        } catch (e) { console.error("Log failed", e); }

        return Response.json({ 
            success: true, 
            ...stats
        });

    } catch (error) {
        try {
            await base44.asServiceRole.entities.SystemLog.create({
                level: 'error',
                source: 'RenamePosition',
                message: `Failed to rename position`,
                details: JSON.stringify({ error: error.message })
            });
        } catch (e) { console.error("Log failed", e); }

        return Response.json({ error: error.message }, { status: 500 });
    } finally {
        if (connection) await connection.end();
    }
});