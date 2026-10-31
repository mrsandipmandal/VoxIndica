export type SupportedLanguage = 'bn-IN' | 'hi-IN' | 'en-IN';

export type TaskType = 'tts' | 'voice_clone';

export type InferenceProvider = 'local' | 'huggingface' | 'kaggle' | 'colab';

export type JobStatus = 'idle' | 'queued' | 'running' | 'completed' | 'failed' | 'disconnected';

/** API is the default path; the CLI view only shows copyable commands. */
export type ProviderAuthMethod = 'api' | 'cli';

/**
 * Kaggle has two credential generations:
 * - `basic`: username + legacy API key (`kaggle.json`), used by www.kaggle.com/api/v1
 * - `bearer`: single access token ("Generate New Token"), used by kaggle CLI >= 1.8 / kagglehub
 */
export type KaggleAuthScheme = 'basic' | 'bearer';

/** Hardware facts read from the browser — no server round-trip required. */
export interface LocalHardwareInfo {
  gpuRenderer: string | null;
  gpuVendor: string | null;
  cpuThreads: number;
  deviceMemoryGb: number | null;
  platform: string;
  architecture: string | null;
  webgpu: boolean;
  wasm: boolean;
  /** True when the GPU string looks like software rendering (SwiftShader/llvmpipe). */
  softwareRendering: boolean;
}

/** Live result of probing a worker's GET /health endpoint. */
export interface WorkerHealth {
  online: boolean;
  status?: string;
  gpuDevice?: string;
  vramUsedMb?: number;
  vramTotalMb?: number;
  modelLoaded?: boolean;
  modelError?: string | null;
  sampleRate?: number | null;
  platform?: string;
  latencyMs?: number;
  checkedAt: string;
  errorMessage?: string;
}

export type KaggleLaunchPhase = 'idle' | 'pushing' | 'queued' | 'running' | 'connected' | 'error';

export interface KaggleLaunchState {
  phase: KaggleLaunchPhase;
  message: string;
  kernelUrl?: string;
  elapsedSeconds?: number;
}

export interface ApiKeyRecord {
  id: string;
  provider: InferenceProvider;
  label: string;
  keyOrToken: string;
  endpointUrl?: string;
  createdAt: string;
  isActive: boolean;
  accountDetails?: string;
  /** Kaggle only: which header the API accepted for this credential. */
  authScheme?: KaggleAuthScheme;
}

export interface ModelCapability {
  id: string;
  name: string;
  version: string;
  supportedTasks: TaskType[];
  supportedLanguages: SupportedLanguage[];
  verifiedAccents: {
    [key in SupportedLanguage]?: string;
  };
  minVramMb: number;
  supportsCpuFallback: boolean;
  license: string;
  permittedUse: 'commercial' | 'non-commercial' | 'research';
  providerCompatibility: InferenceProvider[];
  realTimeFactor: number; // e.g. 0.35 (lower is faster)
  meanOpinionScore: number; // 1-5 scale (MOS)
  knownLimitations: string[];
}

export interface VoicePreset {
  id: string;
  name: string;
  nativeName: string;
  language: SupportedLanguage;
  accent: string;
  gender: 'female' | 'male';
  tag: string;
  samplePrompt: string;
  speedDefault: number;
  pitchDefault: number;
  isCloned?: boolean;
  consentTimestamp?: string;
  referenceAudioUrl?: string;
  referenceAudioBase64?: string;
  referenceAudioMimeType?: string;
  measuredPitchHz?: number;
  timbreDescription?: string;
  tempoDescription?: string;
  promptText?: string;
}

export interface ProviderEndpointConfig {
  provider: InferenceProvider;
  endpointUrl: string;
  bearerToken: string;
  isConnected: boolean;
  lastPingAt?: string;
  latencyMs?: number;
  gpuDeviceName?: string;
  vramUsedMb?: number;
  vramTotalMb?: number;
  statusMessage?: string;
}

export interface SynthesisJob {
  id: string;
  text: string;
  language: SupportedLanguage;
  accent: string;
  task: TaskType;
  voice: VoicePreset;
  modelId: string;
  provider: InferenceProvider;
  speed: number;
  pitch: number;
  status: JobStatus;
  progressPercent: number;
  audioUrl?: string;
  audioDurationSeconds?: number;
  sampleRate: number;
  latencyMs?: number;
  errorMessage?: string;
  createdAt: string;
  completedAt?: string;
}

export interface BenchmarkRecord {
  id: string;
  combinationLabel: string;
  language: SupportedLanguage;
  accent: string;
  task: TaskType;
  modelName: string;
  characterErrorRate: number; // CER / WER in %
  meanOpinionScore: number; // 1.0 - 5.0
  speakerSimilarityCosine: number; // 0.0 - 1.0
  realTimeFactor: number; // RTF
  vramUsageGb: number;
  stabilityRating: 'High' | 'Medium' | 'Experimental';
  phoneticNotes: string;
}
