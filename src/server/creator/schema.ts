import { z } from 'zod';
import {
  CREATOR_LANGUAGES,
  CREATOR_STATUSES,
  CREATOR_TONES,
  CREATOR_VIDEO_MODES,
  CREATOR_WORKER_PROVIDERS,
  RENDER_PRESETS
} from '../../types/creator';

const languageSchema = z.enum(CREATOR_LANGUAGES);
const toneSchema = z.enum(CREATOR_TONES);
const videoModeSchema = z.enum(CREATOR_VIDEO_MODES);
const statusSchema = z.enum(CREATOR_STATUSES);

export const sceneSchema = z.object({
  id: z.string().min(1).max(64),
  voiceText: z.string().min(1).max(4000),
  visualPrompt: z.string().min(1).max(2000),
  videoType: z.string().min(1).max(120).default('b-roll'),
  camera: z.string().min(1).max(200).default('medium shot'),
  subtitle: z.string().max(400).default(''),
  transition: z.string().min(1).max(120).default('cut'),
  durationSeconds: z.coerce.number().min(1).max(120)
});

export const chapterSchema = z.object({
  title: z.string().min(1).max(200),
  timestamp: z.string().min(1).max(32)
});

export const scriptContentSchema = z.object({
  title: z.string().min(3).max(200),
  hook: z.string().min(3).max(3000),
  script: z.string().min(10).max(40000),
  scenes: z.array(sceneSchema).min(1).max(24),
  description: z.string().max(5000).default(''),
  tags: z.array(z.string().max(80)).max(30).default([]),
  hashtags: z.array(z.string().max(80)).max(30).default([]),
  chapters: z.array(chapterSchema).max(24).default([]),
  thumbnailPrompt: z.string().max(3000).default(''),
  sources: z.array(z.string().max(500)).max(20).default([]),
  disclosure: z.string().max(1000).default('')
});

export const createProjectSchema = z.object({
  topic: z.string().trim().min(3).max(500),
  language: languageSchema,
  tone: toneSchema,
  audience: z.string().trim().max(300).default(''),
  targetDurationSeconds: z.coerce.number().int().min(10).max(900).default(60),
  videoMode: videoModeSchema,
  extraInstructions: z.string().trim().max(2000).default('')
});

export const updateProjectSchema = z.object({
  topic: z.string().trim().min(3).max(500).optional(),
  language: languageSchema.optional(),
  tone: toneSchema.optional(),
  audience: z.string().trim().max(300).optional(),
  targetDurationSeconds: z.coerce.number().int().min(10).max(900).optional(),
  videoMode: videoModeSchema.optional(),
  extraInstructions: z.string().trim().max(2000).optional(),
  status: statusSchema.optional(),
  script: scriptContentSchema.nullable().optional()
});

export const generateScriptSchema = z.object({
  projectId: z.string().uuid().optional(),
  topic: z.string().trim().min(3).max(500),
  language: languageSchema,
  tone: toneSchema,
  audience: z.string().trim().max(300).default(''),
  targetDurationSeconds: z.coerce.number().int().min(10).max(900).default(60),
  videoMode: videoModeSchema,
  extraInstructions: z.string().trim().max(2000).default('')
});

export const consentSchema = z.object({
  presenterName: z.string().trim().min(2).max(120),
  confirmed: z.literal(true),
  notes: z.string().trim().max(1000).default('')
});

export const startVoiceJobSchema = z.object({
  provider: z.enum(CREATOR_WORKER_PROVIDERS),
  workerUrl: z.string().trim().min(8).max(500),
  workerToken: z.string().max(500).optional().default(''),
  referenceAssetId: z.string().uuid().optional(),
  promptText: z.string().trim().max(2000).optional().default(''),
  voiceName: z.string().trim().max(120).optional().default(''),
  regenerateSceneIds: z.array(z.string().min(1).max(64)).max(48).optional()
});

export const startRenderSchema = z.object({
  burnCaptions: z.boolean().optional().default(false),
  preset: z.enum(RENDER_PRESETS).optional().default('landscape')
});

export const generateThumbnailSchema = z.object({
  prompt: z.string().trim().max(3000).optional()
});

export const assetUploadSchema = z.object({
  kind: z.enum([
    'presenter_photo',
    'reference_audio',
    'scene_audio',
    'scene_visual',
    'final_video',
    'thumbnail',
    'other'
  ]),
  fileName: z.string().trim().min(1).max(200),
  mimeType: z.string().trim().min(3).max(120),
  dataBase64: z.string().min(16),
  sceneId: z.string().min(1).max(64).optional(),
  generatedBy: z.string().trim().max(200).optional()
});

export type CreateProjectBody = z.infer<typeof createProjectSchema>;
export type UpdateProjectBody = z.infer<typeof updateProjectSchema>;
export type GenerateScriptBody = z.infer<typeof generateScriptSchema>;
export type ConsentBody = z.infer<typeof consentSchema>;
export type AssetUploadBody = z.infer<typeof assetUploadSchema>;
export type StartVoiceJobBody = z.infer<typeof startVoiceJobSchema>;
export type StartRenderBody = z.infer<typeof startRenderSchema>;
export type ScriptContentBody = z.infer<typeof scriptContentSchema>;

export function zodMessage(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length ? issue.path.join('.') : 'body';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
}
