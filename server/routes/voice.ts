import express from 'express';
import multer from 'multer';
import { authMiddleware } from './auth.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.use(authMiddleware);

// ===== PROCESS VOICE COMMAND =====
router.post('/command', async (req, res, next) => {
  try {
    const { command, context } = req.body;
    
    // Placeholder for voice command processing
    // Would integrate with AI service (OpenAI, etc.)
    
    console.log('Voice command received:', command);
    
    res.json({ 
      success: true,
      action: 'processed',
      response: 'Voice command processed'
    });
  } catch (error) {
    next(error);
  }
});

// ===== TRANSCRIBE AUDIO =====
router.post('/transcribe', upload.single('audio'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }
    
    // Placeholder for audio transcription
    // Would use Whisper API or similar
    
    console.log('Audio transcription requested, file size:', req.file.size);
    
    res.json({ 
      success: true,
      transcript: 'Transcribed text would appear here'
    });
  } catch (error) {
    next(error);
  }
});

export default router;
