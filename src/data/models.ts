import { ModelCapability } from '../types';

export const MODEL_REGISTRY: ModelCapability[] = [
  {
    id: 'indic-tts-v2',
    name: 'AI4Bharat Indic-TTS2',
    version: '2.1.0',
    supportedTasks: ['tts'],
    supportedLanguages: ['bn-IN', 'hi-IN'],
    verifiedAccents: {
      'bn-IN': 'West Bengal Standard (Kolkata / Presidency division)',
      'hi-IN': 'Standard Hindi (Khariboli / Delhi-NCR standard)'
    },
    minVramMb: 4096,
    supportsCpuFallback: true,
    license: 'MIT',
    permittedUse: 'commercial',
    providerCompatibility: ['local', 'huggingface', 'kaggle', 'colab'],
    realTimeFactor: 0.28,
    meanOpinionScore: 4.35,
    knownLimitations: [
      'Occasional schwa over-retention in colloquial Bengali poetry',
      'Requires explicit devanagari nukta markers for Urdu loanwords'
    ]
  },
  {
    id: 'xtts-v2-indic',
    name: 'XTTS-v2 (Indic Enhanced)',
    version: '2.0.3',
    supportedTasks: ['tts', 'voice_clone'],
    supportedLanguages: ['bn-IN', 'hi-IN', 'en-IN'],
    verifiedAccents: {
      'bn-IN': 'West Bengal Native with nasal vowel inflection',
      'hi-IN': 'Urban North Indian Hindi',
      'en-IN': 'Indian English (Neutral Corporate / Educational)'
    },
    minVramMb: 6144,
    supportsCpuFallback: false,
    license: 'Coqui Public Model License / Open Weights',
    permittedUse: 'non-commercial',
    providerCompatibility: ['local', 'huggingface', 'kaggle', 'colab'],
    realTimeFactor: 0.42,
    meanOpinionScore: 4.48,
    knownLimitations: [
      'High GPU VRAM requirement (minimum 6GB for batch generation)',
      'Audio clips shorter than 4s degrade speaker embedding stability'
    ]
  },
  {
    id: 'melotts-in',
    name: 'MeloTTS (Indian English & Hindi)',
    version: '1.2.0',
    supportedTasks: ['tts'],
    supportedLanguages: ['hi-IN', 'en-IN'],
    verifiedAccents: {
      'hi-IN': 'Standard Conversational Hindi',
      'en-IN': 'Indian English (Non-rhotic, retroflex consonants)'
    },
    minVramMb: 2048,
    supportsCpuFallback: true,
    license: 'MIT',
    permittedUse: 'commercial',
    providerCompatibility: ['local', 'kaggle', 'colab'],
    realTimeFactor: 0.15,
    meanOpinionScore: 4.22,
    knownLimitations: [
      'Does not natively support Bengali phoneme set',
      'Slightly faster natural cadence on rapid technical terms'
    ]
  },
  {
    id: 'f5-tts-indic',
    name: 'F5-TTS Zero-Shot Clone',
    version: '1.0.1',
    supportedTasks: ['voice_clone'],
    supportedLanguages: ['bn-IN', 'hi-IN', 'en-IN'],
    verifiedAccents: {
      'bn-IN': 'West Bengal Colloquial and Formal',
      'hi-IN': 'Pan-Indian Hindi',
      'en-IN': 'Indian English'
    },
    minVramMb: 8192,
    supportsCpuFallback: false,
    license: 'CC-BY-NC-4.0',
    permittedUse: 'research',
    providerCompatibility: ['kaggle', 'colab'],
    realTimeFactor: 0.55,
    meanOpinionScore: 4.52,
    knownLimitations: [
      'Diffusion-based backbone requires fast GPU (Tesla T4, A100)',
      'Sensitive to background hiss in reference microphone audio'
    ]
  },
  {
    id: 'vits-bengali-fast',
    name: 'VITS Kolkata Phonetics',
    version: '1.0.4',
    supportedTasks: ['tts'],
    supportedLanguages: ['bn-IN'],
    verifiedAccents: {
      'bn-IN': 'West Bengal Native (Kolkata & Howrah phonology)'
    },
    minVramMb: 2048,
    supportsCpuFallback: true,
    license: 'Apache-2.0',
    permittedUse: 'commercial',
    providerCompatibility: ['local', 'kaggle', 'colab'],
    realTimeFactor: 0.19,
    meanOpinionScore: 4.28,
    knownLimitations: [
      'Specialized purely for Bengali; rejects Devanagari or Latin scripts',
      'Complex conjuncts (যুক্তবর্ণ) require normalized unicode codepoints'
    ]
  }
];
