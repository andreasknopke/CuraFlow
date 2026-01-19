/**
 * User Migration Script
 * Migriert Base44 Benutzer in die MySQL Datenbank
 * 
 * Ausführen: node migrateUsers.js
 */

import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();

// Benutzer aus Base44 (Format: name, role, email, theme/active, active/collapsed, collapsed/doctor_id, settings/doctor_id)
const users = [
  {
    name: 'Dreamspell Publishing',
    email: 'andreasknopke@gmail.com',
    role: 'admin',
    password: 'CuraFlow2026!', // Neues sicheres Passwort
    theme: 'coffee',
    is_active: true,
    collapsed_sections: '[]',
    settings: '{"sections":[{"id":"misc","defaultName":"Sonstiges","order":0,"customName":"Wichtiges"},{"id":"services","defaultName":"Dienste","order":1,"customName":""},{"id":"rotations","defaultName":"Rotationen","order":2,"customName":""},{"id":"available","defaultName":"Anwesenheiten","order":3,"customName":""},{"id":"demos","defaultName":"Demonstrationen & Konsile","order":4,"customName":""},{"id":"absences","defaultName":"Abwesenheiten","order":5,"customName":""}]}'
  },
  {
    name: 'a.bebersdorf',
    email: 'a.bebersdorf@gmx.de',
    role: 'user',
    password: 'CuraFlow2026!',
    theme: 'teal',
    is_active: true,
    collapsed_sections: '["Anwesenheiten"]',
    doctor_id: null
  },
  {
    name: 'andreas.knopke',
    email: 'andreas.knopke@kliniksued-rostock.de',
    role: 'admin',
    password: 'CuraFlow2026!',
    theme: 'default',
    is_active: true,
    collapsed_sections: '[]',
    settings: '{"sections":[{"id":"misc","defaultName":"Sonstiges","order":0,"customName":"Wichtiges"},{"id":"services","defaultName":"Dienste","order":1,"customName":""},{"id":"rotations","defaultName":"Rotationen","order":2,"customName":""},{"id":"available","defaultName":"Anwesenheiten","order":3,"customName":""},{"id":"demos","defaultName":"Demonstrationen & Konsile","order":4,"customName":""},{"id":"absences","defaultName":"Abwesenheiten","order":5,"customName":""}]}'
  },
  {
    name: 'andreas',
    email: 'andreas@k-pacs.de',
    role: 'user',
    password: 'CuraFlow2026!',
    theme: 'default',
    is_active: true,
    collapsed_sections: '["Abwesenheiten"]',
    doctor_id: null
  },
  {
    name: 'anna.keipke',
    email: 'anna.keipke@gmx.de',
    role: 'user',
    password: 'CuraFlow2026!',
    theme: 'default',
    is_active: true,
    collapsed_sections: '[]',
    doctor_id: null
  },
  {
    name: 'annipanski',
    email: 'annipanski@googlemail.com',
    role: 'user',
    password: 'CuraFlow2026!',
    theme: 'default',
    is_active: true,
    collapsed_sections: '[]',
    doctor_id: null
  },
  {
    name: 'armang21',
    email: 'armang21@icloud.com',
    role: 'user',
    password: 'CuraFlow2026!',
    theme: 'default',
    is_active: true,
    collapsed_sections: '[]',
    doctor_id: null
  },
  {
    name: 'demo.radiologie',
    email: 'demo.radiologie@kliniksued-rostock.de',
    role: 'user',
    password: 'CuraFlow2026!',
    theme: 'default',
    is_active: true,
    collapsed_sections: '[]',
    settings: '{"sections":[{"id":"misc","defaultName":"Sonstiges","order":0,"customName":""},{"id":"services","defaultName":"Dienste","order":1,"customName":""},{"id":"rotations","defaultName":"Rotationen","order":2,"customName":""},{"id":"demos","defaultName":"Demonstrationen & Konsile","order":3,"customName":""},{"id":"absences","defaultName":"Abwesenheiten","order":4,"customName":""},{"id":"available","defaultName":"Anwesenheiten","order":5,"customName":""}]}'
  },
  {
    name: 'gescheschultek',
    email: 'gescheschultek@icloud.com',
    role: 'user',
    password: 'CuraFlow2026!',
    theme: 'default',
    is_active: true,
    collapsed_sections: '[]',
    doctor_id: null
  },
  {
    name: 'hansen174',
    email: 'hansen174@gmx.de',
    role: 'user',
    password: 'CuraFlow2026!',
    theme: 'default',
    is_active: true,
    collapsed_sections: '[]',
    doctor_id: null
  },
  {
    name: 'hasanarishe',
    email: 'hasanarishe@gmail.com',
    role: 'user',
    password: 'CuraFlow2026!',
    theme: 'default',
    is_active: true,
    collapsed_sections: '[]',
    doctor_id: null
  },
  {
    name: 'idrisdahmani5',
    email: 'idrisdahmani5@gmail.com',
    role: 'user',
    password: 'CuraFlow2026!',
    theme: 'default',
    is_active: true,
    collapsed_sections: '["Demonstrationen & Konsile"]',
    doctor_id: null
  },
  {
    name: 'julia',
    email: 'julia@schirrwagen.info',
    role: 'user',
    password: 'CuraFlow2026!',
    theme: 'forest',
    is_active: true,
    collapsed_sections: '[]',
    doctor_id: null
  },
  {
    name: 'lenard.strecke',
    email: 'lenard.strecke@web.de',
    role: 'user',
    password: 'CuraFlow2026!',
    theme: 'default',
    is_active: true,
    collapsed_sections: '[]',
    doctor_id: null
  },
  {
    name: 'parviz.rikhtehgar',
    email: 'parviz.rikhtehgar@web.de',
    role: 'user',
    password: 'CuraFlow2026!',
    theme: 'default',
    is_active: true,
    collapsed_sections: '[]',
    doctor_id: null
  },
  {
    name: 'radiologie',
    email: 'radiologie@kliniksued-rostock.de',
    role: 'admin',
    password: 'CuraFlow2026!',
    theme: 'default',
    is_active: true,
    collapsed_sections: '[]'
  },
  {
    name: 'sebastianrocher',
    email: 'sebastianrocher@hotmail.com',
    role: 'user',
    password: 'CuraFlow2026!',
    theme: 'default',
    is_active: true,
    collapsed_sections: '[]',
    doctor_id: null
  },
  {
    name: 't-loe',
    email: 't-loe@gmx.de',
    role: 'user',
    password: 'CuraFlow2026!',
    theme: 'default',
    is_active: true,
    collapsed_sections: '["Abwesenheiten","Anwesenheiten"]',
    doctor_id: null
  },
  {
    name: 'teresa.loebsin',
    email: 'teresa.loebsin@kliniksued-rostock.de',
    role: 'admin',
    password: 'CuraFlow2026!',
    theme: 'default',
    is_active: true,
    collapsed_sections: '["Sonstiges"]',
    settings: '{"sections":[{"id":"misc","defaultName":"Sonstiges","order":0,"customName":""},{"id":"absences","defaultName":"Abwesenheiten","order":1,"customName":""},{"id":"services","defaultName":"Dienste","order":2,"customName":""},{"id":"rotations","defaultName":"Rotationen","order":3,"customName":""},{"id":"available","defaultName":"Anwesenheiten","order":4,"customName":""},{"id":"demos","defaultName":"Demonstrationen & Konsile","order":5,"customName":""}]}'
  }
];

