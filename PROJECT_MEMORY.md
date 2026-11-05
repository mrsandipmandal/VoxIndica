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
- `src/components/VoiceCloneModal.tsx`: Real-time acoustic feature extraction ($F_0$ pitch in Hz, vocal timbre, 512-dim embedding status), Base64 encoding, 3–30s reference normalization, and legal consent gate.
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
- [x] Desktop Phase 2 scaffold — Tauri v2 shell, loopback Node SEA sidecar, bundled dist/docs/notebooks, app-data projects, honest desktop error page, and CI build matrix
- [ ] Desktop installer verification — GitHub Actions builds Linux deb/AppImage, Windows NSIS/MSI, and the Apple Silicon macOS DMG; each installer still needs a manual install/launch check (local compile blocked by missing WebKitGTK dev libraries; Intel macOS is not claimed by Node SEA)
- [x] Phase 3 batch webhooks — durable Studio batch jobs, HMAC-signed worker callbacks, dedicated loopback callback listener, real WAV storage, cancel/status/audio routes, and honest `503` when a remote worker lacks `VOXINDICA_PUBLIC_URL`
- [x] Batch inference console — `Batch` tab, persisted job list/detail, real terminal progress, cancel, WAV playback/download, 3–30s reference preparation and explicit consent gate
- [x] Creator Studio Phase 0 — project store, zod contracts, `/api/creator/*` routes, ZIP export
- [x] Creator Studio Phase 1 — Gemini → Groq → OpenRouter fallback, validated script, Creator Studio UI
- [x] Creator Studio Phase 4.3 — checkpointed per-scene voice stage with real progress, cancel and restart recovery
- [x] Creator Studio Phase 4.4 — checkpointed FFmpeg scene renderer (uploaded visuals + narration → 1280×720 MP4)
- [x] Creator Studio Phase 4.5 — SRT/ASS captions from real narration durations, burned-in caption render, publishing pack with computed chapters, approved-thumbnail upload
- [x] Creator Studio Phase 4.7 — approval-gated Gemini thumbnail generation (live generation needs GEMINI_API_KEY); assets are written only after the creator approves
- [x] Creator Studio Phase 4.8 — landscape, portrait and square render presets with dimension-aware clip reuse and ASS sizing
- [x] Creator Studio Phase 4.9 — licensed music-bed upload, looping, sidechain ducking, optional −14 LUFS normalization, and audio settings on the render job
- [ ] Creator Studio T4 avatar spike (notebooks generated; run on Kaggle pending)
- [ ] Creator Studio presenter stage and AI thumbnail generation (blocked on the avatar spike and an image provider)
- [x] End-to-End Test Suite Verification (Stage 5) — real Studio + temporary storage, creator HTTP contract, honest no-key failure, ZIP export, and a contract-worker voice job with measured captions/chapters (`scripts/test/creator_e2e.mjs`)

## API-First Provider Layer (branch `feat/api-first-providers`)

### Single source of truth
- `workers/voxindica_worker_core.py` — one FastAPI worker used by Kaggle, Colab and local.
  - `GET /health` (no auth): real platform, GPU name, VRAM, model-loaded flag, sample rate.
  - `POST /clone_voice` / `POST /synthesize` (bearer): real VoxCPM2 `generate(text, reference_wav_path, cfg_value=2.0, inference_timesteps=8)`.
  - `POST /batch` (bearer): asynchronous 202 job with signed callbacks; `GET /batch/{id}` and `POST /batch/{id}/cancel`.
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

### Batch inference and webhooks
- `src/server/batch/` owns the durable store (`data/batches/<jobId>/job.json`, item WAVs), signed callback verification, the dedicated callback listener, dispatch/cancel service, and Studio routes.
- `POST /api/providers/batch` validates 1–32 items and dispatches to the worker's `/batch`; the job is persisted before the request so immediate callbacks can find it.
- Worker callbacks use `X-VoxIndica-Timestamp` + `X-VoxIndica-Signature: sha256=HMAC(secret, timestamp + "." + rawBody)`, a ±5-minute window, and a random token in the URL. Secrets and tokens never appear in API responses.
- The callback listener binds `127.0.0.1:3099` (`VOXINDICA_CALLBACK_PORT`) and exposes only `/healthz` and the webhook. Local workers call it directly; Kaggle/Colab require a user-provided tunnel and `VOXINDICA_PUBLIC_URL`. No tunnel is opened automatically.
- Restart recovery marks queued/running jobs `interrupted` and keeps completed audio; a later valid callback may still finish the job.
- `src/components/BatchStudio.tsx` + `src/services/batchService.ts` expose a `Batch` tab: provider/language/worker form, one line per item, persisted job list/detail, terminal-only progress, cancel, per-item WAV playback/download, and polling that stops on terminal states.
- Cloning a voice in the batch console requires a 3–30s reference clip prepared as 16-bit mono WAV and an explicit presenter-consent checkbox; the server rejects `isCloned` without `consentConfirmed` even if the UI is bypassed.

