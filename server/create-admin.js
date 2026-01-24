/**
 * Create default admin user
 */

import bcrypt from 'bcryptjs';
import { db } from './index.js';

async function createAdmin() {
  try {
    console.log('🔄 Creating admin user...');
    
    const email = 'admin@curaflow.local';
    const password = 'admin123';
    const id = '00000000-0000-0000-0000-000000000001';
    
    // Check if admin exists
    const [existing] = await db.execute('SELECT * FROM User WHERE email = ?', [email]);
    
    if (existing.length > 0) {
      console.log('⚠️  Admin user already exists, updating password...');
      const passwordHash = await bcrypt.hash(password, 10);
      await db.execute(
        'UPDATE User SET password_hash = ?, must_change_password = 1, is_active = 1 WHERE email = ?',
        [passwordHash, email]
      );
      console.log('✅ Admin password updated');
    } else {
      console.log('➕ Creating new admin user...');
      const passwordHash = await bcrypt.hash(password, 10);
      await db.execute(
        `INSERT INTO User (id, email, password_hash, full_name, role, must_change_password, is_active, created_by)
         VALUES (?, ?, ?, 'Administrator', 'admin', 1, 1, 'system')`,
        [id, email, passwordHash]
      );
      console.log('✅ Admin user created');
    }
    
    console.log('\n🔑 Admin credentials:');
    console.log('   Email:', email);
    console.log('   Password:', password);
    console.log('   ⚠️  Change password on first login!\n');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

createAdmin();
