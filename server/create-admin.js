/**
 * Create default admin user
 */

import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
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
    console.log('🔄 Creating admin user...');
    
    const email = 'admin@curaflow.local';
    const password = 'admin123';
    const id = '00000000-0000-0000-0000-000000000001';
    
    // Check if admin exists
    const [existing] = await db.execute('SELECT * FROM app_users WHERE email = ?', [email]);
    
    if (existing.length > 0) {
      console.log('⚠️  Admin user already exists, updating password...');
      const passwordHash = await bcrypt.hash(password, 10);
      await db.execute(
        'UPDATE app_users SET password_hash = ?, must_change_password = 1, is_active = 1 WHERE email = ?',
        [passwordHash, email]
      );
      console.log('✅ Admin password updated');
    } else {
      console.log('➕ Creating new admin user...');
      const passwordHash = await bcrypt.hash(password, 10);
      await db.execute(
        `INSERT INTO app_users (id, email, password_hash, full_name, role, must_change_password, is_active, created_by)
         VALUES (?, ?, ?, 'Administrator', 'admin', 1, 1, 'system')`,
        [id, email, passwordHash]
      );
      console.log('✅ Admin user created');
    }
    
    console.log('\n🔑 Admin credentials:');
    console.log('   Email:', email);
    console.log('   Password:', password);
    console.log('   ⚠️  Change password on first login!\n');
    
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