### Honest limitations (documented, not hidden)
- Consumer Google Colab has no runtime API and no official CLI — browser Run-all only (or Colab Enterprise on Vertex AI).
- Kaggle publishes kernel output only after a kernel finishes, and a worker kernel never finishes; the Launch flow therefore may stop at "running" and ask for the URL from the live log.
- Hugging Face serverless will not reliably serve VoxCPM2-class cloning; use an Inference Endpoint or the worker.
- Kaggle GPU sessions stop after ~12 hours; Colab frees idle runtimes. The Studio reports `Disconnected`, never a fabricated countdown.

### Verification status
- Verified: `npx tsc --noEmit` (clean), `npm run build` (vite, 601 kB bundle), `curl` smoke test of `/docs`, `/notebooks/*.ipynb`, `/api/providers/kaggle/test`, and FastAPI TestClient runs of `/clone_voice` (200 with audio, 401 without token, 500 on model exception, 503 when the model is absent).
- Verified: `scripts/test/batch_webhook.mjs` starts the real Studio with a fake worker and checks consent rejection, signed item/batch callbacks, persisted completion, WAV download, duplicate idempotency, and unsigned rejection. `scripts/test/worker_smoke.py` now also checks `/batch` 202, HMAC signatures, item audio, duplicate id and missing-model `503`.
- Not verified here: live Kaggle API calls (no account credentials in this environment), real VoxCPM2 inference (no GPU, no `voxcpm` package installed; local Python is 3.14, torch wheels target 3.10–3.12), and a remote Kaggle/Colab callback through a real public tunnel.

## Creator Studio (Phase 1, branch `feat/creator-studio`)

### Domain and storage
- `src/types/creator.ts`: `CreatorProject`, `ScriptDocument`, `CreatorScene`, `CreatorAsset`, `ConsentRecord`, `RenderJob`, language/tone/mode/status unions.
- `src/server/creator/schema.ts`: zod contracts for project CRUD, script content, consent and asset uploads. LLM output must pass `scriptContentSchema` before it is persisted.
- `src/server/creator/storage.ts`: projects live at `data/projects/<uuid>/project.json` with `assets/` beside them. Writes are atomic (temp file + rename), ids are UUID-validated, asset paths are resolved under the store, assets are capped at 30 MB and limited to PNG/JPEG/WebP/WAV/MP3/M4A/OGG/WebM/MP4.
- `data/` is gitignored. User media never enters git.

### Script engine
- `src/server/creator/providers.ts`: Gemini → Groq → OpenRouter with env model ids (`GEMINI_SCRIPT_MODEL`, `GROQ_SCRIPT_MODEL`, `OPENROUTER_SCRIPT_MODEL`).
- Fallback happens only on 429, 5xx, timeout, network error or schema-invalid JSON. Auth and model-selection errors stop immediately with the provider's real message.
- There is no fabricated script fallback: when every configured provider fails, the API returns the aggregated error.
- `POST /api/creator/scripts/generate` returns the validated document plus an attempt trail and, when `projectId` is supplied, stores it and moves the project to `script_ready`.

### Routes
- `GET/POST /api/creator/projects`
- `GET/PATCH/DELETE /api/creator/projects/:id`
- `POST /api/creator/scripts/generate`
- `POST /api/creator/projects/:id/assets`
- `GET /api/creator/projects/:id/assets/:assetId`
- `POST /api/creator/projects/:id/consent`
- `GET /api/creator/projects/:id/voice`, `POST …/voice`, `POST …/voice/cancel`
- `GET /api/creator/projects/:id/render`, `POST …/render`, `POST …/render/cancel`
- `GET /api/creator/projects/:id/captions` (SRT), `GET /api/creator/projects/:id/publishing` (markdown)
- `GET /api/creator/projects/:id/export` (ZIP: `project.json`, `script.md`, assets, consent)
- `GET /api/creator/health` (provider configuration booleans and model ids only; no keys)
- Mounted by `registerCreatorRoutes(app)` at the top of `startServer()` in `server.ts`, before Vite middleware.

