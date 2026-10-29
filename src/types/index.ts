export type SupportedLanguage = 'bn-IN' | 'hi-IN' | 'en-IN';

export type TaskType = 'tts' | 'voice_clone';

export type InferenceProvider = 'local' | 'huggingface' | 'kaggle' | 'colab';

export type JobStatus = 'idle' | 'queued' | 'running' | 'completed' | 'failed' | 'disconnected';

export interface ApiKeyRecord {
  id: string;
  provider: InferenceProvider;
  label: string;
  keyOrToken: string;
  endpointUrl?: string;
  createdAt: string;
  isActive: boolean;
  accountDetails?: string;
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
