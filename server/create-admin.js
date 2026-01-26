/**
 * Reset Admin User Password
 * ⚠️  SECURITY: Only use this to reset a forgotten admin password
 * Run with: node create-admin.js
 */

import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { createPool } from 'mysql2/promise';

// Load environment variables FIRST
dotenv.config();

// Create database connection directly (don't import from index.js to avoid starting server)
const db = createPool({
  host: process.env.MYSQL_HOST,
  port: parseInt(process.env.MYSQL_PORT || '3306'),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  dateStrings: true,
  timezone: '+00:00'
});

async function createAdmin() {
  try {
    console.log('🔄 Resetting admin user password...');
    
    const email = 'admin@curaflow.local';
    // Generate secure random password (16 characters)
    const password = crypto.randomBytes(12).toString('base64').slice(0, 16);
    const id = '00000000-0000-0000-0000-000000000001';
    
    // Check if admin exists
    const [existing] = await db.execute('SELECT * FROM app_users WHERE email = ?', [email]);
    
    if (existing.length > 0) {
      console.log('⚠️  Admin user already exists, updating password...');
      const passwordHash = await bcrypt.hash(password, 12);
      await db.execute(
        'UPDATE app_users SET password_hash = ?, must_change_password = 1, is_active = 1 WHERE email = ?',
        [passwordHash, email]
      );
      console.log('✅ Admin password updated');
    } else {
      console.log('➕ Creating new admin user...');
      const passwordHash = await bcrypt.hash(password, 12);
      await db.execute(
        `INSERT INTO app_users (id, email, password_hash, full_name, role, must_change_password, is_active, created_by)
         VALUES (?, ?, ?, 'Administrator', 'admin', 1, 1, 'system')`,
        [id, email, passwordHash]
      );
      console.log('✅ Admin user created');
    }
    
    console.log('\n┌─────────────────────────────────────────────────────────┐');
    console.log('│  🔑 NEW ADMIN CREDENTIALS - SAVE THIS IMMEDIATELY!      │');
    console.log('├─────────────────────────────────────────────────────────┤');
    console.log(`│  Email:    ${email.padEnd(38)}│`);
    console.log(`│  Password: ${password.padEnd(38)}│`);
    console.log('├─────────────────────────────────────────────────────────┤');
    console.log('│  ⚠️  This password will NEVER be shown again!          │');
    console.log('│  ⚠️  Change password after first login!                │');
    console.log('└─────────────────────────────────────────────────────────┘\n');
    
    // Close database connection
    await db.end();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    await db.end().catch(() => {});
    process.exit(1);
  }
}

createAdmin();
