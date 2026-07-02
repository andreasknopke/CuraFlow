#!/usr/bin/env node
/**
 * PPUGV Cache-Refresh-Script
 *
 * Ruft POST /api/master/ppugv/refresh auf, um den taeglichen Cache
 * der PPUGV-Exportdaten zu aktualisieren.
 *
 * Aufruf:
 *   node server/scripts/refresh-ppugv-cache.js
 *
 * Cron-Job (taeglich um 1:00 Uhr):
 *   0 1 * * * cd /path/to/curaflow && node server/scripts/refresh-ppugv-cache.js >> /var/log/ppugv-refresh.log 2>&1
 *
 * Das Script verwendet die Umgebungsvariablen aus der Server-Umgebung.
 * Es startet einen kurzen HTTP-Server, ruft den Endpoint auf und beendet sich.
 */

import dotenv from 'dotenv';
dotenv.config();

const BASE_URL = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
const API_TOKEN = process.env.PPUGV_REFRESH_TOKEN || '';

async function refreshCache() {
  console.log(`[PPUGV-Refresh] ${new Date().toISOString()} - Starte Cache-Aktualisierung...`);

  try {
    const url = `${BASE_URL.replace(/\/+$/, '')}/api/master/ppugv/refresh`;
    const headers = { 'Content-Type': 'application/json' };

    // Wenn ein API-Token gesetzt ist, wird er als Authorization-Header mitgegeben.
    // Der Endpoint selbst nutzt authMiddleware/adminMiddleware, daher muss das
    // Cookie/JWT des eingeloggten Admins verwendet werden.
    // Alternativ kann ein Service-Token oder direkter DB-Zugriff genutzt werden.
    if (API_TOKEN) {
      headers['Authorization'] = `Bearer ${API_TOKEN}`;
    }

    console.log(`[PPUGV-Refresh] Rufe auf: ${url}`);

    const response = await fetch(url, {
      method: 'POST',
      headers,
    });

    if (response.status === 202) {
      // Accepted – Refresh wurde im Hintergrund gestartet
      const result = await response.json();
      console.log(`[PPUGV-Refresh] ${new Date().toISOString()} - Refresh gestartet (202 Accepted): ${result.message}`);
      process.exit(0);
    }

    if (response.status === 409) {
      // Conflict – refresh already running
      const result = await response.json();
      console.log(`[PPUGV-Refresh] ${new Date().toISOString()} - Refresh laeuft bereits: ${result.message}`);
      process.exit(0);
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    console.log(`[PPUGV-Refresh] ${new Date().toISOString()} - Erfolgreich: ${result.count} Datensaetze gecacht (Datum: ${result.cacheDate})`);
    process.exit(0);
  } catch (error) {
    console.error(`[PPUGV-Refresh] ${new Date().toISOString()} - FEHLER: ${error.message}`);
    process.exit(1);
  }
}

refreshCache();
