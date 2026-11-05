# Creator Studio API

Phase 1 of VoxIndica AI Creator Studio. The voice endpoints (`/api/tts`, worker
cloning) are unchanged; these routes live under `/api/creator` and are mounted
before the Vite middleware in `server.ts`.

Projects are stored on this machine:

```
data/projects/<uuid>/project.json
data/projects/<uuid>/assets/<assetId>.<ext>
```

`data/` is gitignored. A project document is the source of truth; the browser
never renders a script that was not validated and persisted.

## Health

```bash
curl -s http://localhost:3000/api/creator/health
```

```json
{
  "ok": true,
  "storageRoot": "/media/sandip/Pro/VoxIndica/data/projects",
  "providers": {
    "gemini": { "configured": true, "model": "gemini-2.5-flash" },
    "groq": { "configured": false, "model": "llama-3.3-70b-versatile" },
    "openrouter": { "configured": false, "model": "google/gemini-2.5-flash" }
  }
}
```

Only booleans and model ids are returned — never keys.

## Projects

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/creator/projects` | List project summaries, newest first |
| `POST` | `/api/creator/projects` | Create a project |
| `GET` | `/api/creator/projects/:id` | Read one project |
| `PATCH` | `/api/creator/projects/:id` | Update metadata or the script |
| `DELETE` | `/api/creator/projects/:id` | Delete the project and its assets |
| `GET` | `/api/creator/projects/:id/export` | Download a ZIP (`project.json`, `script.md`, assets, consent) |

Create body:

```json
{
  "topic": "How Kolkata's tram network survived for 150 years",
  "language": "bn-IN",
  "tone": "news",
  "audience": "general online viewers",
  "targetDurationSeconds": 60,
  "videoMode": "presenter",
  "extraInstructions": ""
}
```

`language` is `bn-IN`, `hi-IN` or `en-IN`. `videoMode` is `presenter`,
`cinematic` or `hybrid`. `targetDurationSeconds` is 10–900.

## Script generation

```bash
curl -s -X POST http://localhost:3000/api/creator/scripts/generate \
  -H 'Content-Type: application/json' \
  -d '{
    "projectId": "<uuid>",
    "topic": "How Kolkata's tram network survived for 150 years",
    "language": "bn-IN",
    "tone": "news",
    "targetDurationSeconds": 60,
    "videoMode": "presenter"
  }'
```

The server asks **Gemini → Groq → OpenRouter** in order. Fallback happens only
for rate limits (`429`), upstream outages (`5xx`), timeouts, network errors, or
JSON that fails schema validation. Authentication and model-selection errors
stop immediately and are returned verbatim, because retrying another provider
would hide a configuration mistake.

Model ids are configurable:

```
GEMINI_SCRIPT_MODEL=gemini-2.5-flash
GROQ_SCRIPT_MODEL=llama-3.3-70b-versatile
OPENROUTER_SCRIPT_MODEL=google/gemini-2.5-flash
```

Keys live in `.env` (never in the browser):

```
GEMINI_API_KEY=...
GROQ_API_KEY=...
OPENROUTER_API_KEY=...
```

Success returns the validated document plus an attempt trail:

```json
{
  "ok": true,
  "script": {
    "title": "…",
    "hook": "…",
    "script": "…",
    "scenes": [
      {
        "id": "scene-1",
        "voiceText": "…",
        "visualPrompt": "…",
        "videoType": "b-roll",
        "camera": "slow push-in",
        "subtitle": "…",
        "transition": "dissolve",
        "durationSeconds": 7
      }
    ],
    "description": "…",
    "tags": ["…"],
    "hashtags": ["#…"],
    "chapters": [{ "title": "…", "timestamp": "00:00" }],
    "thumbnailPrompt": "…",
    "sources": [],
    "disclosure": "…",
    "meta": {
      "provider": "gemini",
      "model": "gemini-2.5-flash",
      "generatedAt": "2026-11-04T…Z",
      "latencyMs": 2810
    }
  },
  "attempts": [],
  "project": {}
}
```

If every configured provider fails, the response is `500` with the real
aggregated error. There is no fabricated script fallback.

## Assets and consent

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/creator/projects/:id/assets` | Upload a base64 asset |
| `GET` | `/api/creator/projects/:id/assets/:assetId` | Serve the asset |
| `POST` | `/api/creator/projects/:id/consent` | Record presenter consent |

