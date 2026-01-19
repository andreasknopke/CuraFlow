import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
import mysql from 'npm:mysql2@^3.9.0/promise';

// Helper to get MySQL connection
const getMysqlConnection = async () => {
    return await mysql.createConnection({
        host: Deno.env.get('MYSQL_HOST')?.trim(),
        user: Deno.env.get('MYSQL_USER')?.trim(),
        password: Deno.env.get('MYSQL_PASSWORD')?.trim(),
        database: Deno.env.get('MYSQL_DATABASE')?.trim(),
        port: parseInt(Deno.env.get('MYSQL_PORT')?.trim() || '3306'),
        dateStrings: true
    });
};

// Helper to query data directly from MySQL
const queryData = async (entity, action, options = {}) => {
    const connection = await getMysqlConnection();
    try {
        let sql = `SELECT * FROM \`${entity}\``;
        const params = [];
        
        if (action === 'filter' && options.query) {
            const conditions = Object.entries(options.query).map(([key, value]) => {
                params.push(value);
                return `\`${key}\` = ?`;
            });
            if (conditions.length > 0) {
                sql += ` WHERE ${conditions.join(' AND ')}`;
            }
        }
        
        if (options.sort) {
            const sortField = options.sort.startsWith('-') ? options.sort.substring(1) : options.sort;
            const sortDir = options.sort.startsWith('-') ? 'DESC' : 'ASC';
            sql += ` ORDER BY \`${sortField}\` ${sortDir}`;
        }
        
        if (options.limit) {
            sql += ` LIMIT ${parseInt(options.limit)}`;
        }
        
        const [rows] = await connection.execute(sql, params);
        return rows;
    } finally {
        await connection.end();
    }
};

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        const user = await base44.auth.me();
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        let params = {};
        try { params = await req.json(); } catch (e) {}
        const { month, year } = params;

        // 1. Fetch all doctors (directly from MySQL)
        const doctors = await queryData('Doctor', 'list', { limit: 1000 });
        if (!doctors) throw new Error("Could not fetch doctors");

        const doctorsWithEmail = doctors.filter(d => d.google_email);
        if (doctorsWithEmail.length === 0) {
            return Response.json({ count: 0, message: "No doctors with email found" });
        }

        // 1.5 Fetch workplaces to identify services (directly from MySQL)
        const workplaces = await queryData('Workplace', 'list', { limit: 1000 });
        const serviceNames = workplaces
            .filter(w => w.category === 'Dienste')
            .map(w => w.name);

        // Fallback if no services configured
        if (serviceNames.length === 0) {
            serviceNames.push('Dienst Vordergrund', 'Dienst Hintergrund', 'Spätdienst');
        }

        // 2. Fetch shifts (directly from MySQL)
        const shifts = await queryData('ShiftEntry', 'list', { limit: 5000 });
        if (!Array.isArray(shifts)) {
            throw new Error("Failed to fetch shifts list");
        }

        let startDate, endDate;
        if (month !== undefined && year !== undefined) {
            // Specific month (month is 0-indexed)
            startDate = new Date(Date.UTC(year, month, 1));
            endDate = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));
        } else {
            // Fallback: Future shifts
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            startDate = today;
        }

        // Filter shifts
        const targetShifts = shifts.filter(s => {
             if (!s.date) return false;
             const d = new Date(s.date);
             if (isNaN(d.getTime())) return false; // Invalid date check

             // Compare using time value
             if (d < startDate) return false;
             if (endDate && d > endDate) return false;
             return true;
        });

        // 3. Group shifts by doctor
        const shiftsByDoctor = {};
        targetShifts.forEach(shift => {
            if (!shiftsByDoctor[shift.doctor_id]) {
                shiftsByDoctor[shift.doctor_id] = [];
            }
            shiftsByDoctor[shift.doctor_id].push(shift);
        });

        let sentCount = 0;
        const errors = [];
        const debugLog = [];

        debugLog.push(`Found ${doctorsWithEmail.length} doctors with email.`);
        debugLog.push(`Found ${targetShifts.length} shifts in range.`);

        // Date formatter (native, no external deps)
        const formatter = new Intl.DateTimeFormat('de-DE', {
            weekday: 'long',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });

        // Helper to generate ICS content
        const generateICS = (shifts) => {
            const events = shifts.map(shift => {
                const d = new Date(shift.date);
                if (isNaN(d.getTime())) return ''; 

                // Use parsed date for robust YYYYMMDD generation
                const dateStr = d.toISOString().split('T')[0].replaceAll('-', '');
                
                // Calculate next day for DTEND (all day events require end date = start date + 1)
                const nextDay = new Date(d);
                nextDay.setHours(12); // Avoid timezone shifting issues
                nextDay.setDate(nextDay.getDate() + 1);
                const nextDayStr = nextDay.toISOString().split('T')[0].replaceAll('-', '');
                
                return [
                    'BEGIN:VEVENT',
                    `UID:${shift.id}@radioplan`,
                    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}Z`,
                    `DTSTART;VALUE=DATE:${dateStr}`,
                    `DTEND;VALUE=DATE:${nextDayStr}`,
                    `SUMMARY:${shift.position}`,
                    `DESCRIPTION:Eingeteilter Dienst: ${shift.position}`,
                    'END:VEVENT'
                ].join('\r\n');
            }).join('\r\n');

            return [
                'BEGIN:VCALENDAR',
                'VERSION:2.0',
                'PRODID:-//RadioPlan//NONSGML v1.0//EN',
                'CALSCALE:GREGORIAN',
                'METHOD:PUBLISH',
                events,
                'END:VCALENDAR'
            ].join('\r\n');
        };

        // 4. Send emails
        for (const doctor of doctorsWithEmail) {
            try {
                const docShifts = shiftsByDoctor[doctor.id];
                if (!docShifts || docShifts.length === 0) {
                    debugLog.push(`Doctor ${doctor.name}: No shifts found in range.`);
                    continue;
                }

                // Filter for Services (no Demos/Rotations)
                const relevantShifts = docShifts.filter(s => serviceNames.includes(s.position));

                if (relevantShifts.length === 0) {
                    debugLog.push(`Doctor ${doctor.name}: No relevant shifts found.`);
                    continue;
                }

                // Sort shifts by date
                relevantShifts.sort((a, b) => new Date(a.date) - new Date(b.date));

                const dateList = relevantShifts.map(s => {
                    const date = new Date(s.date);
                    if (isNaN(date.getTime())) return `- ${s.date} (Ungültiges Datum): ${s.position}`;
                    return `- ${formatter.format(date)}: ${s.position}`;
                }).join('\n');

                // Generate and upload ICS
                let icsUrl = "";
                try {
                    const icsContent = generateICS(relevantShifts);
                    const icsFile = new File([icsContent], `dienstplan_${doctor.initials || doctor.id}.ics`, { type: "text/calendar" });
                    
                    debugLog.push(`Uploading ICS for ${doctor.name}...`);
                    const uploadRes = await base44.integrations.Core.UploadFile({ file: icsFile });
                    icsUrl = uploadRes.file_url;
                    debugLog.push(`ICS uploaded: ${icsUrl}`);
                } catch (uploadError) {
                    console.error("Failed to upload ICS", uploadError);
                    debugLog.push(`Failed to upload ICS: ${uploadError.message}`);
                }

                const subject = `Dein aktueller Dienstplan`;
                let body = `Hallo ${doctor.name},\n\n`;
                
                if (icsUrl) {
                    body += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
                    body += `📅 KALENDER-DATEI ZUM IMPORTIEREN:\n`;
                    body += `${icsUrl}\n`;
                    body += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
                }
                
                body += `Hier ist eine Übersicht deiner kommenden Dienste:\n\n${dateList}`;
                body += `\n\nViele Grüße,\nDein Dienstplaner`;

                const email = doctor.google_email.trim();
                debugLog.push(`Sending email to ${doctor.name} (${email})...`);

                // Removed from_name to rely on system default for better deliverability
                await base44.integrations.Core.SendEmail({
                    to: email,
                    subject: `[RadioPlan] ${subject}`,
                    body: body
                });
                sentCount++;
                debugLog.push(`Successfully sent to ${doctor.name} (${email})`);
            } catch (e) {
                console.error(`Failed to send email to ${doctor.name}:`, e);
                errors.push({ doctor: doctor.name, error: e.message });
                debugLog.push(`Error sending to ${doctor.name}: ${e.message}`);
            }
        }

        // Log the batch result
        try {
            const hasErrors = errors.length > 0;
            await base44.asServiceRole.entities.SystemLog.create({
                level: hasErrors ? 'warning' : 'success',
                source: 'EmailNotification',
                message: `Email batch finished. Sent: ${sentCount}, Errors: ${errors.length}`,
                details: JSON.stringify({ errors, debug: debugLog })
            });
        } catch (e) { console.error("Log failed", e); }

        return Response.json({ success: true, count: sentCount, errors: errors, debug: debugLog });

    } catch (error) {
        try {
            await base44.asServiceRole.entities.SystemLog.create({
                level: 'error',
                source: 'EmailNotification',
                message: 'Critical error in email batch',
                details: JSON.stringify({ error: error.message })
            });
        } catch (e) { console.error("Log failed", e); }

        return Response.json({ error: error.message }, { status: 500 });
    }
});