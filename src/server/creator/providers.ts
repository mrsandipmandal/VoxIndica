import { GoogleGenAI } from '@google/genai';
import type {
  CreatorLanguage,
  CreatorProviderId,
  CreatorTone,
  CreatorVideoMode,
  GenerateScriptInput,
  ScriptAttempt,
  ScriptContent,
  ScriptDocument
} from '../../types/creator';
import { scriptContentSchema, zodMessage } from './schema';

interface ProviderConfig {
  id: CreatorProviderId;
  label: string;
  model: string;
  apiKey: string;
}

class ProviderCallError extends Error {
  retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = 'ProviderCallError';
    this.retryable = retryable;
  }
}

const LANGUAGE_NAMES: Record<CreatorLanguage, string> = {
  'bn-IN': 'Bengali (Bangla, bn-IN)',
  'hi-IN': 'Hindi (hi-IN)',
  'en-IN': 'Indian English (en-IN)'
};

const TONE_GUIDES: Record<CreatorTone, string> = {
  news: 'a calm, factual news anchor: short sentences, attributable claims, no hype',
  educational: 'a clear teacher: one idea per scene, concrete examples, simple vocabulary',
  documentary: 'a measured documentary narrator: atmosphere, context, deliberate pacing',
  tech: 'a sharp technology explainer: precise terms, but define them in plain language',
  travel: 'an evocative travel host: sensory detail, local names, practical tips',
  storytelling: 'a character-led storyteller: tension, small details, emotional payoff'
};

const MODE_GUIDES: Record<CreatorVideoMode, string> = {
  presenter: 'a human presenter speaking to camera; scenes describe framing and gestures',
  cinematic: 'cinematic B-roll with no presenter; scenes describe shots, motion and atmosphere',
  hybrid: 'a presenter framed against B-roll cutaways; mark which scenes need the presenter'
};

function providerConfigs(): ProviderConfig[] {
  return [
    {
      id: 'gemini',
      label: 'Gemini',
      model: process.env.GEMINI_SCRIPT_MODEL || 'gemini-2.5-flash',
      apiKey: process.env.GEMINI_API_KEY || ''
    },
    {
      id: 'groq',
      label: 'Groq',
      model: process.env.GROQ_SCRIPT_MODEL || 'llama-3.3-70b-versatile',
      apiKey: process.env.GROQ_API_KEY || ''
    },
    {
      id: 'openrouter',
      label: 'OpenRouter',
      model: process.env.OPENROUTER_SCRIPT_MODEL || 'google/gemini-2.5-flash',
      apiKey: process.env.OPENROUTER_API_KEY || ''
    }
  ];
}

export function providerStatus(): Record<
  CreatorProviderId,
  { configured: boolean; model: string }
> {
  return providerConfigs().reduce(
    (acc, provider) => {
      acc[provider.id] = {
        configured: Boolean(provider.apiKey),
        model: provider.model
      };
      return acc;
    },
    {} as Record<CreatorProviderId, { configured: boolean; model: string }>
  );
}

function buildPrompt(input: GenerateScriptInput): string {
  const sceneCount = Math.max(3, Math.min(12, Math.round(input.targetDurationSeconds / 8)));

  return `You write production-ready short-form video scripts for VoxIndica Creator Studio.

TARGET
- Topic: ${input.topic}
- Output language: ${LANGUAGE_NAMES[input.language]}. Every viewer-facing string (title, hook, script,
  scenes, subtitles, description, chapters, hashtags, thumbnail prompt, disclosure) must be in this
  language. JSON keys stay in English.
- Tone: ${TONE_GUIDES[input.tone]}.
- Audience: ${input.audience || 'general online viewers'}.
- Target length: ${input.targetDurationSeconds} seconds of spoken narration.
- Video mode: ${MODE_GUIDES[input.videoMode]}.
- Scene count: exactly ${sceneCount} scenes. The sum of scene durationSeconds must be within 10% of
  ${input.targetDurationSeconds}.
${input.extraInstructions ? `- Extra instructions from the creator: ${input.extraInstructions}\n` : ''}
RULES
1. Return ONLY a single JSON object. No markdown fences, no commentary, no trailing text.
2. Never invent statistics, quotes, dates or sources. If a claim needs a source you do not have,
   leave the sources array empty and phrase the claim cautiously.
3. The hook must work in the first 3 seconds.
4. Each scene needs a concrete visual prompt that a videographer or an AI video model can execute,
   a camera instruction, a transition, and a short on-screen subtitle.
5. The disclosure must state that the narration may be synthesized and, when applicable, that the
   presenter is an AI-generated likeness.
6. Chapters use timestamps in mm:ss derived from the scene order.

JSON SHAPE
{
  "title": "string",
  "hook": "string",
  "script": "the full narration as one string",
  "scenes": [
    {
      "id": "scene-1",
      "voiceText": "narration for this scene",
      "visualPrompt": "what the viewer sees",
      "videoType": "b-roll | presenter | animation | graphic",
      "camera": "e.g. medium shot, slow push-in",
      "subtitle": "short on-screen caption",
      "transition": "e.g. cut, dissolve, whip pan",
      "durationSeconds": 6
    }
  ],
  "description": "YouTube description",
  "tags": ["tag"],
  "hashtags": ["#tag"],
  "chapters": [{ "title": "chapter", "timestamp": "00:00" }],
  "thumbnailPrompt": "image-generation prompt for the thumbnail",
  "sources": ["URL or citation, or empty"],
  "disclosure": "AI disclosure line"
}`;
}

function extractJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new ProviderCallError('The provider returned no JSON object.', true);
  }
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch (error: any) {
    throw new ProviderCallError(`The provider returned invalid JSON: ${error?.message || error}`, true);
  }
}

function normalizeRaw(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const value = raw as Record<string, any>;
  const scenes = Array.isArray(value.scenes)
    ? value.scenes.map((scene: any, index: number) => ({
        id:
          typeof scene?.id === 'string' && scene.id.trim()
            ? scene.id
            : `scene-${index + 1}`,
        voiceText: scene?.voiceText ?? scene?.voice_text ?? '',
        visualPrompt: scene?.visualPrompt ?? scene?.visual_prompt ?? '',
        videoType: scene?.videoType ?? scene?.video_type ?? 'b-roll',
        camera: scene?.camera ?? 'medium shot',
        subtitle: scene?.subtitle ?? '',
        transition: scene?.transition ?? 'cut',
        durationSeconds: scene?.durationSeconds ?? scene?.duration ?? 5
      }))
    : value.scenes;

  return {
    title: value.title ?? '',
    hook: value.hook ?? '',
    script: value.script ?? value.fullScript ?? '',
    scenes,
    description: value.description ?? '',
    tags: value.tags ?? [],
    hashtags: value.hashtags ?? value.hashTags ?? [],
    chapters: value.chapters ?? [],
    thumbnailPrompt: value.thumbnailPrompt ?? value.thumbnail_prompt ?? '',
    sources: value.sources ?? [],
    disclosure: value.disclosure ?? ''
  };
}

function validateScript(raw: unknown): ScriptContent {
  const parsed = scriptContentSchema.safeParse(normalizeRaw(raw));
  if (!parsed.success) {
    throw new ProviderCallError(
      `The provider JSON did not match the script schema: ${zodMessage(parsed.error)}`,
      true
    );
  }
  return parsed.data;
}

function classifyGeminiError(error: any): ProviderCallError {
  const message = String(error?.message || error || 'Gemini request failed');
  const text = message.toLowerCase();
  if (text.includes('api key') || text.includes('api_key_invalid') || /\b(401|403)\b/.test(message)) {
    return new ProviderCallError(`Gemini rejected the API key: ${message}`, false);
  }
  if (text.includes('not found') || /\b404\b/.test(message)) {
    return new ProviderCallError(
      `Gemini model or endpoint was not found: ${message}. Set GEMINI_SCRIPT_MODEL to a model your key can use.`,
      false
    );
  }
  if (/\b(429|500|502|503|504)\b/.test(message) || text.includes('quota') || text.includes('timeout')) {
    return new ProviderCallError(`Gemini is unavailable: ${message}`, true);
  }
  return new ProviderCallError(`Gemini failed: ${message}`, true);
}

async function callGemini(config: ProviderConfig, prompt: string): Promise<string> {
  const ai = new GoogleGenAI({
    apiKey: config.apiKey,
    httpOptions: { headers: { 'User-Agent': 'voxindica-creator' } }
  });

  try {
    const response = await ai.models.generateContent({
      model: config.model,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        responseMimeType: 'application/json',
        temperature: 0.8
      }
    });
    const text =
      (response as any)?.text ||
      (response as any)?.candidates?.[0]?.content?.parts
        ?.map((part: any) => part?.text || '')
        .join('') ||
      '';
    if (!text.trim()) throw new ProviderCallError('Gemini returned an empty response.', true);
    return text;
  } catch (error: any) {
    if (error instanceof ProviderCallError) throw error;
    throw classifyGeminiError(error);
  }
}

