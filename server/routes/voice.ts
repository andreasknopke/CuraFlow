import express, { Request, Response, NextFunction } from 'express';
// @ts-expect-error — multer has no @types declaration installed
import multer from 'multer';
import { authMiddleware } from './auth.js';

interface CuraRequest extends Request {
  user?: Record<string, unknown>;
  file?: { buffer: Buffer; mimetype: string; originalname: string; size: number };
}

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.use(authMiddleware);

// ===== PROCESS VOICE COMMAND =====
router.post('/command', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
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
router.post('/transcribe', upload.single('audio'), async (req: CuraRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No audio file provided' });
      return;
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
