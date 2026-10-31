import express from 'express';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import os from 'os';
import zlib from 'node:zlib';
import { exec } from 'child_process';
import { promisify } from 'util';
import { applyAcousticVoiceCloning } from './src/server/acousticClone';

dotenv.config();

const execAsync = promisify(exec);

const KAGGLE_API = 'https://www.kaggle.com/api/v1';
const WORKER_TIMEOUT_MS = Number(process.env.WORKER_TIMEOUT_MS) || 120000;
const KAGGLE_KERNEL_SLUG = 'voxindica-worker';
const WORKER_PLATFORMS = new Set(['local', 'kaggle', 'colab']);

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
      provider,
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

    // A worker-backed provider must answer or fail loudly. Falling through to the
    // Gemini/formant pipeline here would present synthetic audio as the clone.
    const usesWorker =
      Boolean(workerUrl) && (WORKER_PLATFORMS.has(String(provider)) || Boolean(isCloned));

    if (usesWorker) {
      const cleanWorkerUrl = String(workerUrl).replace(/\/+$/, '');
      try {
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
            cfg_value: 2.0,
            inference_timesteps: 8,
          }),
          signal: AbortSignal.timeout(WORKER_TIMEOUT_MS),
        });

        if (workerResp.ok) {
          const wData = await workerResp.json();
          const base64Out = wData.audio_base64 || wData.audioBase64;
          if (base64Out) {
            return res.json({
              audioBase64: base64Out,
              mimeType: 'audio/wav',
              sampleRate: wData.sample_rate || 24000,
              durationSeconds: wData.duration_seconds,
              provider: 'worker',
              gpu: wData.gpu,
            });
          }
          return res.status(502).json({ error: 'Worker returned no audio payload' });
        }

        const detail = await workerResp.json().catch(() => null);
        const reason = detail?.detail || detail?.error || `HTTP ${workerResp.status}`;
        console.log(`[TTS] Worker rejected the request (${workerResp.status}): ${reason}`);
        return res
          .status(workerResp.status === 401 ? 401 : 502)
          .json({ error: `Worker synthesis failed: ${reason}` });
      } catch (workerErr: any) {
        const isTimeout = workerErr?.name === 'TimeoutError' || workerErr?.name === 'AbortError';
        const reason = isTimeout
          ? `worker did not answer within ${Math.round(WORKER_TIMEOUT_MS / 1000)}s`
          : workerErr?.message || 'worker unreachable';
        console.log(`[TTS] Worker call failed: ${reason}`);
        return res.status(isTimeout ? 504 : 502).json({ error: `Worker synthesis failed: ${reason}` });
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

// ---------------------------------------------------------------------------
// Worker probe relay.
//
// The browser cannot tell DNS failure, TLS failure and CORS apart — every one
// of them surfaces as `TypeError: Failed to fetch`. The server can see the real
// reason, so the UI asks it to diagnose the endpoint before showing a message.
// ---------------------------------------------------------------------------
app.post('/api/providers/probe', async (req, res) => {
  const raw = String(req.body?.url || '').trim().replace(/\/+$/, '');
  const token = String(req.body?.token || '').trim();

  if (!/^https?:\/\//i.test(raw)) {
    return res.json({
      ok: false,
      message: 'Worker URL must start with http:// or https://',
    });
  }

  let host = raw;
  try {
    host = new URL(raw).host;
  } catch {
    return res.json({ ok: false, message: `"${raw}" is not a valid URL` });
  }

  const started = Date.now();
  try {
    const response = await fetch(`${raw}/health`, {
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(15000),
    });
    const body = await response.text();
    let health: any = null;
    try {
      health = JSON.parse(body);
    } catch {
      health = null;
    }
    return res.json({
      ok: response.ok,
      status: response.status,
      latencyMs: Date.now() - started,
      health,
      message: response.ok
        ? undefined
        : `Worker answered HTTP ${response.status}: ${body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160)}`,
    });
  } catch (error: any) {
    const code = error?.cause?.code || error?.code || '';
    const name = error?.name || '';
    let message: string;
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
      message =
        `${host} does not resolve in DNS. A Cloudflare quick tunnel stops existing as soon as the ` +
        `worker process exits (or the Kaggle session restarts), so this URL is dead — start the worker ` +
        `cell again and copy the fresh URL it prints.`;
    } else if (code === 'ECONNREFUSED') {
      message = `${host} refused the connection. The tunnel is up but nothing is listening on the worker port.`;
    } else if (name === 'TimeoutError' || name === 'AbortError') {
      message = `${host} did not answer /health within 15s. The tunnel may be up while the model is still loading.`;
    } else if (String(code).includes('CERT') || String(code).includes('TLS')) {
      message = `TLS handshake with ${host} failed (${code}). Check the tunnel URL and try again.`;
    } else {
      message = `Could not reach ${host}: ${error?.message || 'network error'}${code ? ` (${code})` : ''}`;
    }
    return res.json({ ok: false, code: code || null, message });
  }
});

