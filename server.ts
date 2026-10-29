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
    const {
      text,
      language,
      gender,
      speed,
      pitch,
      voiceName,
      isCloned,
      measuredPitchHz,
      timbreDescription,
      tempoDescription,
    } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Text prompt is required' });
    }

    let selectedPrebuiltVoice: string;
    let stylePrompt: string;
    let modelToUse = 'gemini-3.8-flash-lite-tts';
    let speakerMetadata: string | undefined = undefined;

    if (isCloned) {
      // Flagship audio model for Voice Design and custom speaker personas
      modelToUse = 'gemini-3.8-flash-tts';
      const cleanName = (voiceName || 'Cloned Speaker').replace(/\s*\(Cloned\)/i, '').trim();
      speakerMetadata = cleanName;

      // Select archetype baseline voice matching measured F0 pitch and vocal texture
      if (gender === 'male') {
        if (measuredPitchHz && measuredPitchHz < 125) {
          selectedPrebuiltVoice = 'Fenrir'; // Deep baritone
        } else if (measuredPitchHz && measuredPitchHz >= 145) {
          selectedPrebuiltVoice = 'Puck'; // Mid-high tenor
        } else {
          selectedPrebuiltVoice = 'Fenrir'; // Balanced warm male resonance (distinct from flat Charon)
        }
      } else {
        if (measuredPitchHz && measuredPitchHz < 205) {
          selectedPrebuiltVoice = 'Kore'; // Warm alto/mezzo
        } else {
          selectedPrebuiltVoice = 'Zephyr'; // Crisp, articulate soprano
        }
      }

      const accentDesc =
        language === 'bn-IN'
          ? 'authentic West Bengal Bengali intonation with natural Kolkata cadence and expressive rhythm'
          : language === 'hi-IN'
          ? 'Standard Hindi intonation with authentic Indian cadence and clear aspirates'
          : 'natural Indian English accent with authentic conversational prosody and clear syllable timing';

      const pitchDesc = measuredPitchHz
        ? `fundamental pitch calibrated at ${Math.round(measuredPitchHz)} Hz`
        : (gender === 'male' ? 'warm baritone register (~125 Hz)' : 'melodic alto/soprano register (~215 Hz)');
      const timbreDesc = timbreDescription || (gender === 'male' ? 'warm chest resonance with articulate natural texture' : 'clear expressive harmonics');
      const tempoDesc = tempoDescription || 'conversational natural pacing';

      stylePrompt = `Custom voice persona for ${cleanName}: Synthesize speech as ${cleanName}, an authentic individual ${gender} speaker. Acoustic characteristics: ${pitchDesc}, ${timbreDesc}, ${tempoDesc}, with ${accentDesc}. Maintain personal vocal timbre, human breath dynamics, natural pause cadence, and avoid flat synthetic or announcer cadence.`;
    } else {
      selectedPrebuiltVoice = gender === 'male' ? 'Charon' : 'Kore';
      if (language === 'bn-IN') {
        stylePrompt = 'Fluent, articulate West Bengal Bengali speech with accurate Kolkata pronunciation and natural intonation.';
      } else if (language === 'hi-IN') {
        stylePrompt = 'Fluent, articulate Standard Hindi speech with natural cadence, accurate aspirates, and clarity.';
      } else {
        stylePrompt = 'Clear, articulate Indian English speech with natural prosody and authentic cadence.';
      }
    }

    if (speed && Math.abs(speed - 1.0) > 0.05) {
      stylePrompt += ` Speaking rate: ${speed > 1.0 ? 'slightly faster pace' : 'more measured, deliberate pace'}.`;
    }
    if (pitch && Math.abs(pitch - 1.0) > 0.05) {
      stylePrompt += ` Pitch level: ${pitch > 1.0 ? 'higher vocal pitch' : 'lower, deeper vocal pitch'}.`;
    }

    // Call Gemini TTS with automatic resilience fallback
    let response;
    try {
      response = await ai.models.generateContent({
        model: modelToUse,
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: text.trim(),
                speechMetadata: {
                  speaker: speakerMetadata,
                  style: stylePrompt,
                },
              },
            ],
          },
        ],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: selectedPrebuiltVoice },
            },
          },
        },
      });
    } catch (primaryErr) {
      console.warn(`Primary TTS attempt with ${modelToUse} failed:`, primaryErr);
      // Fallback to gemini-3.8-flash-lite-tts
      response = await ai.models.generateContent({
        model: 'gemini-3.8-flash-lite-tts',
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: text.trim(),
                speechMetadata: {
                  style: stylePrompt,
                },
              },
            ],
          },
        ],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: selectedPrebuiltVoice },
            },
          },
        },
      });
    }

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
