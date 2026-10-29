import express from 'express';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '50mb' }));

// Initialize GoogleGenAI server-side with User-Agent header
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

// Full-fidelity Speech Synthesis API endpoint
app.post('/api/tts', async (req, res) => {
  try {
    const { text, language, gender, speed, pitch } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Text prompt is required' });
    }

    // Voice mapping: Kore (female), Charon / Fenrir / Puck (male)
    const voiceName = gender === 'male' ? 'Charon' : 'Kore';

    let style = 'Clear, articulate Indian English speech with natural prosody and authentic cadence.';
    if (language === 'bn-IN') {
      style = 'Fluent, articulate West Bengal Bengali speech with accurate Kolkata pronunciation and natural intonation.';
    } else if (language === 'hi-IN') {
      style = 'Fluent, articulate Standard Hindi speech with natural cadence, accurate aspirates, and clarity.';
    }

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash-lite-tts',
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: text.trim(),
              speechMetadata: {
                style,
              },
            },
          ],
        },
      ],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) {
      throw new Error('No audio data received from Gemini TTS model');
    }

    res.json({
      audioBase64: base64Audio,
      mimeType: 'audio/wav',
      sampleRate: 24000,
    });
  } catch (err) {
    console.error('Gemini TTS error:', err);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Speech synthesis failed',
    });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`VoxIndica Studio running on port ${PORT}`);
  });
}

startServer();
