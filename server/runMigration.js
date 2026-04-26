import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';

const users = [
  { 

async function migrate() {
  console.log('🚀 Starting user migration...\n');
  
  const pool = mysql.createPool({
  
  });

  try {
    console.log('📋 Creating User table if not exists...');
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
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ User table ready\n');

    const defaultPassword = 'CuraFlow2026!';
    const password_hash = await bcrypt.hash(defaultPassword, 10);

    let inserted = 0;
    let skipped = 0;

    for (const user of users) {
      try {
        const [existing] = await pool.execute('SELECT id FROM User WHERE email = ?', [user.email]);
        
        if (existing.length > 0) {
          console.log(`⏭️  Skipped: ${user.email} (already exists)`);
          skipped++;
          continue;
        }

        await pool.execute(`
          INSERT INTO User (name, email, password_hash, role, theme, is_active, collapsed_sections, settings)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          user.name,
          user.email,
          password_hash,
          user.role,
          user.theme || 'default',
          1,
          user.collapsed_sections || '[]',
          user.settings || null
        ]);

        console.log(`✅ Inserted: ${user.email} (${user.role})`);
        inserted++;
      } catch (err) {
        console.error(`❌ Error: ${user.email} - ${err.message}`);
      }
    }

    console.log('\n📊 Migration Summary:');
    console.log(`   ✅ Inserted: ${inserted}`);
    console.log(`   ⏭️  Skipped: ${skipped}`);
    console.log(`\n🔐 Default password: CuraFlow2026!`);

  } finally {
    await pool.end();
  }
}

migrate();
