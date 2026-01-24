/**
 * Add UI preference columns to User table
 */

import dotenv from 'dotenv';
import { createPool } from 'mysql2/promise';

// Load environment variables FIRST
dotenv.config();

// Create database connection
const db = createPool({
  host: process.env.MYSQL_HOST,
  port: process.env.MYSQL_PORT || 3306,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

async function addUserPreferenceColumns() {
  try {
    console.log('🔄 Running database migrations...\n');
    
    // User table preference columns
    console.log('Adding User preference columns...');
    const userColumns = [
      { name: 'theme', type: "VARCHAR(50) DEFAULT 'default'" },
      { name: 'section_config', type: 'JSON' },
      { name: 'collapsed_sections', type: 'JSON' },
      { name: 'schedule_hidden_rows', type: 'JSON' },
      { name: 'schedule_show_sidebar', type: 'BOOLEAN DEFAULT TRUE' },
      { name: 'highlight_my_name', type: 'BOOLEAN DEFAULT FALSE' },
      { name: 'grid_font_size', type: "VARCHAR(20) DEFAULT 'medium'" },
      { name: 'wish_show_occupied', type: 'BOOLEAN DEFAULT TRUE' },
      { name: 'wish_show_absences', type: 'BOOLEAN DEFAULT TRUE' },
      { name: 'wish_hidden_doctors', type: 'JSON' }
    ];
    
    for (const column of userColumns) {
      try {
        await db.execute(`
          ALTER TABLE User 
          ADD COLUMN ${column.name} ${column.type}
        `);
        console.log(`✅ User.${column.name}`);
      } catch (error) {
        if (error.code === 'ER_DUP_FIELDNAME') {
          console.log(`⏭️  User.${column.name} (already exists)`);
        } else {
          console.error(`❌ Error adding User.${column.name}:`, error.message);
        }
      }
    }
    
    // StaffingPlanEntry optional columns
    console.log('\nAdding StaffingPlanEntry columns...');
    const staffingColumns = [
      { name: 'year', type: 'INT' },
      { name: 'month', type: 'INT' }
    ];
    
    for (const column of staffingColumns) {
      try {
        await db.execute(`
          ALTER TABLE StaffingPlanEntry 
          ADD COLUMN ${column.name} ${column.type}
        `);
        console.log(`✅ StaffingPlanEntry.${column.name}`);
      } catch (error) {
        if (error.code === 'ER_DUP_FIELDNAME') {
          console.log(`⏭️  StaffingPlanEntry.${column.name} (already exists)`);
        } else {
          console.error(`❌ Error adding StaffingPlanEntry.${column.name}:`, error.message);
        }
      }
    }
    
    // Add indexes
    console.log('\nAdding indexes...');
    try {
      await db.execute(`
        ALTER TABLE StaffingPlanEntry 
        ADD INDEX idx_year_month (year, month)
      `);
      console.log('✅ Index on year, month');
    } catch (error) {
      if (error.code === 'ER_DUP_KEYNAME') {
        console.log('⏭️  Index already exists');
      } else {
        console.log('⚠️  Index creation skipped:', error.message);
      }
    }
    
    console.log('\n✅ Migration complete!\n');
    await db.end();
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    await db.end();
    process.exit(1);
  }
}

addUserPreferenceColumns();