Asset body:

```json
{
  "kind": "presenter_photo",
  "fileName": "presenter.jpg",
  "mimeType": "image/jpeg",
  "dataBase64": "<base64, optionally a data: URL>"
}
```

Allowed types: PNG, JPEG, WebP, WAV, MP3, M4A, OGG, WebM, MP4. Maximum 30 MB.
Presenter assets require a consent record before any likeness stage uses them.

Consent body:

```json
{
  "presenterName": "Presenter name",
  "confirmed": true,
  "notes": ""
}
```

`confirmed` must be `true`; consent is stored with a timestamp in the project.

## Voice stage (Phase 4.3)

Scene narration is synthesized by the existing VoxCPM2 worker. The creator API
never talks to a third-party TTS service; it forwards to the worker URL and
bearer token the browser already stores in the Studio's provider panel.

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/creator/projects/:id/voice` | Read voice state and live job info |
| `POST` | `/api/creator/projects/:id/voice` | Start or resume a synthesis job (202) |
| `POST` | `/api/creator/projects/:id/voice/cancel` | Abort the running job |

Start body:

```json
{
  "provider": "local",
  "workerUrl": "http://127.0.0.1:8000",
  "workerToken": "optional bearer token",
  "referenceAssetId": "<uuid of a reference_audio asset>",
  "promptText": "exact words spoken in the reference clip",
  "voiceName": "Presenter name",
  "regenerateSceneIds": ["scene-2"]
}
```

- `provider` is `local`, `kaggle` or `colab`; it is recorded for provenance.
- The reference clip must be a RIFF/WAVE asset between 3 and 30 seconds. It is
  resolved from `referenceAssetId`, then the project's last used reference, then
  the first `reference_audio` asset.
- `regenerateSceneIds` is optional. Without it, the job synthesizes every scene
  that has no audio yet; scenes that already have a take are skipped. With it,
  only those scene ids are re-synthesized.
- Every scene must have non-empty `voiceText` before a job can start.

The job runs asynchronously and checkpoints one scene at a time:

```text
data/projects/<uuid>/assets/<assetId>.wav   # one WAV per scene
project.voice.scenes[sceneId] = { assetId, durationSeconds, sampleRate, model, createdAt }
```

Progress is real: `completedScenes` counts WAV files that actually exist in the
project. The project only becomes `voice_ready` when every scripted scene has a
take. A failed or cancelled job keeps the takes it already wrote and records the
failure in `project.voice.status` — it never invents audio.

Voice states: `idle`, `queued`, `running`, `complete`, `failed`, `cancelled`,
`interrupted`. On server restart, any `queued` or `running` job is marked
`interrupted` with a message saying the server restarted; resuming synthesizes
only the missing scenes.

Worker contract used by the server:

```http
POST <workerUrl>/clone_voice
Authorization: Bearer <token>          # optional
Content-Type: application/json

{ "text": "…", "language": "bn-IN", "reference_audio": "<base64 WAV>",
  "prompt_text": "…", "cfg_value": 2.0, "inference_timesteps": 8 }
```

```json
{ "audio_base64": "…", "sample_rate": 24000, "duration_seconds": 2.4,
  "model": "voxcpm2", "gpu": "T4" }
```

The request is bounded by `WORKER_TIMEOUT_MS` (default 120000, minimum 30000).
HTTP 401, 422 and 503 are surfaced as actionable messages (bad token, rejected
reference, model not loaded); transport failures name the worker host but never
the token. A response without an audio payload is a failure and stores nothing.

Regenerating a scene replaces its previous WAV only after the new take has been
written and validated.


## Scene render (Phase 4.4)

The renderer assembles **visuals you uploaded** with the synthesized scene
narration into 1280×720 / 30 fps H.264 + AAC cuts. It does not generate footage,
avatars or presenter likeness.

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/creator/projects/:id/render` | Read render state and live job info |
| `POST` | `/api/creator/projects/:id/render` | Start or resume a render (`202`) |
| `POST` | `/api/creator/projects/:id/render/cancel` | Cancel the running render |

Before a render can start the project must have:

1. a saved script;
2. a narration WAV for **every** scene (`project.voice.scenes[sceneId]`);
3. a visual for **every** scene, uploaded with `kind: "scene_visual"` and the
   matching `sceneId` (PNG, JPEG, WebP, MP4 or WebM).

