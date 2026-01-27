import express from 'express';
import { authMiddleware } from './auth.js';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// File upload configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// LLM Endpoint
router.post('/llm', authMiddleware, async (req, res) => {
  try {
    const { messages, model = 'gpt-4', temperature = 0.7, max_tokens = 1000 } = req.body;

    // Check if OpenAI API key is configured
    if (!process.env.OPENAI_API_KEY) {
      return res.status(501).json({ 
        error: 'OpenAI API key not configured. Set OPENAI_API_KEY environment variable.',
        fallback: 'Using mock response for development'
      });
    }

    // Call OpenAI API
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'OpenAI API error');
    }

    const data = await response.json();
    
    res.json({
      content: data.choices[0].message.content,
      usage: data.usage,
      model: data.model
    });
  } catch (error) {
    console.error('LLM Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Email Endpoint
router.post('/email', authMiddleware, async (req, res) => {
  try {
    const { to, subject, html, text, from = 'noreply@curaflow.local' } = req.body;

    if (!to || !subject || (!html && !text)) {
      return res.status(400).json({ error: 'Missing required fields: to, subject, and html or text' });
    }

    // Check if email service is configured
    if (!process.env.SMTP_HOST) {
      console.log('Email would be sent:', { to, subject, from });
      return res.json({ 
        success: true, 
        message: 'Email service not configured. Set SMTP_* environment variables. Email logged to console.',
        mock: true 
      });
    }

    // Use nodemailer for actual sending
    const nodemailer = await import('nodemailer');
    
    const transporter = nodemailer.default.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD
      }
    });

    const info = await transporter.sendMail({
      from,
      to: Array.isArray(to) ? to.join(', ') : to,
      subject,
      text,
      html
    });

    res.json({ 
      success: true, 
      messageId: info.messageId 
    });
  } catch (error) {
    console.error('Email Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// File Upload Endpoint
router.post('/upload', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const fileUrl = `/uploads/${req.file.filename}`;
    
    res.json({
      success: true,
      url: fileUrl,
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype
    });
  } catch (error) {
    console.error('Upload Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Serve uploaded files
router.use('/uploads', express.static(path.join(__dirname, '../../uploads')));

export default router;
