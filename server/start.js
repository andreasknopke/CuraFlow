/**
 * Startup script - loads environment variables before importing app
 */
import dotenv from 'dotenv';

// Load environment variables FIRST
dotenv.config();

// Verify JWT_SECRET is loaded
if (!process.env.JWT_SECRET) {
  console.error('❌ ERROR: JWT_SECRET is not set in .env file');
  process.exit(1);
}

// Now import and start the app
import('./index.js');