### Voice stage
- `src/server/creator/voice.ts`: sequential per-scene job against the existing worker `/clone_voice`; each WAV is written and checkpointed in `project.voice.scenes[sceneId]` before the next scene starts.
- Accepts only a 3–30s RIFF/WAVE reference (requested asset → last used → first `reference_audio`). Scene must have `voiceText`; a job cannot start without a reference clip.
- Real progress from stored takes; project becomes `voice_ready` only when every scripted scene has audio. Cancel and failure keep finished takes and never fabricate audio.
- `recoverInterruptedVoiceJobs()` converts `queued`/`running` to `interrupted` on boot; resuming synthesizes only missing scenes.
- Atomic writes use a UUID temp suffix because concurrent job/cancel writes in the same millisecond previously collided.
- `VoicePanel.tsx`: provider picker from the Studio's stored worker configs, reference upload/select, optional transcript, progress bar, cancel, per-scene players and regenerate.

### Render stage
- `src/server/creator/render.ts`: asynchronous FFmpeg renderer for uploaded scene visuals plus the synthesized scene narration. Output presets are landscape 1280×720 (default), portrait 720×1280 and square 960×960 at 30 fps, H.264 + AAC, `+faststart`.
- Requires a saved script, narration for every scene and a `scene_visual` asset for every scene. Missing items fail with real counts; a running job returns 409; an already-finished render returns 409 only when the requested preset and caption flag match the finished render.
- Per-scene clips are written to `data/projects/<uuid>/render/scene-NN.mp4` and checkpointed in `render.scenes[sceneId]`. A clip is reused on resume only when its stored narration and visual asset ids match, the file exists, and the clip was encoded at the same width and height.
- `render.progress` and `completedScenes` reflect real stored clips. Only a completed, probed assembly sets project status `ready` and attaches a `final_video` asset.
- Cancel aborts the ffmpeg child, waits on the job's `done` promise, then records `cancelled`; this closed a real race where an immediate resume saw a stale running job and got 409. Finished clips are kept.
- Failure/cancel never produces a placeholder video; errors carry the last ffmpeg stderr lines. `ffmpeg`/`ffprobe` must be on `PATH`.
- `recoverInterruptedRenderJobs()` marks `queued`/`running` as `interrupted` and running scenes as `pending` on boot; resume re-encodes only missing scenes.
- `scene_audio` and `final_video` are server-owned asset kinds and are rejected by the public asset upload route. Replacing a visual on a `ready` project resets it to `assets_ready`.
- `RenderPanel.tsx`: readiness counters, per-scene visual upload/replace with thumbnails, real progress, cancel, final video player and download. Copy states explicitly that it does not generate footage or an avatar.
- Music: a `music_bed` asset is uploaded through the normal asset route. Render options `{ musicAssetId, musicVolume (0–1, default 0.2), normalizeAudio (default true) }` are snapshotted on `render.audio`. The track loops with `-stream_loop -1`, is resampled to 48 kHz stereo, attenuated, then ducked under narration with `sidechaincompress` (threshold 0.03, ratio 12, attack 20 ms, release 350 ms). The mix uses `amix=normalize=0` so narration is not halved; optional `loudnorm=I=-14:TP=-1.5:LRA=11`.
- Final assembly re-encodes only when captions, music or normalization are active; otherwise it stream-copies. The completion message lists what really ran (`with background music, normalized audio`). The completed-render `409` compares preset, captions and all three audio fields.

### Captions and publishing
- `src/server/creator/publish.ts`: `collectCues` derives one cue per scene from stored narration; SRT, ASS and the markdown publishing pack all share those timings.
- Captions require a saved script and a WAV for every scene; otherwise `400` with the real missing count. Cue text is the scene subtitle (fallback voiceText); timestamps accumulate real `durationSeconds`.
- ASS export (`?format=ass`) uses the last completed render's dimensions and a language-appropriate Noto/DejaVu font, bottom-center outline and the same cues as the SRT. It defaults to 1280×720 before the first render.
- Publishing pack includes title, description, tags, hashtags, chapters, thumbnail prompt, disclosure and sources. Chapters use real cumulative audio timings; incomplete narration prints an explicit pending note instead of estimated timestamps.
- Thumbnails use the asset route with `kind: "thumbnail"`; the UI shows the current image and lets the creator copy or edit the prompt.
- `src/server/creator/thumbnail.ts` can propose a thumbnail with Gemini (`GEMINI_IMAGE_MODEL`, default `gemini-2.5-flash-image`). The image is returned in memory only; it becomes an asset only after the creator clicks `Use image`, which uploads it with `generatedBy`. Discard writes nothing. Without `GEMINI_API_KEY` the route returns an honest 503 and the upload path still works.
- `PublishingPanel.tsx`: caption readiness and SRT/ASS downloads, thumbnail upload/preview, prompt copy, chapters note and publishing-pack download.
- ZIP export now adds `<topic>.srt`, `<topic>.ass` and `<topic>-publishing.md` when the project has the data to derive them.
- Render POST accepts `{ "burnCaptions": true }`; the final assembly writes `render/captions.ass` and re-encodes the concat with the `ass` filter. Stream-copy assembly is used when disabled.

