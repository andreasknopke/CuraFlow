#!/usr/bin/env node
/**
 * Test Railway Connection
 *
 * Verifies that the Railway server is running and database connection works
 */

import fetch from 'node-fetch';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config({ path: 'server/.env' });

async function testConnection() {
  console.log('\n🔍 Testing Railway Backend Connection\n');

  const apiUrl = process.env.RAILWAY_API_URL || 'http://localhost:3000';

  // Test 1: Health Check
  console.log('1️⃣ Testing health endpoint...');
  try {
    const response = await fetch(`${apiUrl}/health`);
    const data = await response.json();

    if (data.status === 'ok') {
      console.log('✅ Health check passed');
      console.log(`   Environment: ${data.environment}`);
    } else {
      console.log('❌ Health check failed');
      return false;
    }
  } catch (error) {
    console.log(`❌ Failed to connect to ${apiUrl}`);
    console.log(`   Error: ${error.message}`);
    return false;
  }

  // Test 2: Database Connection
  console.log('\n2️⃣ Testing database connection...');
  try {
    const connection = await mysql.createConnection({
      host: process.env.MYSQL_HOST,
      port: parseInt(process.env.MYSQL_PORT || '3306'),
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE,
    });

    const [rows] = await connection.execute('SELECT 1 as test');
    await connection.end();

    if (rows[0].test === 1) {
      console.log('✅ Database connection successful');
    }
  } catch (error) {
    console.log('❌ Database connection failed');
    console.log(`   Error: ${error.message}`);
    return false;
  }

  // Test 3: Auth Endpoint
  console.log('\n3️⃣ Testing auth endpoint...');
  try {
    const response = await fetch(`${apiUrl}/api/auth/verify`);
    console.log(`✅ Auth endpoint accessible (Status: ${response.status})`);
  } catch (error) {
    console.log('❌ Auth endpoint failed');
    console.log(`   Error: ${error.message}`);
    return false;
  }

  console.log('\n✨ All tests passed! Railway backend is ready.\n');
  return true;
}

testConnection().then((success) => {
  process.exit(success ? 0 : 1);
});
