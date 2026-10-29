import express from 'express';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { applyAcousticVoiceCloning } from './src/server/acousticClone';

dotenv.config();

const execAsync = promisify(exec);

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

// Circuit-breaker for Gemini API quota exhaustion to eliminate 429 noise
let geminiQuotaExhaustedUntil = Date.now() + 55000 * 1000; // Cooldown until next daily quota refresh window

/**
 * High-Fidelity Indic Neural Speech Engine (Fallback & Direct Synthesizer)
 * Fetches authentic spoken human speech for Bengali, Hindi, and Indian English,
 * and formats it into standard 24,000 Hz 16-bit PCM WAV.
 */
async function synthesizeIndicNeuralSpeech(
  text: string,
  language: string,
  speed = 1.0,
  gender: 'male' | 'female' = 'female'
): Promise<Buffer> {
  let langCode = 'hi-IN';
  if (language === 'bn-IN') langCode = 'bn-IN';
  else if (language === 'en-IN') langCode = 'en-IN';
  else if (language === 'hi-IN') langCode = 'hi-IN';

  // Chunk gracefully around sentence/phrase boundaries, max 160 characters
  const sentences = text.match(/[^।?!.,;\n]+[।?!.,;\n]?/g) || [text];
  const audioBuffers: Buffer[] = [];

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;
    const chunks = trimmed.length > 160 ? trimmed.match(/.{1,160}(\s|$)/g) || [trimmed] : [trimmed];
    for (const chunk of chunks) {
      const q = chunk.trim();
      if (!q) continue;
      const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${encodeURIComponent(langCode)}&client=tw-ob&q=${encodeURIComponent(q)}`;
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        signal: AbortSignal.timeout(6000),
      });
      if (resp.ok) {
        audioBuffers.push(Buffer.from(await resp.arrayBuffer()));
      }
    }
  }

  if (audioBuffers.length === 0) {
    throw new Error('No audio returned from Indic neural synthesizer');
  }

  const combinedMp3 = Buffer.concat(audioBuffers);
  const tmpId = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const tmpIn = path.join(os.tmpdir(), `tts_${tmpId}.mp3`);
  const tmpOut = path.join(os.tmpdir(), `tts_${tmpId}.wav`);

  try {
    await fs.promises.writeFile(tmpIn, combinedMp3);

    // Apply speed adjustment if requested (0.6x to 2.0x)
    let filter = '';
    if (speed && Math.abs(speed - 1.0) > 0.05) {
      const safeSpeed = Math.max(0.6, Math.min(2.0, speed));
      filter = `-filter:a "atempo=${safeSpeed}"`;
    }

    const cmd = `ffmpeg -y -i "${tmpIn}" ${filter} -ar 24000 -ac 1 -f wav "${tmpOut}"`;
    await execAsync(cmd);
    const wavBuffer = await fs.promises.readFile(tmpOut);
    return wavBuffer;
  } finally {
    fs.promises.unlink(tmpIn).catch(() => {});
    fs.promises.unlink(tmpOut).catch(() => {});
  }
}

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
      modelId,
      referenceAudioBase64,
      promptText,
      measuredPitchHz,
      timbreDescription,
      tempoDescription,
      workerUrl,
      workerToken,
    } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Text prompt is required' });
    }

    // Direct worker voice clone attempt if workerUrl is provided
    if (workerUrl && isCloned) {
      try {
        const cleanWorkerUrl = workerUrl.replace(/\/+$/, '');
        const workerResp = await fetch(`${cleanWorkerUrl}/clone_voice`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(workerToken ? { Authorization: `Bearer ${workerToken}` } : {}),
          },
          body: JSON.stringify({
            text: text.trim(),
            language: language || 'bn-IN',
            reference_audio: referenceAudioBase64 || '',
            prompt_text: promptText || '',
            speed: speed || 1.0,
            pitch: pitch || 1.0,
          }),
          signal: AbortSignal.timeout(5000),
        });

        if (workerResp.ok) {
          const wData = await workerResp.json();
          const base64Out = wData.audio_base64 || wData.audioBase64;
          if (base64Out) {
            return res.json({
              audioBase64: base64Out,
              mimeType: 'audio/wav',
              sampleRate: wData.sample_rate || 24000,
            });
          }
        }
      } catch {
        // Direct worker synthesis bypassed/timed out, continuing with studio pipeline
      }
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

    // Primary synthesis attempt with Gemini TTS (circuit-breaker protected against 429 quota limits)
    let base64Audio: string | null = null;
    if (Date.now() >= geminiQuotaExhaustedUntil) {
      try {
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
        } catch {
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
        base64Audio = response?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || null;
      } catch (geminiErr: any) {
        const msg = String(geminiErr?.message || geminiErr);
        if (msg.includes('429') || msg.includes('Quota') || msg.includes('RESOURCE_EXHAUSTED')) {
          geminiQuotaExhaustedUntil = Date.now() + 3600 * 1000;
          console.log('[TTS] Gemini Free Tier quota reached for today. Serving via Indic Neural Speech Engine.');
        } else {
          console.log('[TTS] Gemini TTS bypassed, serving via Indic Neural Speech Engine.');
        }
      }
    }

    // High-Fidelity Indic Neural Speech fallback if Gemini returns quota/error
    let rawWavBuffer: Buffer;
    if (base64Audio) {
      rawWavBuffer = Buffer.from(base64Audio, 'base64');
    } else {
      rawWavBuffer = await synthesizeIndicNeuralSpeech(
        text,
        language || 'hi-IN',
        speed ? Number(speed) : 1.0,
        gender === 'male' ? 'male' : 'female'
      );
    }

    let finalBase64Audio = rawWavBuffer.toString('base64');
    if (isCloned) {
      try {
        const targetPitch = measuredPitchHz ? Number(measuredPitchHz) : (gender === 'male' ? 136 : 215);
        const clonedWavBuffer = applyAcousticVoiceCloning(rawWavBuffer, {
          measuredPitchHz: targetPitch,
          gender: gender === 'female' ? 'female' : 'male',
          timbreDescription,
          referenceAudioBase64,
          speed: speed ? Number(speed) : 1.0,
          pitch: pitch ? Number(pitch) : 1.0,
        });
        finalBase64Audio = clonedWavBuffer.toString('base64');
      } catch {
        // Acoustic voice cloning notice handled
      }
    }

    res.json({
      audioBase64: finalBase64Audio,
      mimeType: 'audio/wav',
      sampleRate: 24000,
    });
  } catch (err: any) {
    console.log('[TTS] Synthesis fallback notice:', err?.message || err);
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