### UI
- `src/components/creator/CreatorStudio.tsx`: project list, new-project wizard, editor, save/export/delete, provider status, consent card, production-stage rail, 2s polling while a voice or render job is queued/running.
- `src/components/creator/ScriptEditor.tsx`: narration, scene cards, chapters, tags/hashtags, thumbnail prompt, disclosure, sources.
- `src/components/creator/VoicePanel.tsx`: per-scene narration synthesis UI.
- `src/components/creator/RenderPanel.tsx`: per-scene visual upload, render progress, cancel and final video player; output-format preset selector; music-bed upload/select/preview, volume slider and normalization checkbox.
- `src/components/creator/PublishingPanel.tsx`: captions download, thumbnail upload/preview, prompt copy, publishing pack download.
- `TopNav` and `App` gained a `creator` tab. Script, voice, render, captions and publishing run for real; the presenter stage is explicitly labelled as pending the avatar spike, and the UI never claims a video exists before one is encoded.

### Verification (2026-11-04)
- `npm run lint` clean; `npm run build` passes (528.02 kB bundle).
- `curl`: create → list → manual PATCH (`script_ready`) → PNG asset upload (`assets_ready`) → ZIP export containing `project.json`, `script.md`, `assets/dot.png` → delete.
- Voice against a contract stand-in worker (`/tmp/opencode/fake_voxcpm_worker.py`, test-only): 2-scene job → `voice_ready`, 24kHz mono WAVs, ZIP contains `assets/scene-<id>.wav`; wrong token fails with the token message and keeps prior takes; no pending scenes returns 409; cancel keeps both takes.
- Restart recovery: killed the server mid-job, restarted → `interrupted` with restart message, scene 1 kept, resume completed only scene 2.
- Playwright: provider config from localStorage → open project → upload 5s WAV reference → synthesize → two `<audio>` players streaming scene assets. Screenshot reviewed.
- Render E2E with the fake worker: 2 scenes, 5s reference, blue/green PNG visuals → 202 → `Video ready: 2 scenes, 4.5s at 1280×720.`; final asset 120025 bytes, ffprobe `h264`/`aac` 1280×720 4.4613s; ZIP contains scene WAVs, visuals and `final-video.mp4`.
- Render cancel: 6 scenes, cancel 0.4s after start → `cancelled`, 1 clip kept, `running:false`; immediate resume → `Resuming: 1 of 6 scene clips already exist.` → complete 12.62s.
- Render recovery: 8 scenes, killed the server after 2 clips, restart → `interrupted`, 2 clips kept, rest `pending`, no final asset; resume → complete 17.78s.
- Render UI (Playwright): `Scene render` → `Render video` → `Video ready`; `<video>` streams the final asset; screenshot reviewed with readiness counters, blue/green thumbnails, 100% progress bar and download link.
- Render presets: portrait render completed at 720×1280 (ffprobe 1.97s) and square at 960×960, both with burned-in captions; `?format=ass` after the square render reported `PlayResX: 960` / `PlayResY: 960`; same-format re-render returned 409 and switching back to landscape re-rendered at 1280×720. A portrait frame was extracted and reviewed — the 16:9 source was letterboxed, not stretched, and the caption sat at the bottom.
- Preset UI (Playwright): the `Output format` select lists all three presets, selecting portrait shows `720×1280`, and `Render video` stays enabled for a new format; square shows `960×960`. Screenshot reviewed.
- Captions E2E with the fake worker: request before narration → `400` / `2 missing`; after synthesis the SRT cues start at `00:00:00,000`, `00:00:01,110`, `00:00:02,220` and fall back to `voiceText` when a subtitle is empty.
- Publishing pack: chapters `00:00 — Opening`, `00:01 — Scene 2` from real audio timings; includes source, disclosure and `SRT available: 2 cues`; ZIP contains the SRT, publishing markdown and `assets/thumbnail.png`.
- Publishing UI (Playwright): `Publishing package` panel, SRT and pack links, prompt text, caption/chapter notes; uploaded PNG shows `Thumbnail saved`. Screenshot reviewed.
- ASS burn-in E2E: 2-scene project → `?format=ass` returns correct cues and fonts, unsupported format returns 400; render with `burnCaptions: true` completes with `with burned-in captions`, ffprobe h264 1280×720, extracted frame shows the caption at bottom center; ZIP includes the `.ass`.
- ASS UI (Playwright): `Download ASS` link, `Burn in captions` checkbox, render completes with burned-in captions and a `<video>` element. Screenshot reviewed.
- Script generation with no keys returns HTTP 500 with the honest “No script provider is configured…” message.
- Stage 5 suite (`node scripts/test/creator_e2e.mjs`): starts the real Studio with temp creator/batch dirs and an empty temp `.env`; verifies provider health is unconfigured, project validation and CRUD, consent, a real 3s RIFF/WAVE upload/download, manual script persistence (`script_ready`), honest 500 on no-key generation without replacing the script, caption/publishing pre-narration honesty, ZIP signature, and deleted-project 404.
- Stage 5 voice contract: contract stand-in worker receives two `/clone_voice` calls with the exact uploaded reference bytes and a bearer token; stored 2s PCM WAVs produce SRT cues `00:00:00,000 → 00:00:02,000` and `00:00:02,000 → 00:00:04,000`, ASS `PlayRes` 1280×720 with Noto Sans Bengali, and chapters `00:00 — সূচনা` / `00:02 — মাটির শিল্প` with `SRT available: 2 cues covering 4.00 seconds`.
- Status fix: uploading a reference asset to a scriptless draft leaves it `draft` instead of claiming `assets_ready`; `script_ready`/`voice_ready` projects still advance to `assets_ready`.
- Not verified here: live script generation (no `.env` keys), live T4 voice synthesis, and the T4 avatar spike.