Missing items return `400` with the real count, for example
`Synthesize narration for every scene first (2 missing).` A second start while a
job is running returns `409`. A project that already has a finished render also
returns `409`; change a visual or narration to regenerate.

Visual upload:

```json
{
  "kind": "scene_visual",
  "sceneId": "scene-1",
  "fileName": "street.png",
  "mimeType": "image/png",
  "dataBase64": "<base64>"
}
```

Visuals are capped at the same 30 MB asset limit. Uploading a replacement
removes the previous visual for that scene only after the new file is stored.
`scene_audio` and `final_video` are server-owned kinds and cannot be uploaded
through the assets route.

### Output and checkpoints

```text
data/projects/<uuid>/render/scene-01.mp4   # one clip per scene
data/projects/<uuid>/render/final.mp4      # assembled output, moved into assets/
data/projects/<uuid>/assets/<uuid>.mp4     # final_video asset
```

Each scene is encoded before the next one starts, and its state is persisted.
`render.progress` and `render.completedScenes` come from those real checkpoints.
A scene clip is reused on resume only when its stored narration and visual asset
ids still match the current project and the clip file exists; otherwise it is
encoded again. The final file is `1280×720`, `h264`, `aac`, `+faststart`, and its
duration is probed with `ffprobe` before it is attached.

Render states: `idle`, `queued`, `running`, `complete`, `failed`, `cancelled`,
`interrupted`. On server restart, a `queued` or `running` render becomes
`interrupted`, running scenes become `pending`, and finished clips are kept.
Starting again resumes only the missing scenes.

Cancelling aborts the active `ffmpeg` process, waits for it to exit, then records
`cancelled`; the request never races an immediate resume. Finished clips are
kept. A failed or cancelled job never produces a placeholder video and never
changes project status to `ready` — only a completed, probed assembly does that
and sets `project.status = "ready"`.

`ffmpeg` and `ffprobe` must be installed on the machine running the server and
available on `PATH`. Encoding happens locally; nothing is uploaded to a third
party. If `ffmpeg` cannot be spawned, the job fails with an explicit
"install ffmpeg" message.

In the ZIP export the render artifacts appear as
`assets/visual-<sceneId><ext>`, `assets/scene-<sceneId>.wav` and
`assets/final-video.mp4`.

## Captions and publishing (Phase 4.5)

| Method | Route | Returns |
| --- | --- | --- |
| `GET` | `/api/creator/projects/:id/captions` | `text/plain` SRT download |
| `GET` | `/api/creator/projects/:id/publishing` | `text/markdown` publishing pack |

Both routes read the project from disk; they are downloads, not JSON.

### Captions

Captions require a saved script **and** a narration WAV for every scene.
Otherwise the route returns `400` with the real count, for example
`Synthesize narration for every scene before exporting captions (2 missing).`

Each cue is derived from stored audio, never from word-count estimates:

```text
1
00:00:00,000 --> 00:00:02,240
First on-screen subtitle

2
00:00:02,240 --> 00:00:04,610
Scene two narration.
```

The cue text is the scene `subtitle` when present, otherwise the scene
`voiceText`. Start and end times accumulate the real `durationSeconds` of the
scene WAVs written by the voice stage. The file is named
`<topic-slug>.srt`.

### Publishing pack

The markdown pack contains the title, description, tags, hashtags, chapters,
thumbnail prompt, AI disclosure, sources, and the caption status.

Chapters are computed from the same real narration durations:

```markdown
## Chapters

- 00:00 — Opening
- 00:02 — Scene 2
```

When narration is incomplete the pack still exports, but the chapter section
says timestamps are generated after synthesis — no timestamp is estimated. The
pack never invents sources or a disclosure; missing sections are marked as
missing.

### Thumbnail

Thumbnails use the existing asset route with `kind: "thumbnail"` (PNG, JPEG or
WebP, 30 MB cap). The Creator Studio shows the current image and the script's
thumbnail prompt, with a copy button. **No image provider is connected**, so the
UI asks the creator to upload the image they approved instead of generating one.

### ZIP

`GET /api/creator/projects/:id/export` now also includes the SRT and the
publishing markdown when the project has the data to derive them. Incomplete
narration means no SRT is added; a missing script means no publishing pack is
added.

## ASS captions and burned-in video (Phase 4.6)

`GET /api/creator/projects/:id/captions` accepts a format query:

