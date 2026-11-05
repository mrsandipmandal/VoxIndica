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
```

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
- **Render jobs are checkpointed.** One scene clip is encoded and persisted at a time; a clip is reused only when its narration and visual asset ids still match. Cancel kills the active ffmpeg child and keeps finished clips.
- **ffmpeg is a local dependency.** `ffmpeg` and `ffprobe` must be on `PATH`; spawn failures are reported, never hidden.
- **Format presets are dimension-aware.** Landscape is 1280×720, portrait 720×1280, square 960×960. Scene clips are reused only when width and height also match; changing the preset re-encodes. ASS `PlayRes`, font size and margins follow the last completed render.
- **Captions and chapters use stored audio.** SRT cues and chapter timestamps accumulate the real scene WAV durations; never estimate them from word counts or scene plans. Incomplete narration hides timestamps instead of guessing.
- **Generated thumbnails require explicit approval.** Gemini may propose an image from the saved prompt, but it is returned in memory only. It becomes a project asset only after the creator clicks `Use image`, and the asset records `generatedBy`. Discarding writes nothing. Without `GEMINI_API_KEY`, return the honest 503 and keep the upload path.
- **Publishing packs do not invent facts.** Sources, description, tags and disclosure come from the saved script; missing fields stay visibly missing.
- **ASS captions share the SRT timings.** Both formats come from `collectCues` and real WAV durations. Burn-in sets `render.burnCaptions` and re-encodes the concat with `ass=captions.ass`; it never fabricates cue text or invents timing.
- **Do not break voice endpoints.** `/api/tts` and the worker contract (`/clone_voice`, `/synthesize`, `/shutdown`) are separate from `/api/creator/*`.
- **Long-running video jobs** must be async, checkpointed per scene, and resumable. They must never block an Express request or the UI thread.

