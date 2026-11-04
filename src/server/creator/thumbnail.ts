/**
 * Thumbnail generation via Gemini image models.
 *
 * Generation is deliberately two-step: this module only returns a candidate
 * image to the browser. Nothing is persisted until the creator explicitly
 * approves it through the normal `thumbnail` asset upload. If no image provider
 * is configured the caller gets a real error — never a placeholder image.
 */
import { GoogleGenAI } from '@google/genai';
import type { CreatorProject } from '../../types/creator';
import { CreatorError, readProject } from './storage';

const DEFAULT_MODEL = 'gemini-2.5-flash-image';
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export interface ThumbnailProviderStatus {
  configured: boolean;
  model: string;
}

export interface GeneratedThumbnail {
  base64: string;
  mimeType: string;
  provider: 'gemini';
  model: string;
  prompt: string;
}

export function thumbnailProviderStatus(): ThumbnailProviderStatus {
  return {
    configured: Boolean(process.env.GEMINI_API_KEY),
    model: process.env.GEMINI_IMAGE_MODEL || DEFAULT_MODEL
  };
}

function buildPrompt(project: CreatorProject, requested: string): string {
  const script = project.script;
  const title = script?.title || project.topic;
  const language =
    project.language === 'bn-IN'
      ? 'Bengali'
      : project.language === 'hi-IN'
        ? 'Hindi'
        : 'Indian English';
  const base = requested.trim() || script?.thumbnailPrompt?.trim() || title;
  return [
    'Create a single 16:9 YouTube thumbnail image.',
    `Video title: ${title}`,
    `Audience language: ${language}.`,
    `Visual direction: ${base}`,
    'High contrast, readable at small size, one clear focal subject, cinematic lighting.',
    'Do not render long text, captions, logos, watermarks or UI chrome into the image.',
    'Return the image only.'
  ].join('\n');
}

function detectImageMime(buffer: Buffer): string | null {
  if (
    buffer.length > 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return 'image/png';
  }
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buffer.length > 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

function providerError(error: any): CreatorError {
  const message = String(error?.message || error || 'Thumbnail generation failed.');
  const text = message.toLowerCase();
  if (text.includes('api key') || /\b(401|403)\b/.test(message)) {
    return new CreatorError(
      `Gemini rejected the image provider key: ${message}. Check GEMINI_API_KEY.`,
      502
    );
  }
  if (text.includes('not found') || /\b404\b/.test(message)) {
    return new CreatorError(
      `The Gemini image model was not found: ${message}. Set GEMINI_IMAGE_MODEL to a model your key can use.`,
      502
    );
  }
  if (/\b429\b/.test(message) || /\b5\d\d\b/.test(message)) {
    return new CreatorError(`Gemini image generation is unavailable: ${message}`, 503);
  }
  return new CreatorError(`Gemini image generation failed: ${message}`, 502);
}

export async function generateThumbnail(
  projectId: string,
  requestedPrompt?: string
): Promise<GeneratedThumbnail> {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_IMAGE_MODEL || DEFAULT_MODEL;
  if (!apiKey) {
    throw new CreatorError(
      'Thumbnail generation requires GEMINI_API_KEY on the server. Add it to .env and restart, or upload an image you approve.',
      503
    );
  }

  const project = await readProject(projectId);
  if (!project.script) {
    throw new CreatorError('Generate a script before creating a thumbnail.', 400);
  }

  const prompt = buildPrompt(project, requestedPrompt || '');
  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: { headers: { 'User-Agent': 'voxindica-creator' } }
  });

  let response: any;
  try {
    response = await ai.models.generateContent({
      model,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { responseModalities: ['TEXT', 'IMAGE'] }
    });
  } catch (error: any) {
    throw providerError(error);
  }

  const parts: any[] = response?.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find((part) => part?.inlineData?.data);
  if (!imagePart) {
    const text = parts
      .map((part) => part?.text || '')
      .join(' ')
      .trim();
    throw new CreatorError(
      `Gemini returned no image${text ? ` (it said: ${text.slice(0, 300)})` : ''}. Nothing was saved.`,
      502
    );
  }

  const base64 = String(imagePart.inlineData.data).replace(/^data:[^;]+;base64,/, '');
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length) {
    throw new CreatorError('Gemini returned an empty image. Nothing was saved.', 502);
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new CreatorError(
      `Gemini returned an image larger than ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB. Nothing was saved.`,
      502
    );
  }
  const mimeType = detectImageMime(buffer);
  if (!mimeType) {
    throw new CreatorError('Gemini returned data that is not a PNG, JPEG or WebP image.', 502);
  }

  return {
    base64: buffer.toString('base64'),
    mimeType,
    provider: 'gemini',
    model,
    prompt
  };
}