| Query | Content-Type | File |
| --- | --- | --- |
| *none* or `?format=srt` | `application/subrip` | `<topic-slug>.srt` |
| `?format=ass` | `text/x-ssa` | `<topic-slug>.ass` |

Any other value returns `400`: `Unsupported caption format "…". Use srt or ass.`

Both formats use the same cues and the same real narration durations. The ASS
file is styled for 1280×720 output, uses `Noto Sans Bengali`, `Noto Sans
Devanagari` or `DejaVu Sans` according to the project language, and renders at
the bottom center with a black outline. Cue text falls back to `voiceText` when
a scene subtitle is empty, and braces are replaced because they would start ASS
override blocks.

### Burning captions into the render

`POST /api/creator/projects/:id/render` accepts an optional body:

```json
{ "burnCaptions": true }
```

The choice is stored on the render job as `render.burnCaptions` and survives
restart recovery. Scene clips are still encoded and checkpointed exactly as
before. At final assembly the server writes `render/captions.ass` from the real
narration timings and re-encodes the concatenated video with:

```bash
ffmpeg -f concat -safe 0 -i render/concat.txt \
  -vf ass=captions.ass -c:v libx264 -preset veryfast -crf 20 \
  -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart render/final.mp4
```

ffmpeg runs with `cwd` set to the render directory so the filter never has to
escape an absolute path. Without `burnCaptions` the final assembly keeps the
faster stream-copy path. The completion message says `with burned-in captions`
when the filter ran.

Burned-in captions require complete narration, because every cue is derived from
a stored WAV. The ZIP export now includes both `<topic>.srt` and `<topic>.ass`
when that data exists, alongside the final video.

## Caption style editor (Phase 4.10)

The ASS download and burned-in captions share one saved caption style. It is
stored on the project and can be updated without starting a render:

```bash
curl -s -X PATCH http://localhost:3000/api/creator/projects/<uuid> \
  -H 'Content-Type: application/json' \
  -d '{
    "captionStyle": {
      "fontScale": 1.5,
      "textColor": "#FFCC00",
      "outlineColor": "#112233",
      "outlineWidth": 5,
      "position": "top",
      "background": true
    }
  }'
```

| Field | Values | Default |
| --- | --- | --- |
| `fontScale` | 0.5–2, multiplier on the language-aware base size | `1` |
| `textColor` | `#RRGGBB` | `#FFFFFF` |
| `outlineColor` | `#RRGGBB` | `#000000` |
| `outlineWidth` | 0–8 ASS outline width (box padding when `background` is on) | `3` |
| `position` | `bottom`, `middle` or `top` | `bottom` |
| `background` | use the outline colour as a solid box behind the text | `false` |

A PATCH may include only some fields; the server merges them with the saved
style. Invalid colours, an out-of-range scale or an unknown position return
`400`. The default style produces the same ASS line as before this editor
existed.

`POST /api/creator/projects/:id/render` also accepts a partial `captionStyle`.
When `burnCaptions` is true, the merged style is saved to the project and
snapshotted on the render job, so `render/captions.ass` cannot drift from the
style shown in the API. The completed-render `409` compares the style only when
burning captions is requested; a style change alone does not invalidate a
render that never used captions. CSS-like values are converted to ASS
`&H00BBGGRR` for the style line.

## Generated thumbnails (Phase 4.7)

Generation is opt-in and approval-gated. The server never writes a generated
image into the project until the creator explicitly approves it.

### Provider status

`GET /api/creator/health` now includes:

```json
"image": { "configured": true, "model": "gemini-2.5-flash-image" }
```

Only a boolean and the model id are returned. The key never leaves the server.
Set `GEMINI_IMAGE_MODEL` to override the default.

### Generate a candidate

```bash
curl -s -X POST http://localhost:3000/api/creator/projects/<id>/thumbnail/generate \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"A dramatic tram at dusk, 16:9"}'
```

The request uses the project's title, audience language, and the supplied prompt
(or the saved `script.thumbnailPrompt`) to ask Gemini for a 16:9 thumbnail. It
returns the image **in memory only**:

```json
{
  "ok": true,
  "thumbnail": {
    "base64": "…",
    "mimeType": "image/png",
    "provider": "gemini",
    "model": "gemini-2.5-flash-image",
    "prompt": "the resolved prompt"
  }
}
```

