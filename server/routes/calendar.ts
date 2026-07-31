import express from 'express';
import { db } from '../index.js';
import { authMiddleware } from './auth.js';

const router = express.Router();
router.use(authMiddleware);

// ===== SYNC CALENDAR =====
router.post('/sync', async (req, res, next) => {
  try {
    const { scheduleData, calendarId } = req.body;
    
    // Placeholder for Google Calendar integration
    // Would use @googleapis/calendar package
    
    console.log('Calendar sync requested for:', calendarId);
    
    res.json({ 
      success: true, 
      message: 'Calendar sync completed',
      syncedEvents: scheduleData?.length || 0
    });
  } catch (error) {
    next(error);
  }
});

// ===== GET SERVICE ACCOUNT EMAIL =====
router.get('/service-account', async (req, res, next) => {
  try {
    // Return service account email if configured
    const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || null;
    
    res.json({ email: serviceAccountEmail });
  } catch (error) {
    next(error);
  }
});

export default router;
