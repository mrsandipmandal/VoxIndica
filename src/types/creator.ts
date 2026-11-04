/**
 * VoxIndica Creator Studio — domain types.
 *
 * These types are the contract between the browser, the Express creator
 * routes and the on-disk project store. Every field the UI renders is
 * persisted in `data/projects/<id>/project.json`; nothing is synthesized
 * in the client for display.
 */

export const CREATOR_LANGUAGES = ['bn-IN', 'hi-IN', 'en-IN'] as const;
export type CreatorLanguage = (typeof CREATOR_LANGUAGES)[number];

export const CREATOR_TONES = [
  'news',
  'educational',
  'documentary',
  'tech',
  'travel',
  'storytelling'
] as const;
export type CreatorTone = (typeof CREATOR_TONES)[number];

export const CREATOR_VIDEO_MODES = ['presenter', 'cinematic', 'hybrid'] as const;
export type CreatorVideoMode = (typeof CREATOR_VIDEO_MODES)[number];

export const CREATOR_STATUSES = [
  'draft',
  'script_ready',
  'voice_ready',
  'assets_ready',
  'rendering',
  'ready',
  'failed'
] as const;
export type CreatorProjectStatus = (typeof CREATOR_STATUSES)[number];

export type CreatorProviderId = 'gemini' | 'groq' | 'openrouter';
export type ScriptProviderId = CreatorProviderId | 'manual';

export interface ScriptGenerationMeta {
  provider: ScriptProviderId;
  model: string;
  generatedAt: string;
  latencyMs: number;
}

export interface CreatorChapter {
  title: string;
  timestamp: string;
}

export interface CreatorScene {
  id: string;
  voiceText: string;
  visualPrompt: string;
  videoType: string;
  camera: string;
  subtitle: string;
  transition: string;
  durationSeconds: number;
}

export interface ScriptContent {
  title: string;
  hook: string;
  script: string;
  scenes: CreatorScene[];
  description: string;
  tags: string[];
  hashtags: string[];
  chapters: CreatorChapter[];
  thumbnailPrompt: string;
  sources: string[];
  disclosure: string;
}

export interface ScriptDocument extends ScriptContent {
  meta: ScriptGenerationMeta;
}

export type CreatorAssetKind =
  | 'presenter_photo'
  | 'reference_audio'
  | 'scene_audio'
  | 'scene_visual'
  | 'final_video'
  | 'thumbnail'
  | 'other';

export interface CreatorAsset {
  id: string;
  kind: CreatorAssetKind;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  /** Scene audio only: which scene this render belongs to. */
  sceneId?: string;
  /** Audio assets only: duration parsed from the stored WAV header. */
  durationSeconds?: number;
  /** Present when the asset was produced by a named provider rather than uploaded. */
  generatedBy?: string;
}

export interface ConsentRecord {
  presenterName: string;
  confirmed: boolean;
  confirmedAt: string;
  notes: string;
}

export type CreatorWorkerProvider = 'local' | 'kaggle' | 'colab';

export const CREATOR_WORKER_PROVIDERS = ['local', 'kaggle', 'colab'] as const;

export type VoiceJobStatus =
  | 'idle'
  | 'queued'
  | 'running'
  | 'complete'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

export interface CreatorSceneAudio {
  sceneId: string;
  assetId: string;
  durationSeconds: number;
  sampleRate: number;
  model: string;
  createdAt: string;
}

/**
 * Real voice-stage state. `scenes` is a checkpoint: every entry is an audio
 * file that exists on disk, so a restarted server can resume without
 * re-synthesizing finished scenes.
 */
export interface CreatorVoiceState {
  status: VoiceJobStatus;
  provider: CreatorWorkerProvider | null;
  voiceName: string;
  referenceAssetId: string | null;
  promptText: string;
  scenes: Record<string, CreatorSceneAudio>;
  message: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
}

export type RenderJobStatus =
  | 'idle'
  | 'queued'
  | 'running'
  | 'complete'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