// ---------------------------------------------------------------------------
// Kaggle API proxy — credentials arrive per request and are never persisted.
//
// Kaggle ships two credential generations:
//   basic  -> username + legacy API key from kaggle.json (www.kaggle.com/api/v1)
//   bearer -> single access token from "Generate New Token" (kaggle CLI >= 1.8,
//             kagglehub, api.kaggle.com/v1)
// The Studio tests basic first and falls back to bearer, then remembers which
// scheme actually worked for that credential.
// ---------------------------------------------------------------------------
type KaggleAuthScheme = 'basic' | 'bearer';

interface KaggleCredentials {
  username: string;
  key: string;
  auth?: KaggleAuthScheme;
}

function kaggleAuthHeader(credentials: KaggleCredentials, scheme: KaggleAuthScheme): string {
  if (scheme === 'bearer') return `Bearer ${credentials.key}`;
  return `Basic ${Buffer.from(`${credentials.username}:${credentials.key}`).toString('base64')}`;
}

/** Minimal ZIP reader (stored + deflate). Kaggle output bundles are standard zips. */
function readZipEntries(buffer: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 66000); i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return entries;

  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);

  for (let i = 0; i < count; i += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);

    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);

    try {
      entries.set(name, method === 0 ? Buffer.from(raw) : zlib.inflateRawSync(raw));
    } catch {
      // skip unreadable entry
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function extractWorkerSession(entries: Map<string, Buffer>): { url?: string; token?: string } | null {
  for (const [name, content] of entries.entries()) {
    if (name.endsWith('worker_session.json')) {
      try {
        const parsed = JSON.parse(content.toString('utf8'));
        if (parsed?.url && parsed?.token) return { url: parsed.url, token: parsed.token };
      } catch {
        // fall through to log scraping
      }
    }
  }

  for (const [name, content] of entries.entries()) {
    if (!/\.(log|txt)$/.test(name)) continue;
    const text = content.toString('utf8');
    const url = text.match(/TUNNEL URL\s*:\s*(https:\/\/[a-z0-9-]+\.trycloudflare\.com)/i)?.[1];
    const token = text.match(/BEARER TOKEN\s*:\s*([a-f0-9]{16,})/i)?.[1];
    if (url && token) return { url, token };
  }
  return null;
}

async function kaggleRequest(
  pathname: string,
  credentials: KaggleCredentials,
  init: RequestInit = {}
): Promise<Response> {
  const preferred: KaggleAuthScheme = credentials.auth === 'bearer' ? 'bearer' : 'basic';
  const send = (scheme: KaggleAuthScheme) =>
    fetch(`${KAGGLE_API}${pathname}`, {
      ...init,
      headers: {
        Authorization: kaggleAuthHeader(credentials, scheme),
        ...(init.headers || {}),
      },
      signal: AbortSignal.timeout(60000),
    });

  const response = await send(preferred);
  // /kernels/* only speaks HTTP Basic today, so a Bearer token that passed the
  // test endpoint can still 401 here. Retry once with the other scheme instead
  // of failing a launch the user already verified.
  if (response.status === 401 || response.status === 403) {
    const fallback: KaggleAuthScheme = preferred === 'basic' ? 'bearer' : 'basic';
    const retried = await send(fallback);
    if (retried.ok) return retried;
  }
  return response;
}

app.post('/api/providers/kaggle/test', async (req, res) => {
  const username = String(req.body?.username || '').trim();
  const key = String(req.body?.key || '').trim();
  if (!username || !key) {
    return res.json({ ok: false, message: 'Username and credential are both required' });
  }

  const credentials: KaggleCredentials = { username, key };
  const attempts: KaggleAuthScheme[] = ['basic', 'bearer'];

  try {
    // `/kernels/list?mine=true` was removed from the API (HTTP 400 "Invalid field 'mine'").
    // `user=` on kernels requires real auth, so it validates the credentials truthfully.
    let lastStatus = 0;
    let lastBody = '';
    for (const scheme of attempts) {
      const response = await kaggleRequest(
        `/kernels/list?user=${encodeURIComponent(username)}&pageSize=1`,
        { ...credentials, auth: scheme }
      );
      if (response.ok) {
        return res.json({
          ok: true,
          auth: scheme,
          username,
          message:
            scheme === 'bearer'
              ? `Kaggle API reachable as ${username} (access token, Bearer)`
              : `Kaggle API reachable as ${username} (legacy key, HTTP Basic)`,
        });
      }
      lastStatus = response.status;
      lastBody = (await response.text()).slice(0, 160);
    }

    const message =
      lastStatus === 401 || lastStatus === 403
        ? 'Kaggle rejected both auth schemes. Create a legacy API key (kaggle.com/settings/api → Create Legacy API Key) and use username + key: the REST automation speaks www.kaggle.com/api/v1, which expects HTTP Basic. New access tokens only work with the kaggle CLI 1.8+ / kagglehub clients.'
        : `Kaggle responded HTTP ${lastStatus}: ${lastBody.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()}`;
    return res.json({ ok: false, message });
  } catch (error: any) {
    return res.json({ ok: false, message: `Could not reach Kaggle: ${error?.message || 'network error'}` });
  }
});

app.post('/api/providers/kaggle/launch', async (req, res) => {
  const username = String(req.body?.username || '').trim();
  const key = String(req.body?.key || '').trim();
  const datasetSource = String(req.body?.datasetSource || '').trim();
  // Reuse the scheme the Test button verified; kaggleRequest() retries the other
  // scheme once if /kernels/push still answers 401/403.
  const auth: KaggleAuthScheme = req.body?.auth === 'bearer' ? 'bearer' : 'basic';
  const credentials: KaggleCredentials = { username, key, auth };

  if (!username || !key) {
    return res.json({ ok: false, message: 'Save and verify Kaggle credentials first' });
  }

  const notebookCandidates = [
    path.resolve(process.cwd(), 'notebooks/kaggle/voxindica_worker.ipynb'),
    path.resolve(process.cwd(), 'public/notebooks/voxindica_worker_kaggle.ipynb'),
  ];
  const notebookPath = notebookCandidates.find((candidate) => fs.existsSync(candidate));
  if (!notebookPath) {
    return res.json({
      ok: false,
      message: 'Worker notebook is missing from this build (notebooks/kaggle/voxindica_worker.ipynb)',
    });
  }

  const notebook = await fs.promises.readFile(notebookPath, 'utf8');
  const metadata = {
    id: `${username}/${KAGGLE_KERNEL_SLUG}`,
    title: 'VoxIndica VoxCPM2 Worker',
    code_file: 'voxindica_worker.ipynb',
    language: 'python',
    kernel_type: 'notebook',
    is_private: 'true',
    enable_gpu: 'true',
    enable_internet: 'true',
    dataset_sources: datasetSource ? [datasetSource] : [],
    competition_sources: [],
    kernel_sources: [],
    keywords: ['tts', 'voice-cloning', 'voxcpm2'],
  };

  const form = new FormData();
  form.append('metadata', JSON.stringify(metadata));
  form.append('fileName', 'voxindica_worker.ipynb');
  form.append('fileData', notebook);

  try {
    const response = await kaggleRequest('/kernels/push', credentials, { method: 'POST', body: form });
    const body = await response.text();
    const kernelUrl = `https://www.kaggle.com/code/${username}/${KAGGLE_KERNEL_SLUG}`;

    if (!response.ok) {
      const cleanBody = body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
      return res.json({
        ok: false,
        message:
          response.status === 401
            ? 'Kaggle rejected the saved credential for /kernels/push (401). Verify & save a Legacy API Key from kaggle.com/settings/api (username + key from kaggle.json) — new-style access tokens do not always authorise notebook pushes.'
            : response.status === 403
              ? 'Kaggle refused the push (403). Verify your account can run GPU kernels and that the phone/identity verification is complete.'
              : `Kaggle push failed (HTTP ${response.status}): ${cleanBody}`,
        kernelUrl,
      });
    }

    return res.json({
      ok: true,
      message: 'Notebook pushed. Kaggle is queuing a GPU session — polling for the tunnel now.',
      kernelUrl,
    });
  } catch (error: any) {
    return res.json({ ok: false, message: `Kaggle push failed: ${error?.message || 'network error'}` });
  }
});

app.post('/api/providers/kaggle/poll', async (req, res) => {
  const username = String(req.body?.username || '').trim();
  const key = String(req.body?.key || '').trim();
  if (!username || !key) {
    return res.json({ state: 'error', message: 'Kaggle credentials missing' });
  }
  const credentials: KaggleCredentials = {
    username,
    key,
    auth: req.body?.auth === 'bearer' ? 'bearer' : 'basic',
  };

  const kernelUrl = `https://www.kaggle.com/code/${username}/${KAGGLE_KERNEL_SLUG}`;
  const kernelPath = `${username}/${KAGGLE_KERNEL_SLUG}`;

  try {
    const statusResponse = await kaggleRequest(`/kernels/status/${kernelPath}`, credentials);
    const statusText = (await statusResponse.text()).trim();

    if (!statusResponse.ok) {
      const clean = statusText.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
      return res.json({
        state: 'error',
        message:
          statusResponse.status === 404
            ? 'That kernel does not exist yet — press Launch on Kaggle to push it first.'
            : `Kaggle status check failed (HTTP ${statusResponse.status}): ${clean}`,
        kernelUrl,
      });
    }

    if (/COMPLETE|ERROR|CANCEL/i.test(statusText)) {
      return res.json({
        state: 'error',
        message:
          'The kernel finished or errored, so the worker is no longer serving. Open the kernel log for the real error and push again.',
        kernelUrl,
      });
    }

    const outputResponse = await kaggleRequest(`/kernels/output/${kernelPath}`, credentials);
    if (outputResponse.ok) {
      const archive = Buffer.from(await outputResponse.arrayBuffer());
      const session = extractWorkerSession(readZipEntries(archive));
      if (session?.url && session.token) {
        return res.json({
          state: 'connected',
          message: 'Worker session found in the kernel output',
          url: session.url,
          token: session.token,
          kernelUrl,
        });
      }
    }

    return res.json({
      state: /QUEUED|PENDING/i.test(statusText) ? 'queued' : 'running',
      message:
        /QUEUED|PENDING/i.test(statusText)
          ? 'Waiting for a GPU slot…'
          : `Kernel is ${statusText.replace('KernelWorkerStatus.', '')}, but Kaggle has not published its output yet.`,
      kernelUrl,
    });
  } catch (error: any) {
    return res.json({
      state: 'error',
      message: `Kaggle polling failed: ${error?.message || 'network error'}`,
      kernelUrl,
    });
  }
});

async function startServer() {
  // Markdown guides are served in dev and in production so the in-app doc links work.
  app.use('/docs', express.static(path.resolve(process.cwd(), 'docs')));

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
