# Coding Agent Instructions — VoxIndica Studio

## Repository Conventions
- **Language**: TypeScript (`strict: true`). Standard enums and strong typing.
- **Styling**: Tailwind CSS v4 via `@import "tailwindcss";`. Zero-pill discipline for metadata; unboxed text with typographic separators (`·` or `/`).
- **Audio Standards**: 16-bit PCM WAV (RIFF header), standard sample rate 24,000 Hz or 22,050 Hz.
- **Provider Policy**: Never fabricate session duration countdowns for Kaggle or Colab. Use true heartbeat state (`Online` / `Disconnected`).
- **Security & Ethics**: Mandatory explicit consent gate before voice cloning is triggered. Strict validation of audio duration (3s–30s) and file sizes (<25MB).

## Testing Commands
```bash
# Type check and lint
npm run lint

# Production build check
npm run build

# Batch + creator end-to-end tests (real Studio, temp dirs, no GPU)
npm test

# Python worker contract smoke test
npm run test:worker

# Desktop sidecar build
npm run desktop:sidecar
```

## Desktop Shell Rules
- **Tauri v2 shell, Node sidecar.** `src-tauri` owns the window; the sidecar is a Node SEA built from `server.ts` by `scripts/build-sidecar.mjs`. Do not replace it with the FastAPI worker; that service is GPU inference only and cannot serve the Studio UI.
- **Loopback only.** The desktop sidecar binds `127.0.0.1` on a random port. Never expose it on `0.0.0.0` or load the UI from a public URL.
- **Dev Vite stays lazy.** `server.ts` may import Vite only through a dynamic `await import('vite')` in development so the production SEA stays self-contained.
- **Honest startup failure.** If `/healthz` does not answer within the readiness window, show `public/desktop-error.html` with logs. Never show an empty or fake workspace.
- **User data lives outside the bundle.** Projects go to the platform app-data directory (`VOXINDICA_CREATOR_DATA_DIR`), provider keys to `<app-config>/.env` (`VOXINDICA_ENV_FILE`); bundled resources are read-only.
- **`ffmpeg` remains external.** Desktop builds do not bundle `ffmpeg`/`ffprobe`; report missing binaries instead of hiding them.
- **Do not claim installers you have not built.** Local compile may be blocked; verify with `npm run desktop:build` or the `Desktop` GitHub workflow before calling a platform supported.

## Batch Inference Rules
- **Async, never blocking.** `POST /api/providers/batch` persists the job, dispatches the worker's `/batch`, and returns `202`. Synthesis runs in a worker thread; Express requests and the UI must never wait for a whole batch.
- **Signed callbacks only.** Every callback carries `X-VoxIndica-Timestamp` and `X-VoxIndica-Signature: sha256=HMAC(secret, timestamp + "." + rawBody)`, plus a per-job URL token. Verify the token, the ±5-minute window and the signature before touching a job; duplicate deliveries are idempotent.
- **Secrets stay server-side.** Callback secrets, callback URL tokens and worker tokens are never returned by the API, printed in logs, or committed.
- **Dedicated callback listener.** Bind `127.0.0.1` (`VOXINDICA_CALLBACK_PORT`, default 3099) and expose only `/healthz` and the webhook. Never expose the Studio UI or creator routes through the callback tunnel.
- **No automatic public tunnel.** Local workers may call the loopback listener. Remote Kaggle/Colab batches require `VOXINDICA_PUBLIC_URL` pointing at a user-opened tunnel; otherwise return the honest `503` instead of claiming callbacks work.
- **Real audio only.** Store a callback WAV only after RIFF/WAVE validation and the 50 MB limit. Never mark an item completed without a worker response, and never synthesize a placeholder.
- **Restart honesty.** Queued/running batch jobs become `interrupted` on boot; completed items and audio are kept. A later valid callback may finish the job, but no completion is invented.
- **One model, one lock.** The worker serializes `/clone_voice` and batch synthesis through `_MODEL_LOCK`; do not call the model concurrently from multiple threads.
- **Preserve the single-shot contract.** `/clone_voice`, `/synthesize`, `/health` and `/shutdown` keep their existing behavior and error codes.

