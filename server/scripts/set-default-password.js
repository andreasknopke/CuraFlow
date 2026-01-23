/**
 * Script to set default password 'CuraFlow2026!' for all users
 * and mark them to require password change on next login
 */

import bcrypt from 'bcryptjs';
import { db } from '../index.js';

const DEFAULT_PASSWORD = 'CuraFlow2026!';

async function setDefaultPassword() {
  try {
    console.log('🔄 Starting to set default password for all users...');
    
    // Hash the default password
    const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 12);
    console.log('✅ Password hashed successfully');
    
    // Get all users
    const [users] = await db.execute('SELECT id, email FROM app_users');
    console.log(`📊 Found ${users.length} users`);
    
    // Update each user
    let updated = 0;
    for (const user of users) {
      await db.execute(
        'UPDATE app_users SET password_hash = ?, must_change_password = 1 WHERE id = ?',
        [passwordHash, user.id]
      );
      console.log(`✅ Updated user: ${user.email}`);
      updated++;
    }
    
    console.log(`\n✅ Successfully updated ${updated} users`);
    console.log(`🔑 Default password: ${DEFAULT_PASSWORD}`);
    console.log('⚠️  All users will be prompted to change their password on next login\n');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error setting default password:', error);
    process.exit(1);
  }
}

// Check if must_change_password column exists, if not create it
async function ensureColumn() {
  try {
    await db.execute(`
      ALTER TABLE app_users 
      ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT FALSE
    `);
    console.log('✅ Column must_change_password ensured');
  } catch (error) {
    console.log('ℹ️  Column might already exist:', error.message);
  }
}

async function main() {
  await ensureColumn();
  await setDefaultPassword();
}

main();
