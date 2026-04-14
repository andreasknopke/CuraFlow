import express from 'express';
import { db } from '../../db/pool.js';
import { runMasterMigrations } from '../../utils/masterMigrations.js';
import { runTenantMigrations } from '../../utils/tenantMigrations.js';

const router = express.Router();

router.post('/run-migrations', async (req, res, next) => {
  try {
    const results = await runMasterMigrations(db);

    console.log(`[Migrations] Executed by ${req.user?.email}:`, results);

    res.json({
      success: true,
      message: 'Migrationen ausgeführt',
      results,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/migration-status', async (req, res, next) => {
  try {
    const [columns] = await db.execute('SHOW COLUMNS FROM app_users');
    const columnNames = columns.map((column) => column.Field);

    const migrations = [
      {
        name: 'add_allowed_tenants',
        description: 'Mandanten-Zuordnung für User',
        applied: columnNames.includes('allowed_tenants'),
      },
      {
        name: 'add_must_change_password',
        description: 'Passwort-Änderung erzwingen',
        applied: columnNames.includes('must_change_password'),
      },
      {
        name: 'add_email_verified',
        description: 'E-Mail-Verifizierung für Benutzer',
        applied:
          columnNames.includes('email_verified') && columnNames.includes('email_verified_date'),
      },
      {
        name: 'add_last_seen_at',
        description: 'Praesenz-Zeitstempel fuer CoWork',
        applied: columnNames.includes('last_seen_at'),
      },
      {
        name: 'add_schedule_initials_only',
        description: 'Ansichtseinstellung nur fuer Kuerzel',
        applied: columnNames.includes('schedule_initials_only'),
      },
      {
        name: 'add_schedule_sort_doctors_alphabetically',
        description: 'Ansichtseinstellung fuer alphabetische Mitarbeitersortierung',
        applied: columnNames.includes('schedule_sort_doctors_alphabetically'),
      },
    ];

    let emailVerificationTableExists = false;
    try {
      const [tables] = await db.execute("SHOW TABLES LIKE 'EmailVerification'");
      emailVerificationTableExists = tables.length > 0;
    } catch (error) {
      // ignore
    }
    migrations.push({
      name: 'create_email_verification_table',
      description: 'E-Mail-Verifizierung & Passwort-Versand Tabelle',
      applied: emailVerificationTableExists,
    });

    let coworkInviteTableExists = false;
    try {
      const [tables] = await db.execute("SHOW TABLES LIKE 'CoWorkInvite'");
      coworkInviteTableExists = tables.length > 0;
    } catch (error) {
      // ignore
    }
    migrations.push({
      name: 'create_cowork_invite_table',
      description: 'CoWork-Einladungen fuer Support-Sessions',
      applied: coworkInviteTableExists,
    });

    res.json({
      migrations,
      allApplied: migrations.every((migration) => migration.applied),
    });
  } catch (error) {
    next(error);
  }
});

router.post('/run-timeslot-migrations', async (req, res, next) => {
  try {
    const dbPool = req.db || db;
    const cacheKey = req.headers['x-db-token'] || 'default';
    const results = await runTenantMigrations(dbPool, cacheKey);

    console.log(`[Timeslot Migrations] Executed by ${req.user?.email}:`, results);

    res.json({
      success: true,
      message: 'Timeslot-Migrationen ausgeführt',
      results,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/timeslot-migration-status', async (req, res, next) => {
  try {
    const dbPool = req.db || db;
    const migrations = [];

    try {
      const [tables] = await dbPool.execute("SHOW TABLES LIKE 'WorkplaceTimeslot'");
      migrations.push({
        name: 'create_workplace_timeslot_table',
        description: 'Erstellt WorkplaceTimeslot-Tabelle',
        applied: tables.length > 0,
      });
    } catch (error) {
      migrations.push({
        name: 'create_workplace_timeslot_table',
        description: 'Erstellt WorkplaceTimeslot-Tabelle',
        applied: false,
        error: error.message,
      });
    }

    try {
      const [columns] = await dbPool.execute('SHOW COLUMNS FROM Workplace');
      const columnNames = columns.map((column) => column.Field);

      migrations.push({
        name: 'add_workplace_timeslots_enabled',
        description: 'Aktiviert Zeitfenster-Option pro Arbeitsplatz',
        applied: columnNames.includes('timeslots_enabled'),
      });

      migrations.push({
        name: 'add_workplace_overlap_tolerance',
        description: 'Übergangszeit-Einstellung pro Arbeitsplatz',
        applied: columnNames.includes('default_overlap_tolerance_minutes'),
      });

      migrations.push({
        name: 'add_workplace_work_time_percentage',
        description: 'Arbeitszeit-Prozentsatz pro Dienst (z.B. Rufbereitschaft = 70%)',
        applied: columnNames.includes('work_time_percentage'),
      });

      migrations.push({
        name: 'add_workplace_affects_availability',
        description:
          'Verfügbarkeitsrelevanz pro Arbeitsplatz (z.B. Demo Chirurgie = nicht relevant)',
        applied: columnNames.includes('affects_availability'),
      });
    } catch (error) {
      migrations.push({
        name: 'workplace_columns',
        description: 'Workplace-Spalten prüfen',
        applied: false,
        error: error.message,
      });
    }

    try {
      const [columns] = await dbPool.execute('SHOW COLUMNS FROM ShiftEntry');
      const columnNames = columns.map((column) => column.Field);

      migrations.push({
        name: 'add_shiftentry_timeslot_id',
        description: 'Timeslot-Zuordnung für ShiftEntries',
        applied: columnNames.includes('timeslot_id'),
      });

      migrations.push({
        name: 'add_shiftentry_start_time',
        description: 'Automatisch berechnete Startzeit pro Schicht',
        applied: columnNames.includes('start_time'),
      });

      migrations.push({
        name: 'add_shiftentry_end_time',
        description: 'Automatisch berechnete Endzeit pro Schicht',
        applied: columnNames.includes('end_time'),
      });

      migrations.push({
        name: 'add_shiftentry_break_minutes',
        description: 'Pausenminuten pro Schicht',
        applied: columnNames.includes('break_minutes'),
      });
    } catch (error) {
      migrations.push({
        name: 'shiftentry_columns',
        description: 'ShiftEntry-Spalten prüfen',
        applied: false,
        error: error.message,
      });
    }

    try {
      const [columns] = await dbPool.execute('SHOW COLUMNS FROM TeamRole');
      const columnNames = columns.map((column) => column.Field);

      migrations.push({
        name: 'add_team_role_permissions',
        description:
          'Dynamische Berechtigungen für Team-Rollen (VG/HG-Dienste, Statistik-Ausschluss)',
        applied:
          columnNames.includes('can_do_foreground_duty') &&
          columnNames.includes('can_do_background_duty') &&
          columnNames.includes('excluded_from_statistics'),
      });
    } catch (error) {
      migrations.push({
        name: 'teamrole_columns',
        description: 'TeamRole-Spalten prüfen',
        applied: false,
        error: error.message,
      });
    }

    try {
      const [columns] = await dbPool.execute(
        "SHOW COLUMNS FROM Workplace WHERE Field = 'service_type'",
      );
      migrations.push({
        name: 'add_workplace_service_type',
        description:
          'Diensttyp pro Dienst (Bereitschaftsdienst/Rufbereitschaft/Schichtdienst/Andere)',
        applied: columns.length > 0,
      });
    } catch (error) {
      migrations.push({
        name: 'add_workplace_service_type',
        description: 'Diensttyp pro Dienst',
        applied: false,
        error: error.message,
      });
    }

    try {
      const [columns] = await dbPool.execute(
        "SHOW COLUMNS FROM Doctor WHERE Field = 'central_employee_id'",
      );
      migrations.push({
        name: 'add_doctor_central_employee_id',
        description: 'Verknüpfung zur zentralen Mitarbeiterverwaltung',
        applied: columns.length > 0,
      });
    } catch (error) {
      migrations.push({
        name: 'add_doctor_central_employee_id',
        description: 'Verknüpfung zur zentralen Mitarbeiterverwaltung',
        applied: false,
        error: error.message,
      });
    }

    try {
      const [columns] = await dbPool.execute(
        "SHOW COLUMNS FROM Doctor WHERE Field = 'work_time_model_id'",
      );
      migrations.push({
        name: 'add_doctor_work_time_model_id',
        description: 'Arbeitszeitmodell-Zuordnung pro Mitarbeiter',
        applied: columns.length > 0,
      });
    } catch (error) {
      migrations.push({
        name: 'add_doctor_work_time_model_id',
        description: 'Arbeitszeitmodell-Zuordnung pro Mitarbeiter',
        applied: false,
        error: error.message,
      });
    }

    try {
      const [tables] = await dbPool.execute("SHOW TABLES LIKE 'ShiftTimeRule'");
      migrations.push({
        name: 'create_shift_time_rule_table',
        description: 'Schichtzeitregeln pro Arbeitsplatz und Arbeitszeitmodell',
        applied: tables.length > 0,
      });
    } catch (error) {
      migrations.push({
        name: 'create_shift_time_rule_table',
        description: 'Schichtzeitregeln pro Arbeitsplatz und Arbeitszeitmodell',
        applied: false,
        error: error.message,
      });
    }

    res.json({
      migrations,
      allApplied: migrations.every((migration) => migration.applied),
    });
  } catch (error) {
    next(error);
  }
});

export default router;
