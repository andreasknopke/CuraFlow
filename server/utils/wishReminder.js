import { addMonths, subDays, format, startOfMonth, endOfMonth, isSameDay } from 'date-fns';
import { de } from 'date-fns/locale';
import crypto from 'crypto';
import { sendEmail } from '../utils/email.js';
import config from '../config.js';

/**
 * Checks if a wish reminder email should be sent today and sends it.
 *
 * Logic:
 * - wish_deadline_months = N means the next N months are already locked/finalized
 * - In month X, users can submit wishes earliest for month X + (N + 1)
 * - Reminder is sent exactly 7 days before end of current month
 * - This gives users one final week in month X to submit for target month X + (N + 1)
 *
 * @param {import('mysql2/promise').Pool} dbPool - MySQL connection pool
 * @param {string} [contextLabel='default'] - Label for logging (e.g. tenant name)
 */
export async function checkAndSendWishReminders(dbPool, contextLabel = 'default') {
  try {
    // 1. Read settings
    const [settingsRows] = await dbPool.execute(
      "SELECT `key`, `value` FROM SystemSetting WHERE `key` IN ('wish_deadline_months', 'wish_reminder_email_enabled', 'wish_reminder_last_sent')",
    );

    const settings = {};
    for (const row of settingsRows) {
      settings[row.key] = row.value;
    }

    const reminderEnabled = settings['wish_reminder_email_enabled'] === 'true';
    const deadlineMonths = parseInt(settings['wish_deadline_months']);

    if (!reminderEnabled || !deadlineMonths || deadlineMonths <= 0) {
      return { skipped: true, reason: 'Reminder not enabled or no deadline configured' };
    }

    // 2. Determine if today is a reminder day
    // Reminder is sent one week before end of current month
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const currentMonthEnd = endOfMonth(today);
    const reminderDay = subDays(currentMonthEnd, 7);

    if (!isSameDay(today, reminderDay)) {
      return { skipped: true, reason: 'Today is not a reminder day' };
    }

    // Target month is first month after locked horizon
    const targetMonth = startOfMonth(addMonths(today, deadlineMonths + 1));
    const sperrtermin = currentMonthEnd;

    // 3. Check if we already sent for this target month
    const targetKey = format(targetMonth, 'yyyy-MM');
    const lastSent = settings['wish_reminder_last_sent'] || '';
    if (lastSent === targetKey) {
      return { skipped: true, reason: `Reminder already sent for ${targetKey}` };
    }

    // 4. Get all doctors with email
    // Erinnerungsmails gehen an die Benachrichtigungs-E-Mail-Adresse (email)
    const [doctors] = await dbPool.execute(
      "SELECT id, name, email FROM Doctor WHERE email IS NOT NULL AND email != ''",
    );

    if (doctors.length === 0) {
      return { skipped: true, reason: 'No doctors with email found' };
    }

    // 5. Send emails
    const targetMonthFormatted = format(targetMonth, 'MMMM yyyy', { locale: de });
    const sperrterminFormatted = format(sperrtermin, 'dd.MM.yyyy');

    // Build base URL for ack links
    const apiBaseUrl = (
      process.env.API_URL || config.railway.publicDomain
        ? `https://${config.railway.publicDomain}`
        : 'http://localhost:3000'
    ).replace(/\/+$/, '');

    let sentCount = 0;
    const errors = [];

    for (const doctor of doctors) {
      try {
        // Generate unique token for this doctor / target month
        const token = crypto.randomBytes(32).toString('hex');
        const ackId = crypto.randomUUID();

        // Store ack record
        await dbPool.execute(
          "INSERT INTO WishReminderAck (id, doctor_id, target_month, token, status, created_date) VALUES (?, ?, ?, ?, 'sent', NOW())",
          [ackId, doctor.id, targetKey, token],
        );

        const ackUrl = `${apiBaseUrl}/api/wish-ack?token=${token}`;

        const subject = `[CuraFlow] Erinnerung: Dienstwünsche für ${targetMonthFormatted} eintragen`;
        const text = [
          `Hallo ${doctor.name},`,
          '',
          `dies ist eine freundliche Erinnerung, dass der Eintragungszeitraum für Dienstwünsche für ${targetMonthFormatted} in einer Woche endet.`,
          '',
          `📅 Sperrtermin: ${sperrterminFormatted}`,
          '',
          `Bitte tragen Sie Ihre Dienstwünsche rechtzeitig im System ein. Nach dem Sperrtermin können keine Wünsche mehr eingereicht werden.`,
          '',
          `Falls Sie KEINE Dienstwünsche haben, bestätigen Sie dies bitte mit folgendem Link:`,
          ackUrl,
          '',
          `Viele Grüße,`,
          `Ihr CuraFlow-System`,
        ].join('\n');

        const html = `
          <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;color:#1e293b">
            <h2 style="color:#4f46e5">Erinnerung: Dienstwünsche eintragen</h2>
            <p>Hallo <strong>${doctor.name}</strong>,</p>
            <p>dies ist eine freundliche Erinnerung, dass der Eintragungszeitraum für Dienstwünsche für <strong>${targetMonthFormatted}</strong> in einer Woche endet.</p>
            <div style="background:#f1f5f9;border-radius:8px;padding:16px;margin:20px 0;border-left:4px solid #4f46e5">
              <strong>📅 Sperrtermin: ${sperrterminFormatted}</strong>
            </div>
            <p>Bitte tragen Sie Ihre Dienstwünsche rechtzeitig im System ein. Nach dem Sperrtermin können keine Wünsche mehr eingereicht werden.</p>
            <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0">
            <p style="color:#64748b">Falls Sie <strong>keine Dienstwünsche</strong> haben, bestätigen Sie dies bitte:</p>
            <div style="text-align:center;margin:24px 0">
              <a href="${ackUrl}" style="display:inline-block;background:#16a34a;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:16px">
                ✓ Gelesen, keine Wünsche
              </a>
            </div>
            <p style="font-size:13px;color:#94a3b8;margin-top:32px">Diese E-Mail wurde automatisch von CuraFlow versendet.</p>
          </div>
        `;

        await sendEmail({
          to: doctor.email.trim(),
          subject,
          text,
          html,
        });

        sentCount++;
      } catch (err) {
        console.error(
          `[WishReminder][${contextLabel}] Fehler beim Senden an ${doctor.name}:`,
          err.message,
        );
        errors.push({ doctor: doctor.name, error: err.message });
      }
    }

    // 6. Record that we sent the reminder for this target month
    const [existing] = await dbPool.execute(
      "SELECT id FROM SystemSetting WHERE `key` = 'wish_reminder_last_sent'",
    );
    if (existing.length > 0) {
      await dbPool.execute(
        "UPDATE SystemSetting SET `value` = ? WHERE `key` = 'wish_reminder_last_sent'",
        [targetKey],
      );
    } else {
      await dbPool.execute(
        "INSERT INTO SystemSetting (id, `key`, `value`, created_date) VALUES (?, 'wish_reminder_last_sent', ?, NOW())",
        [crypto.randomUUID(), targetKey],
      );
    }

    console.log(
      `[WishReminder][${contextLabel}] Erinnerung für ${targetMonthFormatted} gesendet: ${sentCount} Mails, ${errors.length} Fehler`,
    );

    return {
      sent: true,
      targetMonth: targetKey,
      sperrtermin: sperrterminFormatted,
      sentCount,
      errors,
    };
  } catch (err) {
    console.error(`[WishReminder][${contextLabel}] Fehler:`, err.message);
    return { error: err.message };
  }
}