## Creator Studio Rules
- **No fabricated media or scripts.** If every script provider fails, return the real error; never render a placeholder script, fake progress, or a synthetic render result.
- **Validate before persisting.** LLM output must pass the zod schema in `src/server/creator/schema.ts` before it is written to `data/projects/`.
- **Provider fallback** is Gemini → Groq → OpenRouter, and only for rate limits, upstream outages, timeouts, network errors, or schema failures. Auth and model-selection errors stop immediately and are shown to the user.
- **Keys stay server-side** in `.env`. Never expose `GEMINI_API_KEY`, `GROQ_API_KEY`, or `OPENROUTER_API_KEY` to the browser.
- **Consent before likeness.** A presenter photo may only be used after `POST /api/creator/projects/:id/consent` records the presenter's confirmation.
- **Storage is gitignored.** Projects and assets live under `data/projects/`; never commit user media.
- **Voice stage is checkpointed.** `/api/creator/projects/:id/voice` synthesizes one scene at a time through the worker's `/clone_voice` contract and writes each WAV before starting the next. A failed or cancelled job keeps existing takes and records the failure; it never invents or duplicates audio.
- **Reference audio is 3–30s WAV only.** Validate duration before upload and re-validate server-side. The worker accepts nothing else.
- **Restart recovery is honest.** `queued`/`running` voice jobs become `interrupted` on boot and resume only the missing scenes.
- **The renderer assembles, it does not generate.** It only combines uploaded scene visuals with synthesized narration. It never fabricates footage, a presenter or a placeholder video, and `scene_audio`/`final_video` are server-owned asset kinds.
- **Transitions never move narration.** Bake `cut`/`fade`/`flash` into each scene clip; never use overlapping `xfade` assembly, because it would shorten the programme and invalidate SRT/chapter timestamps derived from real WAV durations. Snapshot incoming/outgoing transitions on scene checkpoints so clip reuse and the completed-render `409` stay honest.
- **Render jobs are checkpointed.** One scene clip is encoded and persisted at a time; a clip is reused only when its narration and visual asset ids and incoming/outgoing transitions still match. Cancel kills the active ffmpeg child and keeps finished clips.
- **ffmpeg is a local dependency.** `ffmpeg` and `ffprobe` must be on `PATH`; spawn failures are reported, never hidden.
- **Format presets are dimension-aware.** Landscape is 1280×720, portrait 720×1280, square 960×960. Scene clips are reused only when width and height also match; changing the preset re-encodes. ASS `PlayRes`, font size and margins follow the last completed render.
- **Captions and chapters use stored audio.** SRT cues and chapter timestamps accumulate the real scene WAV durations; never estimate them from word counts or scene plans. Incomplete narration hides timestamps instead of guessing.
- **Generated thumbnails require explicit approval.** Gemini may propose an image from the saved prompt, but it is returned in memory only. It becomes a project asset only after the creator clicks `Use image`, and the asset records `generatedBy`. Discarding writes nothing. Without `GEMINI_API_KEY`, return the honest 503 and keep the upload path.
- **Publishing packs do not invent facts.** Sources, description, tags and disclosure come from the saved script; missing fields stay visibly missing.
- **ASS captions share the SRT timings.** Both formats come from `collectCues` and real WAV durations. Burn-in sets `render.burnCaptions` and re-encodes the concat with `ass=captions.ass`; it never fabricates cue text or invents timing.
- **Music is user-supplied.** A `music_bed` is an uploaded track the creator has rights to use; never bundle or fabricate music. The renderer only loops, attenuates, sidechain-ducks and optionally applies `loudnorm` to that file. Audio settings are snapshotted on the render job and count toward the completed-render `409`.
- **Do not break voice endpoints.** `/api/tts` and the worker contract (`/clone_voice`, `/synthesize`, `/shutdown`) are separate from `/api/creator/*`.
- **Long-running video jobs** must be async, checkpointed per scene, and resumable. They must never block an Express request or the UI thread.