async function migrate() {
  console.log('🚀 Starting user migration...\n');
  
  const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    port: parseInt(process.env.MYSQL_PORT || '3306'),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE
  });

  try {
    // Prüfe ob User-Tabelle existiert, wenn nicht erstellen
    console.log('📋 Checking/Creating User table...');
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS User (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        role ENUM('user', 'admin') DEFAULT 'user',
        theme VARCHAR(50) DEFAULT 'default',
        is_active BOOLEAN DEFAULT TRUE,
        doctor_id INT NULL,
        collapsed_sections JSON,
        schedule_hidden_rows JSON,
        schedule_show_sidebar BOOLEAN DEFAULT TRUE,
        highlight_my_name BOOLEAN DEFAULT FALSE,
        wish_show_occupied BOOLEAN DEFAULT TRUE,
        wish_show_absences BOOLEAN DEFAULT TRUE,
        wish_hidden_doctors JSON,
        settings JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (doctor_id) REFERENCES Doctor(id) ON DELETE SET NULL
      )
    `);
    console.log('✅ User table ready\n');

    let inserted = 0;
    let skipped = 0;
    let errors = 0;

    for (const user of users) {
      try {
        // Prüfe ob Benutzer bereits existiert
        const [existing] = await pool.execute(
          'SELECT id FROM User WHERE email = ?',
          [user.email]
        );

        if (existing.length > 0) {
          console.log(`⏭️  Skipped: ${user.email} (already exists)`);
          skipped++;
          continue;
        }

        // Hash das Passwort
        const password_hash = await bcrypt.hash(user.password, 10);

        // Insert Benutzer
        await pool.execute(`
          INSERT INTO User (name, email, password_hash, role, theme, is_active, collapsed_sections, settings)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          user.name,
          user.email,
          password_hash,
          user.role,
          user.theme || 'default',
          user.is_active ? 1 : 0,
          user.collapsed_sections || '[]',
          user.settings || null
        ]);

        console.log(`✅ Inserted: ${user.email} (${user.role})`);
        inserted++;
      } catch (err) {
        console.error(`❌ Error inserting ${user.email}:`, err.message);
        errors++;
      }
    }

    console.log('\n📊 Migration Summary:');
    console.log(`   ✅ Inserted: ${inserted}`);
    console.log(`   ⏭️  Skipped: ${skipped}`);
    console.log(`   ❌ Errors: ${errors}`);
    console.log('\n🔐 Default password for all users: CuraFlow2026!');
    console.log('   ⚠️  Users should change their password after first login!');

  } catch (err) {
    console.error('❌ Migration failed:', err);
  } finally {
    await pool.end();
  }
}

migrate();