- Thumbnail generation: `/api/creator/health` reports `image.configured` and the model id. Without `GEMINI_API_KEY`, `POST /projects/:id/thumbnail/generate` returns `503` with the honest key message; the upload path still works. Live Gemini generation is not verified here because no image key is configured.
- Music bed E2E (fake worker, FFT levels): baseline narration-only render measured 330 Hz at 15.83 (leakage) and rms −20.94; a 20s 330 Hz track at `musicVolume: 1` measured 68.33 (+52.5 dB over leakage), narration 220 Hz within 0.5 dB, ffprobe 9.849s h264 1280×720 with exactly one AAC stream. Identical settings returned 409.
- Volume scaling: `musicVolume: 0.25` with burned-in captions measured 56.45 (−11.9 dB versus volume 1, matching −12 dB) and the completion message mentioned both `background music` and `burned-in captions`.
- Normalization: `normalizeAudio: true` without music raised rms from −20.94 to −16.09 (+4.85 dB) and the message said `with normalized audio`; music leakage stayed at the noise floor.
- Ducking depth: the same music encoded without sidechain measured 80.18 at 330 Hz versus 68.33 in the mix → ≈11.9 dB of ducking under continuous narration. Default `musicVolume` was raised from 0.12 to 0.2 so the bed remains audible after ducking.
- Music validation: a `scene_audio` asset id returned 400 `The selected audio is not a music bed. Upload it as a music track first.`; an unknown UUID returned 400 `The selected music track is not part of this project.`
- Music UI (Playwright): uploaded `music20.wav`, selected it in the Music bed card, moved the slider to 35%, confirmed normalization defaults on and an `<audio>` preview renders; render completed with `background music` and `normalized audio`, final `<video>` present. Screenshot reviewed.

### Next
- Phase 4.2: generated notebooks are at `notebooks/kaggle/{sadtalker,musetalk}_spike/`; run them on a real Kaggle T4 (consented photo + 3–30s WAV), fill the result table in `docs/creator/avatar-spike.md`, then integrate only an engine that produced a real clip.
- Phase 4.4b: presenter/avatar stage behind the consent gate, using the winning T4 engine; the current renderer already accepts presenter clips as `scene_visual` MP4s.
- Phase 4.5 is complete. Generated thumbnails require `GEMINI_API_KEY`; no live image call was possible in this environment.
- Phase 4.9 is complete: music beds are user-supplied, and the renderer only loops/ducks/normalizes that file. Next buildable polish items are per-scene transitions beyond hard cuts and a caption style editor; the remaining blocked work is the T4 avatar spike and presenter stage.