export type RenderSceneStatus = 'pending' | 'running' | 'complete' | 'failed';

export interface RenderSceneState {
  sceneId: string;
  status: RenderSceneStatus;
  durationSeconds: number;
  message: string;
  updatedAt: string;
  /** Inputs that produced this clip; changing either invalidates it. */
  audioAssetId?: string;
  visualAssetId?: string;
}

/**
 * Real render state. `scenes` is a checkpoint of scene clips that exist on
 * disk; a restarted server can resume without re-encoding finished scenes.
 */
export interface RenderJob {
  id: string;
  provider: 'local';
  status: RenderJobStatus;
  progress: number;
  completedScenes: number;
  totalScenes: number;
  message: string;
  error?: string;
  startedAt: string;
  finishedAt?: string;
  updatedAt: string;
  outputAssetId?: string;
  width: number;
  height: number;
  fps: number;
  /** When true, the final assembly burns the derived ASS captions into the video. */
  burnCaptions: boolean;
  scenes: Record<string, RenderSceneState>;
}

export interface CreatorProject {
  id: string;
  topic: string;
  language: CreatorLanguage;
  tone: CreatorTone;
  audience: string;
  targetDurationSeconds: number;
  videoMode: CreatorVideoMode;
  status: CreatorProjectStatus;
  extraInstructions: string;
  createdAt: string;
  updatedAt: string;
  script: ScriptDocument | null;
  consent: ConsentRecord | null;
  assets: CreatorAsset[];
  voice: CreatorVoiceState;
  render: RenderJob | null;
}

export interface CreatorProjectSummary {
  id: string;
  topic: string;
  language: CreatorLanguage;
  tone: CreatorTone;
  videoMode: CreatorVideoMode;
  targetDurationSeconds: number;
  status: CreatorProjectStatus;
  hasScript: boolean;
  updatedAt: string;
  createdAt: string;
}

export interface CreateProjectInput {
  topic: string;
  language: CreatorLanguage;
  tone: CreatorTone;
  audience?: string;
  targetDurationSeconds: number;
  videoMode: CreatorVideoMode;
  extraInstructions?: string;
}

export interface UpdateProjectInput {
  topic?: string;
  language?: CreatorLanguage;
  tone?: CreatorTone;
  audience?: string;
  targetDurationSeconds?: number;
  videoMode?: CreatorVideoMode;
  extraInstructions?: string;
  status?: CreatorProjectStatus;
  script?: ScriptContent | null;
}

export interface GenerateScriptInput {
  projectId?: string;
  topic: string;
  language: CreatorLanguage;
  tone: CreatorTone;
  audience?: string;
  targetDurationSeconds: number;
  videoMode: CreatorVideoMode;
  extraInstructions?: string;
}

export interface ScriptAttempt {
  provider: CreatorProviderId | 'none';
  model: string;
  outcome: 'ok' | 'skipped' | 'failed';
  message: string;
  latencyMs: number;
}

export interface GenerateScriptResult {
  ok: true;
  script: ScriptDocument;
  attempts: ScriptAttempt[];
  project?: CreatorProject;
}

export interface CreatorHealth {
  ok: boolean;
  storageRoot: string;
  providers: Record<CreatorProviderId, { configured: boolean; model: string }>;
  image: { configured: boolean; model: string };
}

export interface GeneratedThumbnail {
  base64: string;
  mimeType: string;
  provider: 'gemini';
  model: string;
  prompt: string;
}

export interface StartVoiceJobInput {
  provider: CreatorWorkerProvider;
  workerUrl: string;
  workerToken?: string;
  referenceAssetId?: string;
  promptText?: string;
  voiceName?: string;
  /** Re-synthesize only these scenes; omitted scenes are skipped when audio exists. */
  regenerateSceneIds?: string[];
}

export interface CreatorVoiceJobInfo {
  status: VoiceJobStatus;
  totalScenes: number;
  completedScenes: number;
  running: boolean;
  message: string;
}
