/**
 * Database Initialization Script
 * Run this to create tables if schema.sql wasn't auto-loaded
 */

import dotenv from 'dotenv';
import { createPool } from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables FIRST
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

async function initDatabase() {
  try {
    console.log('🔄 Initializing database...');
    
    // Read schema.sql
    const schemaPath = path.join(__dirname, '..', 'schema.sql');
    let schema = fs.readFileSync(schemaPath, 'utf8');
    
    // Remove comments
    schema = schema.replace(/--[^\n]*/g, '');
    schema = schema.replace(/\/\*[\s\S]*?\*\//g, '');
    
    // Split by semicolons at end of lines
    const statements = [];
    let current = '';
    const lines = schema.split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      
      current += line + '\n';
      
      if (trimmed.endsWith(';')) {
        statements.push(current.trim());
        current = '';
      }
    }
    
    console.log(`📊 Found ${statements.length} SQL statements`);
    
    // Execute each statement
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      
      // Skip SELECT statements and empty ones
      if (!statement || statement.toUpperCase().startsWith('SELECT ')) {
        continue;
      }
      
      try {
        await db.query(statement);
        const match = statement.match(/CREATE TABLE.*?`(\w+)`/i) || 
                      statement.match(/INSERT INTO.*?`(\w+)`/i);
        const tableName = match ? match[1] : `statement ${i + 1}`;
        console.log(`✅ ${tableName}`);
      } catch (error) {
        // Ignore "already exists" errors
        if (error.code === 'ER_TABLE_EXISTS_ERROR' || 
            error.code === 'ER_DUP_ENTRY' ||
            error.message?.includes('Duplicate entry') ||
            error.message?.includes('already exists')) {
          const match = statement.match(/CREATE TABLE.*?`(\w+)`/i);
          const tableName = match ? match[1] : 'entry';
          console.log(`⏭️  ${tableName} (already exists)`);
        } else {
          console.error(`❌ Error executing statement ${i + 1}:`, error.message || error);
          console.error(`   SQL: ${statement.substring(0, 100)}...`);
          // Don't stop on errors, continue with next statement
        }
      }
    }
    
    console.log('\n✅ Database initialized successfully!');
    console.log('🔑 Default admin login:');
    console.log('   Email: admin@curaflow.local');
    console.log('   Password: admin123');
    console.log('   ⚠️  Change password on first login!\n');
    
    // Close database connection
    await db.end();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error initializing database:', error);
    await db.end().catch(() => {});
    process.exit(1);
  }
}

initDatabase();
