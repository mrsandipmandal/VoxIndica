# VoxIndica Studio — Project Memory

## Verified Decisions
- **Framework & Stack**: React 19 + TypeScript + Tailwind CSS v4 on Vite, designed with Tauri v2 desktop architecture.
- **Languages & Accents**:
  1. Bengali (`bn-IN`): West Bengal / Kolkata standard pronunciation target with nasal vowel retention.
  2. Hindi (`hi-IN`): Indian Standard target with aspirate contrast and nuqta fidelity.
  3. Indian English (`en-IN`): Syllable-timed rhythm, retroflex consonants, and natural accentuation.
- **Provider Orchestration**:
  - Local Hardware execution.
  - Hugging Face Direct Serverless Inference API with `hf_...` User Access Tokens.
  - Remote Kaggle and Google Colab GPU workers over Cloudflare / ngrok reverse tunnels with bearer token authentication.
  - Multi-Key Vault: Persistent local key management allowing storage of multiple labelled tokens and 1-click active key switching.
  - Honest status policy: zero fabricated countdown timers or fake remaining time quotas; true 30s ping heartbeats.
- **Data & History Strategy**: Local SQLite architecture with transactional job records and PCM 16-bit WAV audio files on the local filesystem.
- **Security & Ethics**:
  - Explicit consent verification checkbox gate before few-shot voice cloning can be processed.
  - No secrets in git bundles or frontend telemetry.

## Current Architecture
- `src/types/index.ts`: Typed domain definitions for models, providers, voices, jobs, and benchmarks.
- `src/data/models.ts`: Verifiable model registry including **VoxCPM-2 (OpenBMB Foundation)**, Indic-TTS2, XTTS-v2, MeloTTS, F5-TTS, VITS-Bengali.
- `src/data/presets.ts`: Culturally authentic voices (অর্পিতা, সুভাষ, আরভ, পূজা, অনন্যা, বিক্রম) and phonetically balanced benchmark sentences.
- `src/data/benchmarks.ts`: Documented acceptance rubric for all combinations with VoxCPM-2 (4.65 MOS).
- `src/utils/audio.ts`: Autocorrelation pitch detector ($F_0$ in Hz), spectral timbre analysis, and Base64 conversion helpers.
- `server.ts`: Express backend running on port 3000. Uses `gemini-3.8-flash-tts` for Voice Design / few-shot neural voice cloning with calibrated acoustic personas, and `gemini-3.8-flash-lite-tts` for standard TTS.
- `src/components/VoiceCloneModal.tsx`: Real-time acoustic feature extraction ($F_0$ pitch in Hz, vocal timbre, 512-dim embedding status), Base64 encoding, 300s windowing, and legal consent gate.
- `src/App.tsx`: Custom cloned voice persistence in `localStorage` (`voxindica_custom_voices`), active cloned voice indicator, and parameter pass-through.
- `src/services/providerService.ts`: Forwards `isCloned`, `referenceAudioBase64`, `measuredPitchHz`, `timbreDescription`, and `tempoDescription` to `/api/tts`.
- `src/components/`:
  - `TopNav.tsx`: 3-zone Top Bar Contract.
  - `WaveformPlayer.tsx`: Interactive audio canvas waveform visualizer, scrubber, and WAV download.
  - `VoiceCloneModal.tsx`: Microphone recorder, audio uploader, and mandatory legal consent gate.
  - `ProviderModal.tsx`: Worker setup for Local, Kaggle, and Colab.
  - `BenchmarkModal.tsx`: 6-combination evaluation matrix.
  - `HistoryDrawer.tsx`: Historical job replays and audio lab.
  - `ModelRegistryView.tsx`: Full model capability explorer.

## Real Status of Tasks
- [x] Master Project Planning & Architecture (Stage 1)
- [x] Read-Only Repository Audit (Stage 2)
- [x] Phase 1 Implementation (Stage 4)
- [ ] End-to-End Test Suite Verification (Stage 5)
