# VoxIndica Studio

Multilingual **text-to-speech** and **few-shot voice cloning** for Bengali (`bn-IN`), Hindi (`hi-IN`) and
Indian English (`en-IN`), with a provider layer that can run on Kaggle GPUs, Google Colab, Hugging Face or
your own machine.

Every claim in the UI is backed by a real request to the selected provider. There are no fabricated
latency numbers, no fake "connected" badges, no invented session countdowns, and no synthetic audio
pretending to be a model result.

---

## Features

- **Voice cloning** — upload or record 3–30 s of reference speech (16-bit PCM WAV, ≤ 25 MB) and synthesize
  new speech in that voice. An explicit consent gate must be accepted before cloning starts.
- **Long-form synthesis** — scripts are split on sentence boundaries by the worker (`VOXINDICA_CHUNK_CHARS`,
  default 800) and stitched into one WAV.
- **Provider layer** — API-first; CLI commands are optional and documented separately.
  | Provider | What it does |
  |---|---|
  | Local hardware | same worker on `127.0.0.1:8000`, no tunnel, direct `/health` probe |
  | Kaggle | push + start the worker kernel through `server.ts` → `https://www.kaggle.com/api/v1` |
  | Google Colab | interactive notebook; no public runtime API exists, and the UI says so |
  | Hugging Face | token validation via `whoami-v2`, TTS via the Inference API |
- **Honest status** — `Online` only after a successful response; timeouts, 401s and 503s surface the real
  message from the worker. Stale connections degrade to *unverified* after 10 minutes.
- **Worker bundles** — download or copy the Kaggle/Colab notebook or a single-file Python worker, generated
  from one core (`workers/voxindica_worker_core.py`).
- **History & benchmark views** — compare providers on real measured numbers.

---

## Quick start

```bash
npm install --legacy-peer-deps     # React 19 peer ranges need the flag
npm run dev                        # http://localhost:3000
```

Copy `.env.example` to `.env` and set `GEMINI_API_KEY` if you want the Gemini fallback path (used only when
no worker provider is selected).

Production:

```bash
npm run build
NODE_ENV=production npm run start  # serves dist/ + API on port 3000
```

---

## Connect a VoxCPM2 worker

The app needs a GPU worker to synthesize with VoxCPM2. Pick one:

### Local (own GPU)

```bash
bash scripts/local/install_local.sh          # needs Python 3.10–3.12
source .venv-worker/bin/activate
python scripts/local/run_worker.py --port 8000
python scripts/local/run_worker.py --check   # prints /health
```

Then: **Inference Providers & API → Local Hardware** → endpoint `http://127.0.0.1:8000`, paste the printed
token, **Test & Save**. Details: [`docs/local-install.md`](docs/local-install.md).

### Kaggle

Download `notebooks/kaggle/voxindica_worker.ipynb` (or use the in-app **Launch on Kaggle** flow), enable a
GPU T4 and Internet, then *Run all*. The last cell prints:

```
TUNNEL URL   : https://xxxx.trycloudflare.com
BEARER TOKEN : <32 hex chars>
```

Paste both into the Kaggle tab. The notebook, worker script and API examples are in
[`docs/api/providers.md`](docs/api/providers.md).

### Google Colab

`notebooks/colab/voxindica_worker.ipynb` — same cells as Kaggle, with the reference clip pulled from the
Kaggle dataset API (Colab Secrets) or an upload fallback. Consumer Colab has no public runtime API and no
official CLI, so this flow stays interactive by design.

### Hugging Face

Create a token at <https://huggingface.co/settings/tokens> and paste it in the Hugging Face tab. Serverless
inference hosts small TTS models; VoxCPM2-scale cloning needs an Inference Endpoint or a GPU worker.

---

## API surface

### Studio server (`server.ts`, port 3000)

| Route | Purpose |
|---|---|
| `POST /api/tts` | forwards to the selected worker `/clone_voice`; timeout `WORKER_TIMEOUT_MS` (default 120 s) |
| `POST /api/providers/kaggle/test` | Kaggle credential check over HTTP Basic |
| `POST /api/providers/kaggle/launch` | multipart `/kernels/push` of the worker notebook |
| `POST /api/providers/kaggle/poll` | `/kernels/status` + `/kernels/output` (zip parsed in-process) |
| `GET /docs/*` | serves this repository's `docs/` folder |

