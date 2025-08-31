import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { suggestSentencesFromInitials } from './llm/suggest.js';
import { textToSpeech } from './tts/elevenlabs.js';

// Load env from .env file (try both locations)
dotenv.config({ path: './.env' }) || dotenv.config({ path: './config/.env' });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

// Serve static frontend from public/
app.use(express.static(path.join(__dirname, 'public')));

// Health
app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

// LLM suggestions: POST { initials: ["I","L","Y"], k?: number }
app.post('/api/suggest', async (req, res) => {
  try {
    const { initials, k } = req.body || {};
    const results = await suggestSentencesFromInitials(initials, { k: typeof k === 'number' ? k : 5, includeScores: true });
    res.json({ initials, results });
  } catch (err) {
    res.status(400).json({ error: err?.message || 'suggest failed' });
  }
});

// TTS: POST { text: string } -> mp3 binary
app.post('/api/tts', async (req, res) => {
  try {
    const { text } = req.body || {};
    const result = await textToSpeech(String(text || ''), {});
    res.setHeader('Content-Type', result.mimeType || 'audio/mpeg');
    res.send(result.buffer);
  } catch (err) {
    res.status(400).json({ error: err?.message || 'tts failed' });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});


