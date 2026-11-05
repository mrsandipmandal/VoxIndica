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

export const SCENE_TRANSITIONS = ['cut', 'fade', 'flash'] as const;
export type SceneTransition = (typeof SCENE_TRANSITIONS)[number];

export const SCENE_TRANSITION_LABELS: Record<SceneTransition, string> = {
  cut: 'Cut',
  fade: 'Fade through black',
  flash: 'Flash through white'
};

/**
 * Map generated or legacy values onto the transitions the local renderer can
 * actually produce. A true overlap crossfade would shorten the programme and
 * move every caption timestamp, so those values become a fade through black.
 */
export function normalizeSceneTransition(
  value: string | null | undefined
): SceneTransition {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
  if (
    [
      'fade',
      'fade-in',
      'fade-out',
      'fade-to-black',
      'fade-through-black',
      'dip',
      'dip-to-black',
      'dissolve',
      'crossfade',
      'cross-fade',
      'black'
    ].includes(normalized)
  ) {
    return 'fade';
  }
  if (
    ['flash', 'flash-white', 'white-flash', 'flash-through-white', 'white'].includes(
      normalized
    )
  ) {
    return 'flash';
  }
  return 'cut';
}

export interface CreatorScene {
  id: string;
  voiceText: string;
  visualPrompt: string;
  videoType: string;
  camera: string;
  subtitle: string;
  transition: SceneTransition;
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
  | 'music_bed'
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

export const CAPTION_POSITIONS = ['bottom', 'middle', 'top'] as const;
export type CaptionPosition = (typeof CAPTION_POSITIONS)[number];

export interface CaptionStyle {
  /** Multiplier applied to the language-aware base font size. */
  fontScale: number;
  /** #RRGGBB text colour. */
  textColor: string;
  /** #RRGGBB outline colour. */
  outlineColor: string;
  outlineWidth: number;
  position: CaptionPosition;
  /** Draw an opaque box behind the text instead of an outline only. */
  background: boolean;
}

export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  fontScale: 1,
  textColor: '#FFFFFF',
  outlineColor: '#000000',
  outlineWidth: 3,
  position: 'bottom',
  background: false
};

export const RENDER_PRESETS = ['landscape', 'portrait', 'square'] as const;
export type RenderPreset = (typeof RENDER_PRESETS)[number];

export const RENDER_PRESET_DIMENSIONS: Record<
  RenderPreset,
  { width: number; height: number; label: string }
> = {
  landscape: { width: 1280, height: 720, label: 'Landscape 16:9' },
  portrait: { width: 720, height: 1280, label: 'Portrait 9:16' },
  square: { width: 960, height: 960, label: 'Square 1:1' }
};

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
  /** Inputs that produced this clip; changing any of them invalidates it. */
  audioAssetId?: string;
  visualAssetId?: string;
  /** Transition into this scene, snapshotted when the job starts. */
  transition: SceneTransition;
  /** Transition from this scene into the next one. */
  outgoingTransition: SceneTransition;
}

/**
 * Real render state. `scenes` is a checkpoint of scene clips that exist on
 * disk; a restarted server can resume without re-encoding finished scenes.
 */
export interface RenderAudioOptions {
  /** Uploaded music bed asset, or null for narration only. */
  musicAssetId: string | null;
  /** 0–1 gain applied to the music bed before ducking. */
  musicVolume: number;
  /** Normalize the final mix to -14 LUFS. */
  normalizeAudio: boolean;
}

export interface RenderJob {
  id: string;
  provider: 'local';
  preset: RenderPreset;
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
  /** Caption style snapshot used when burning captions. */
  captionStyle: CaptionStyle;
  /** Audio mix snapshot used for this render. */
  audio: RenderAudioOptions;
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
  captionStyle: CaptionStyle;
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
  captionStyle?: Partial<CaptionStyle>;
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