### Worker (`workers/voxindica_worker_core.py`)

| Route | Auth | Notes |
|---|---|---|
| `GET /health` | none | true GPU, VRAM, `model_loaded`, sample rate |
| `POST /clone_voice` | `Authorization: Bearer <token>` | `{ text, reference_audio, language, cfg_value, inference_timesteps }` |
| `POST /synthesize` | same | alias |

Response: `audio_base64`, `sample_rate`, `duration_seconds`, `chunks`, `generation_seconds`, `gpu`.
Failures are honest: **401** bad token, **422** bad reference audio, **503** model not loaded,
**500** inference error — each with the underlying message.

---

## Project layout

```
server.ts                     Express + Vite dev middleware, worker routing, Kaggle proxy
src/components/               Studio UI (ProviderModal, VoiceCloneModal, HistoryDrawer, …)
src/services/providerService.ts   provider state, real probes, Kaggle launch/poll
src/data/workerScripts.ts     generated worker bundles (do not edit by hand)
workers/voxindica_worker_core.py  single source of truth for the worker
workers/build_notebooks.py    regenerates notebooks, bundles and workerScripts.ts
notebooks/{kaggle,colab}/     ready-to-run worker notebooks
public/notebooks|workers/     downloadable copies served by the app
docs/                         provider APIs, CLI paths, local install, CI/CD
scripts/{local,api,test}/     local runner, API helpers, smoke test
```

---

## Development

```bash
npm run lint                 # tsc --noEmit (strict)
npm run build                # vite build
python3 scripts/test/worker_smoke.py   # 17 checks, no GPU required
python3 workers/build_notebooks.py     # regenerate notebooks after editing the core
```

CI (`.github/workflows/ci.yml`) runs lint, build, the worker smoke test and a generator drift check
(`git diff --exit-code`) on every push and pull request. Tagging `v*` triggers
`.github/workflows/release.yml`, which publishes the web build, notebooks and worker as release assets.
See [`docs/ci-cd.md`](docs/ci-cd.md).

---

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | — | optional Gemini path when no worker provider is active |
| `APP_URL` | — | public URL for self-referential links |
| `WORKER_TIMEOUT_MS` | `120000` | how long `/api/tts` waits for GPU inference |
| `VOXINDICA_WORKER_TOKEN` | random per session | pin the local worker token |

Kaggle credentials never touch the server's environment or disk — the browser keeps them and sends them per
request to the proxy. Worker tokens are generated with `secrets.token_hex(16)` and rotate on restart.

---

## Known limitations

- Consumer **Colab has no public runtime API/CLI**; only the interactive notebook flow is supported.
- A Kaggle worker kernel never *completes*, so Kaggle may not expose its output zip (and therefore the
  tunnel URL) through the API while it is alive. The UI then offers the kernel link and asks you to paste the
  URL from the live log. Push, queue state and GPU allocation are still automated.
- Kaggle GPU sessions and Colab runtimes are time-limited (~12 h and idle-based). The Studio reports the
  worker as offline afterwards instead of inventing a countdown.
- Reference audio must be RIFF/WAVE (3–30 s recommended, ≤ 25 MB); Safari records MP4/AAC, which the UI
  rejects with an explicit message.
- `speed` / `pitch` are accepted by the worker API for compatibility but not applied; the response reports
  `applied_post_processing: []`.

---

## Documentation

- [`docs/api/providers.md`](docs/api/providers.md) — HTTP contracts, curl/Python SDK examples, Kaggle API
  flow, Colab reality check
- [`docs/providers-cli.md`](docs/providers-cli.md) — optional Kaggle/HF CLI equivalents
- [`docs/local-install.md`](docs/local-install.md) — local worker install and troubleshooting
- [`docs/ci-cd.md`](docs/ci-cd.md) — workflows, release assets, drift check
- [`PROJECT_MEMORY.md`](PROJECT_MEMORY.md) — architecture decisions and evolution
- [`ROADMAP.md`](ROADMAP.md) — phases and current status
