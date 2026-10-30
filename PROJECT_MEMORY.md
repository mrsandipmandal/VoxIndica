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

## API-First Provider Layer (branch `feat/api-first-providers`)

### Single source of truth
- `workers/voxindica_worker_core.py` — one FastAPI worker used by Kaggle, Colab and local.
  - `GET /health` (no auth): real platform, GPU name, VRAM, model-loaded flag, sample rate.
  - `POST /clone_voice` / `POST /synthesize` (bearer): real VoxCPM2 `generate(text, reference_wav_path, cfg_value=2.0, inference_timesteps=8)`.
  - Chunked synthesis (`VOXINDICA_CHUNK_CHARS`, default 800), 16-bit mono PCM WAV at `model.tts_model.sample_rate`.
  - Model failure → HTTP 503 with the underlying exception; inference failure → HTTP 500. **No synthetic fallback audio.**
  - `detect_platform()`, `split_text()`, `pcm16_wav_bytes()`, `decode_reference_audio()` (RIFF/WAVE, ≤25 MB), `start_tunnel()` (cloudflared), `worker_session.json`.
- Regenerate every artifact with `python workers/build_notebooks.py`:
  - `notebooks/kaggle/voxindica_worker.ipynb`, `notebooks/colab/voxindica_worker.ipynb` (16 cells, identical order)
  - `notebooks/kaggle/kernel-metadata.json` (GPU + internet, private)
  - `public/notebooks/*.ipynb`, `public/workers/voxindica_worker_{kaggle,colab,local}.py`
  - `src/data/workerScripts.ts`

### Studio plumbing
- `src/utils/hardware.ts`: browser hardware (WebGL unmasked renderer, CPU threads, deviceMemory, WebGPU/WASM). Unknown values stay `null`.
- `src/services/providerService.ts`:
  - `probeWorker()` → real `/health` fetch with timeout; `applyWorkerHealth()` writes only measured values.
  - Stored `isConnected` older than 10 minutes is downgraded to "unverified" on load; local is never restored as connected.
  - Any `trycloudflare.com`/`ngrok` hostname is no longer treated as live.
  - Worker-backed jobs on an offline provider throw instead of silently using the formant preview.
- `server.ts`:
  - `/api/tts` routes `local|kaggle|colab` (and any clone request with a worker URL) to `/clone_voice`, bounded by `WORKER_TIMEOUT_MS` (default 120000); failures return 502/504 with the worker's real message.
  - `/api/providers/kaggle/test|launch|poll`: HTTP Basic proxy to `https://www.kaggle.com/api/v1` (`/kernels/list`, `/kernels/push` multipart, `/kernels/status`, `/kernels/output` zip parsed in-process via `zlib`). Credentials arrive per request and are never stored.
  - `/docs` is served in dev and production so in-app documentation links resolve.
- `ProviderModal.tsx`: API/CLI switch (API default), per-provider credential cards, browser vs. worker hardware separated, Kaggle verify + Launch flow, Colab browser-flow explainer, session vault.
- `WorkerScriptModal.tsx`: renders the generated bundles (download `.ipynb`/`.py`, copy, docs).

### Honest limitations (documented, not hidden)
- Consumer Google Colab has no runtime API and no official CLI — browser Run-all only (or Colab Enterprise on Vertex AI).
- Kaggle publishes kernel output only after a kernel finishes, and a worker kernel never finishes; the Launch flow therefore may stop at "running" and ask for the URL from the live log.
- Hugging Face serverless will not reliably serve VoxCPM2-class cloning; use an Inference Endpoint or the worker.
- Kaggle GPU sessions stop after ~12 hours; Colab frees idle runtimes. The Studio reports `Disconnected`, never a fabricated countdown.

### Verification status
- Verified: `npx tsc --noEmit` (clean), `npm run build` (vite, 423 kB bundle), `curl` smoke test of `/docs`, `/notebooks/*.ipynb`, `/api/providers/kaggle/test`, and FastAPI TestClient runs of `/clone_voice` (200 with audio, 401 without token, 500 on model exception, 503 when the model is absent).
- Not verified here: live Kaggle API calls (no account credentials in this environment) and real VoxCPM2 inference (no GPU, no `voxcpm` package installed; local Python is 3.14, torch wheels target 3.10–3.12).
