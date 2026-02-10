import express from 'express';
import crypto from 'crypto';
import { db } from '../index.js';
import { authMiddleware, adminMiddleware } from './auth.js';
import { sendEmail, getTransporter } from '../utils/email.js';

const router = express.Router();
router.use(authMiddleware);

// ===== GET STAFF LIST =====
router.get('/', async (req, res, next) => {
  try {
    const dbPool = req.db || db;
    const [rows] = await dbPool.execute('SELECT * FROM Doctor ORDER BY name');
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

// ===== NOTIFY STAFF =====
router.post('/notify', async (req, res, next) => {
  try {
    const { staffIds, message, type } = req.body;
    
    if (!staffIds || !message) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }
    
    console.log(`Sending ${type} notification to ${staffIds.length} staff members`);
    res.json({ success: true, notified: staffIds.length });
  } catch (error) {
    next(error);
  }
});

// ===== SEND GENERIC EMAIL (replaces base44.integrations.Core.SendEmail) =====
router.post('/send-email', async (req, res, next) => {
  try {
    const { to, subject, body: textBody, html } = req.body;

    if (!to || !subject) {
      return res.status(400).json({ error: 'Empfänger (to) und Betreff (subject) erforderlich' });
    }

    // Check SMTP configuration
    if (!getTransporter()) {
      return res.status(503).json({ 
        error: 'SMTP nicht konfiguriert. Bitte SMTP_HOST, SMTP_USER, SMTP_PASS als Umgebungsvariablen setzen.' 
      });
    }

    await sendEmail({
      to,
      subject,
      text: textBody,
      html,
    });

    res.json({ success: true, message: `E-Mail an ${to} gesendet` });
  } catch (error) {
    console.error('[send-email] Fehler:', error.message);
    next(error);
  }
});

// ===== SEND SCHEDULE NOTIFICATIONS (replaces sendShiftEmails function) =====
router.post('/schedule-notifications', async (req, res, next) => {
  try {
    const { year, month } = req.body;
    const dbPool = req.db || db;

    // Check SMTP
    if (!getTransporter()) {
      return res.status(503).json({ 
        error: 'SMTP nicht konfiguriert. Bitte SMTP_HOST, SMTP_USER, SMTP_PASS als Umgebungsvariablen setzen.' 
      });
    }

    // 1. Fetch doctors with email
    // Dienstplan-Kalender-Emails gehen an die Kalender-E-Mail-Adresse (google_email)
    const [doctors] = await dbPool.execute("SELECT * FROM Doctor WHERE google_email IS NOT NULL AND google_email != ''");
    if (doctors.length === 0) {
      return res.json({ success: true, count: 0, message: 'Keine Ärzte mit E-Mail gefunden', errors: [], debug: [] });
    }

    // 2. Fetch workplaces (service category)
    const [workplaces] = await dbPool.execute("SELECT * FROM Workplace");
    const serviceNames = workplaces
      .filter(w => w.category === 'Dienste')
      .map(w => w.name);
    if (serviceNames.length === 0) {
      serviceNames.push('Dienst Vordergrund', 'Dienst Hintergrund', 'Spätdienst');
    }

    // 3. Determine date range
    let startDate, endDate;
    if (month !== undefined && year !== undefined) {
      startDate = `${year}-${String(month + 1).padStart(2, '0')}-01`;
      const lastDay = new Date(year, month + 1, 0).getDate();
      endDate = `${year}-${String(month + 1).padStart(2, '0')}-${lastDay}`;
    } else {
      const today = new Date();
      startDate = today.toISOString().slice(0, 10);
      endDate = null;
    }

    // 4. Fetch shifts
    let shifts;
    if (endDate) {
      const [rows] = await dbPool.execute(
        'SELECT * FROM ShiftEntry WHERE date >= ? AND date <= ? ORDER BY date',
        [startDate, endDate]
      );
      shifts = rows;
    } else {
      const [rows] = await dbPool.execute(
        'SELECT * FROM ShiftEntry WHERE date >= ? ORDER BY date',
        [startDate]
      );
      shifts = rows;
    }

    // 5. Group shifts by doctor
    const shiftsByDoctor = {};
    shifts.forEach(shift => {
      if (!shiftsByDoctor[shift.doctor_id]) {
        shiftsByDoctor[shift.doctor_id] = [];
      }
      shiftsByDoctor[shift.doctor_id].push(shift);
    });

    let sentCount = 0;
    const errors = [];
    const debugLog = [];

    debugLog.push(`Found ${doctors.length} doctors with email.`);
    debugLog.push(`Found ${shifts.length} shifts in range.`);

    const formatter = new Intl.DateTimeFormat('de-DE', {
      weekday: 'long',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });

    // Helper: ICS generation
    const generateICS = (docShifts) => {
      const events = docShifts.map(shift => {
        const d = new Date(shift.date);
        if (isNaN(d.getTime())) return '';
        const dateStr = d.toISOString().split('T')[0].replace(/-/g, '');
        const nextDay = new Date(d);
        nextDay.setDate(nextDay.getDate() + 1);
        const nextDayStr = nextDay.toISOString().split('T')[0].replace(/-/g, '');

        return [
          'BEGIN:VEVENT',
          `UID:${shift.id}@curaflow`,
          `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}Z`,
          `DTSTART;VALUE=DATE:${dateStr}`,
          `DTEND;VALUE=DATE:${nextDayStr}`,
          `SUMMARY:${shift.position}`,
          `DESCRIPTION:Eingeteilter Dienst: ${shift.position}`,
          'END:VEVENT'
        ].join('\r\n');
      }).filter(Boolean).join('\r\n');

      return [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//CuraFlow//NONSGML v1.0//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        events,
        'END:VCALENDAR'
      ].join('\r\n');
    };

    // 6. Send emails per doctor
    for (const doctor of doctors) {
      try {
        const docShifts = shiftsByDoctor[doctor.id];
        if (!docShifts || docShifts.length === 0) {
          debugLog.push(`${doctor.name}: Keine Schichten gefunden.`);
          continue;
        }

        // Only service shifts
        const relevantShifts = docShifts.filter(s => serviceNames.includes(s.position));
        if (relevantShifts.length === 0) {
          debugLog.push(`${doctor.name}: Keine relevanten Dienste.`);
          continue;
        }

        relevantShifts.sort((a, b) => new Date(a.date) - new Date(b.date));

        const dateList = relevantShifts.map(s => {
          const date = new Date(s.date);
          if (isNaN(date.getTime())) return `- ${s.date} (Ungültiges Datum): ${s.position}`;
          return `- ${formatter.format(date)}: ${s.position}`;
        }).join('\n');

        // Generate ICS as attachment
        const icsContent = generateICS(relevantShifts);

        const subject = `[CuraFlow] Dein aktueller Dienstplan`;
        let text = `Hallo ${doctor.name},\n\n`;
        text += `Hier ist eine Übersicht deiner kommenden Dienste:\n\n${dateList}`;
        text += `\n\nIm Anhang findest du eine Kalender-Datei (.ics) zum Importieren.`;
        text += `\n\nViele Grüße,\nDein CuraFlow-System`;

        const email = doctor.google_email.trim();
        debugLog.push(`Sende E-Mail an ${doctor.name} (${email})...`);

        await sendEmail({
          to: email,
          subject,
          text,
          attachments: [{
            filename: `dienstplan_${doctor.initials || doctor.name.replace(/\s+/g, '_')}.ics`,
            content: icsContent,
            contentType: 'text/calendar'
          }]
        });

        sentCount++;
        debugLog.push(`Erfolgreich gesendet an ${doctor.name} (${email})`);
      } catch (e) {
        console.error(`[schedule-notifications] Fehler bei ${doctor.name}:`, e.message);
        errors.push({ doctor: doctor.name, error: e.message });
        debugLog.push(`Fehler bei ${doctor.name}: ${e.message}`);
      }
    }

    // 7. Log result
    try {
      const id = crypto.randomUUID();
      await dbPool.execute(
        'INSERT INTO SystemLog (id, level, source, message, details, created_date) VALUES (?, ?, ?, ?, ?, NOW())',
        [id, errors.length > 0 ? 'warning' : 'success', 'EmailNotification',
         `E-Mail-Versand abgeschlossen. Gesendet: ${sentCount}, Fehler: ${errors.length}`,
         JSON.stringify({ errors, debug: debugLog })]
      ).catch(() => {}); // SystemLog table might not exist
    } catch (e) { /* ignore */ }

    res.json({ success: true, count: sentCount, errors, debug: debugLog });
  } catch (error) {
    console.error('[schedule-notifications] Fehler:', error.message);
    next(error);
  }
});

// ===== SEND SHIFT NOTIFICATION (single shift change notification) =====
router.post('/shift-notification', async (req, res, next) => {
  try {
    const { doctor_id, date, position, type: notifType, message } = req.body;
    const dbPool = req.db || db;

    if (!doctor_id) {
      return res.status(400).json({ error: 'doctor_id erforderlich' });
    }

    // Check SMTP
    if (!getTransporter()) {
      return res.status(503).json({ error: 'SMTP nicht konfiguriert' });
    }

    // Benachrichtigungen gehen an die Benachrichtigungs-E-Mail-Adresse (email)
    const [doctors] = await dbPool.execute('SELECT * FROM Doctor WHERE id = ?', [doctor_id]);
    if (doctors.length === 0) {
      return res.status(404).json({ error: 'Arzt nicht gefunden' });
    }

    const doctor = doctors[0];
    if (!doctor.email) {
      return res.json({ success: false, message: 'Keine Benachrichtigungs-E-Mail-Adresse hinterlegt' });
    }

    const formatter = new Intl.DateTimeFormat('de-DE', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    const dateFormatted = date ? formatter.format(new Date(date)) : '';
    const subject = `[CuraFlow] ${notifType === 'new' ? 'Neuer Dienst' : 'Dienständerung'}${date ? ` am ${dateFormatted}` : ''}`;

    let text = `Hallo ${doctor.name},\n\n`;
    if (message) {
      text += message;
    } else {
      text += notifType === 'new'
        ? `Dir wurde ein neuer Dienst zugewiesen: ${position || ''} am ${dateFormatted}.`
        : `Es gab eine Änderung an deinem Dienstplan für den ${dateFormatted}.`;
    }
    text += `\n\nViele Grüße,\nDein CuraFlow-System`;

    await sendEmail({
      to: doctor.email.trim(),
      subject,
      text,
    });

    res.json({ success: true, message: `Benachrichtigung an ${doctor.name} gesendet` });
  } catch (error) {
    console.error('[shift-notification] Fehler:', error.message);
    next(error);
  }
});

// ===== SMTP STATUS CHECK =====
router.get('/email-status', async (req, res) => {
  const configured = !!getTransporter();
  res.json({ 
    smtp_configured: configured,
    smtp_host: process.env.SMTP_HOST || null,
    smtp_user: process.env.SMTP_USER ? '***' : null, 
  });
});

export default router;