async function callOpenAiCompatible(
  config: ProviderConfig,
  url: string,
  prompt: string,
  extraHeaders: Record<string, string> = {}
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
        ...extraHeaders
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.8,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'You are a script engine. Reply with one JSON object only. Never wrap it in markdown.'
          },
          { role: 'user', content: prompt }
        ]
      }),
      signal: controller.signal
    });

    const raw = await response.text();
    if (!response.ok) {
      let detail = raw.slice(0, 500);
      try {
        const parsed = JSON.parse(raw);
        detail = parsed?.error?.message || parsed?.message || detail;
      } catch {
        // Keep the raw body snippet.
      }
      const retryable = response.status === 429 || response.status >= 500;
      throw new ProviderCallError(
        `${config.label} returned HTTP ${response.status}: ${detail}`,
        retryable
      );
    }

    let payload: any;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new ProviderCallError(`${config.label} returned a non-JSON HTTP body.`, true);
    }

    const content = payload?.choices?.[0]?.message?.content;
    const text = Array.isArray(content)
      ? content.map((part: any) => part?.text || '').join('')
      : String(content || '');
    if (!text.trim()) throw new ProviderCallError(`${config.label} returned an empty response.`, true);
    return text;
  } catch (error: any) {
    if (error instanceof ProviderCallError) throw error;
    if (error?.name === 'AbortError') {
      throw new ProviderCallError(`${config.label} timed out after 90s.`, true);
    }
    throw new ProviderCallError(`${config.label} request failed: ${error?.message || error}`, true);
  } finally {
    clearTimeout(timer);
  }
}

function callProvider(config: ProviderConfig, prompt: string): Promise<string> {
  if (config.id === 'gemini') return callGemini(config, prompt);
  if (config.id === 'groq') {
    return callOpenAiCompatible(
      config,
      'https://api.groq.com/openai/v1/chat/completions',
      prompt
    );
  }
  return callOpenAiCompatible(
    config,
    'https://openrouter.ai/api/v1/chat/completions',
    prompt,
    {
      'HTTP-Referer': process.env.APP_URL || 'http://localhost:3000',
      'X-Title': 'VoxIndica Creator Studio'
    }
  );
}

function attemptSummary(attempts: ScriptAttempt[]): string {
  return attempts
    .filter((attempt) => attempt.outcome !== 'ok')
    .map((attempt) => `${attempt.provider}: ${attempt.message}`)
    .join(' | ');
}

export async function generateScript(
  input: GenerateScriptInput
): Promise<{ script: ScriptDocument; attempts: ScriptAttempt[] }> {
  const prompt = buildPrompt(input);
  const attempts: ScriptAttempt[] = [];
  const configs = providerConfigs();

  if (!configs.some((config) => config.apiKey)) {
    throw new Error(
      'No script provider is configured. Add GEMINI_API_KEY, GROQ_API_KEY or OPENROUTER_API_KEY to .env and restart the server.'
    );
  }

  for (const config of configs) {
    if (!config.apiKey) {
      attempts.push({
        provider: config.id,
        model: config.model,
        outcome: 'skipped',
        message: 'API key not set',
        latencyMs: 0
      });
      continue;
    }

    const startedAt = Date.now();
    try {
      const text = await callProvider(config, prompt);
      const content = validateScript(extractJson(text));
      const latencyMs = Date.now() - startedAt;
      attempts.push({
        provider: config.id,
        model: config.model,
        outcome: 'ok',
        message: 'Script generated and validated.',
        latencyMs
      });
      return {
        script: {
          ...content,
          meta: {
            provider: config.id,
            model: config.model,
            generatedAt: new Date().toISOString(),
            latencyMs
          }
        },
        attempts
      };
    } catch (error: any) {
      const latencyMs = Date.now() - startedAt;
      const callError =
        error instanceof ProviderCallError
          ? error
          : new ProviderCallError(String(error?.message || error), true);
      attempts.push({
        provider: config.id,
        model: config.model,
        outcome: 'failed',
        message: callError.message,
        latencyMs
      });
      if (!callError.retryable) {
        throw new Error(`${config.label} cannot be used: ${callError.message}`);
      }
    }
  }

  const detail = attemptSummary(attempts);
  throw new Error(
    `All configured script providers failed. ${detail || 'No provider produced valid output.'}`
  );
}