Nothing is uploaded to `data/projects/` at this point. Without
`GEMINI_API_KEY` the route returns `503` with an honest message telling the
creator to add the key or upload an approved image.

The response is validated: the payload must be a real PNG/JPEG/WebP and no
larger than 10 MB, otherwise generation fails and no candidate is returned.

### Approve a candidate

Approval uses the normal asset route with `generatedBy`:

```json
{
  "kind": "thumbnail",
  "fileName": "generated-thumbnail.png",
  "mimeType": "image/png",
  "dataBase64": "…",
  "generatedBy": "gemini/gemini-2.5-flash-image"
}
```

Only after this succeeds does the image become a project asset and appear in the
ZIP export. Discarding a candidate simply drops it from the browser; no file was
ever written.

## Render format presets (Phase 4.8)

The render stage supports three output formats:

| Preset | Dimensions | Use |
| --- | --- | --- |
| `landscape` (default) | 1280×720 | YouTube and desktop |
| `portrait` | 720×1280 | Shorts, Reels, TikTok |
| `square` | 960×960 | Feed posts |

Pass the preset when starting a render:

```bash
curl -s -X POST http://localhost:3000/api/creator/projects/<uuid>/render \
  -H 'Content-Type: application/json' \
  -d '{ "preset": "portrait", "burnCaptions": true }'
```

Scene visuals are scaled to fit inside the target frame and padded with black
bars; aspect ratio is never stretched. Every scene clip is encoded at the
selected dimensions and stored as `render/scene-NN.mp4`.

Changing the preset invalidates scene-clip reuse: clips encoded at another size
are never reused, so the job re-encodes every scene. The completed-render `409`
applies only when the requested preset and `burnCaptions` flag match the
finished render; changing either allows a re-render.

The downloaded ASS uses the last completed render's dimensions for `PlayResX`,
`PlayResY`, font size and margins. Before the first render it defaults to
1280×720.

The final `ffprobe` check compares against the job's stored width and height,
and the completion message reports the real measured size, for example
`Video ready: 2 scenes, 12.0s at 720×1280 with burned-in captions.`

## Music bed and audio polish (Phase 4.9)

Background music is a normal project asset. Upload a track you have the rights
to use with `kind: "music_bed"`; nothing is generated and no music library is
bundled.

```json
{
  "kind": "music_bed",
  "fileName": "bed.mp3",
  "mimeType": "audio/mpeg",
  "dataBase64": "…"
}
```

Accepted audio types: MP3, WAV, M4A, OGG, AAC, FLAC and WebM, up to 30 MB.

Pass audio settings when starting a render:

```bash
curl -s -X POST http://localhost:3000/api/creator/projects/<uuid>/render \
  -H 'Content-Type: application/json' \
  -d '{
    "preset": "landscape",
    "burnCaptions": true,
    "musicAssetId": "<music asset uuid>",
    "musicVolume": 0.2,
    "normalizeAudio": true
  }'
```

| Field | Range | Default |
| --- | --- | --- |
| `musicAssetId` | project `music_bed` asset id or `null` | previous job, else `null` |
| `musicVolume` | 0–1 | previous job, else `0.2` |
| `normalizeAudio` | boolean | previous job, else `true` |

The track is looped with `-stream_loop -1` to the length of the video,
resampled to 48 kHz stereo, attenuated by `musicVolume`, then ducked under the
narration with `sidechaincompress` (threshold `0.03`, ratio `12`, attack `20 ms`,
release `350 ms`). The mix uses `amix` with `normalize=0`, so the narration
level is not halved. When `normalizeAudio` is true the final mix passes through
`loudnorm=I=-14:TP=-1.5:LRA=11`. These change level and balance only; they never
alter the narration content.

Final assembly re-encodes only when captions, music or normalization are
active. Otherwise the concatenated scene clips are stream-copied. The
completion message reports what actually ran, for example
`Video ready: 2 scenes, 9.8s at 1280×720 with background music, normalized audio.`

The completed-render `409` compares the preset, `burnCaptions` and all three
audio settings. Changing the track, the volume or normalization allows a
re-render. Validation is honest:

- unknown asset id → `The selected music track is not part of this project.`
- asset of another kind → `The selected audio is not a music bed. Upload it as a music track first.`
- missing file on disk → `The music track file is missing from the project store. Upload it again.`

Music rights remain the creator's responsibility. The renderer only mixes the
file supplied to it.
