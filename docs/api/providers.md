# Provider APIs

Everything in VoxIndica Studio that talks to Kaggle, Google Colab or Hugging Face does so over **HTTP**.
No CLI is required for any flow described here. The CLI equivalents live in
[`providers-cli.md`](./providers-cli.md) and are strictly optional.

```
Studio UI ──► server.ts proxy ──► provider HTTP API
                    │
                    └──► VoxIndica worker (FastAPI + bearer token, reachable through a tunnel)
```

## Summary

| Provider | Transport | Credential | Can the Studio automate it? |
|---|---|---|---|
| Local hardware | `http://127.0.0.1:8000` | optional worker token | ✅ yes, direct probe |
| Hugging Face | `https://api-inference.huggingface.co`, `https://huggingface.co/api` | `hf_...` user access token | ✅ yes, direct from browser/server |
| Kaggle | `https://www.kaggle.com/api/v1` | username + API key (HTTP Basic) | ✅ launch/status via `server.ts` proxy |
| Google Colab (consumer) | none | none | ⚠️ no public runtime API — interactive only |

---

## 1. VoxIndica worker contract

The worker is the same code on Kaggle, Colab and your own PC
(`workers/voxindica_worker_core.py`).

### `GET /health` — no auth

```bash
curl -s https://YOUR-TUNNEL.trycloudflare.com/health
```

```json
{
  "status": "online",
  "service": "voxindica-worker",
  "version": "1.0.6",
  "platform": "kaggle",
  "model": "openbmb/VoxCPM2",
  "model_loaded": true,
  "model_error": null,
  "sample_rate": 24000,
  "auth_required": true,
  "shutdown_supported": true,
  "gpu_device": "Tesla T4",
  "vram_used": 2210,
  "vram_total": 15360,
  "cuda_available": true,
  "timestamp": 1793000000.0
}
```

`status` is `online` only when the model is loaded. A loaded-on-CPU worker reports `online` but every
synthesis call will be far too slow for the Studio timeout — check `cuda_available`.

### `POST /clone_voice` (alias `POST /synthesize`) — bearer auth

```bash
curl -s -X POST https://YOUR-TUNNEL.trycloudflare.com/clone_voice \
  -H "Authorization: Bearer $WORKER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "নমস্কার, এটি একটি ভয়েস ক্লোন পরীক্ষা।",
    "language": "bn-IN",
    "reference_audio": "data:audio/wav;base64,UklGR..."
  }'
```

| Field | Type | Notes |
|---|---|---|
| `text` | string | required, 1..N chars |
| `reference_audio` | string | base64 or data-URL, RIFF/WAVE, 3–30 s recommended, ≤ 25 MB; the Studio trims to 30 s, the worker uses at most the first 60 s |
| `prompt_text` | string | optional transcript hint |
| `language` | string | `bn-IN`, `hi-IN`, `en-IN` |
| `cfg_value` | float | default `2.0` |
| `inference_timesteps` | int | default `8` |
| `speed`, `pitch` | float | accepted for compatibility; **not applied** by the worker (see `applied_post_processing: []`) |

Response:

```json
{
  "status": "success",
  "audio_base64": "UklGR...",
  "sample_rate": 24000,
  "duration_seconds": 12.4,
  "chunks": 2,
  "reference_source": "request",
  "generation_seconds": 38.2,
  "applied_post_processing": [],
  "model": "openbmb/VoxCPM2",
  "gpu": "Tesla T4",
  "vram_used": 2210,
  "vram_total": 15360
}
```

Errors are real, never masked:

| Code | Meaning |
|---|---|
| 401 | bearer token mismatch |
| 422 | bad/missing reference audio (too short, wrong container, oversized) |
| 503 | model failed to load — includes the underlying exception |
| 500 | inference failed — includes the underlying exception |

Long scripts are split on sentence boundaries (`VOXINDICA_CHUNK_CHARS`, default 800) and concatenated
with 120 ms of silence.

### `POST /shutdown` — bearer auth

Stops the worker *and* its cloudflared tunnel. The Studio's **Stop session** button calls this (after
cancelling the Kaggle run through the Kaggle API, when a session id is known).

```bash
curl -s -X POST https://YOUR-TUNNEL.trycloudflare.com/shutdown \
  -H "Authorization: Bearer $WORKER_TOKEN"
```

```json
{ "status": "shutting_down", "worker_version": "1.0.6", "message": "Worker is stopping; the tunnel closes in about a second." }
```

The response is sent first; the process terminates cloudflared and exits about a second later, so the
tunnel URL stops working immediately afterwards. Workers older than **1.0.5** answer `404` — relaunch
the notebook once to pick this up.

### Batch inference — bearer auth

Long batches are asynchronous: the worker accepts the job with `202`, returns immediately, and posts
**signed callbacks** as each item finishes. The Studio persists the job before dispatch, so an immediate
callback can find it.

```bash
curl -s -X POST https://YOUR-TUNNEL.trycloudflare.com/batch \
  -H "Authorization: Bearer $WORKER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "batch_id": "0b8f7f8c-4d7a-4f1e-9c6d-2a7b8c9d0e1f",
    "callback_url": "https://YOUR-CALLBACK-HOST/api/providers/batch/webhook/TOKEN",
    "callback_secret": "64-char-hex-secret",
    "items": [
      {"id": "intro-0001", "text": "নমস্কার।", "language": "bn-IN"},
      {"id": "intro-0002", "text": "এটি দ্বিতীয় বাক্য।", "language": "bn-IN"}
    ]
  }'
```

The worker returns `202 {"status":"accepted","batch_id":"…","total":2,"worker_version":"1.0.6"}`.
`GET /batch/{batch_id}` returns the item states without audio; `POST /batch/{batch_id}/cancel` asks the
worker to stop after the current item. Both require the bearer token.

Limits: 1–32 items, 10,000 characters per item, 100,000 characters total. The reference-audio rules are
the same as `/clone_voice`.

#### Callback events and signature

The worker posts each event as JSON with two headers:

```text
X-VoxIndica-Timestamp: 1793000000
X-VoxIndica-Signature: sha256=<hex>
```

The signature is `HMAC-SHA256(callback_secret, "<timestamp>.<raw body>")`. The Studio rejects a
timestamp outside ±300 seconds, a missing/malformed signature, or a token that does not belong to a job.
The callback URL itself contains a random per-job token, so it is never logged or returned by the API.

| Event | Meaning |
|---|---|
| `item.started` | that item is now running |
| `item.completed` | includes `audio_base64`, `sample_rate`, `duration_seconds`, `chunks`, `generation_seconds` |
| `item.failed` | includes the real worker error |
| `batch.completed` | every item reached a terminal state; some items may still have failed |
| `batch.failed` | the worker stopped before producing a usable batch |
| `batch.cancelled` | cancellation was honoured |

Duplicate deliveries are acknowledged with `{"ok":true,"duplicate":true}` and cannot overwrite a finished
item or its stored WAV.

#### Studio API

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/providers/batch` | create and dispatch a batch |
| `GET` | `/api/providers/batch` | list the latest 50 jobs |
| `GET` | `/api/providers/batch/:id` | job status and item summaries |
| `POST` | `/api/providers/batch/:id/cancel` | forward cancellation to the worker |
| `GET` | `/api/providers/batch/:id/items/:itemId/audio` | download a completed item WAV |

Creation body:

```json
{
  "provider": "local",
  "workerUrl": "http://127.0.0.1:8000",
  "workerToken": "optional",
  "language": "bn-IN",
  "isCloned": false,
  "referenceAudioBase64": "optional for cloned voices",
  "promptText": "optional",
  "items": [{"id": "intro-0001", "text": "নমস্কার।"}]
}
```

The Studio starts a **dedicated loopback callback listener** (default `127.0.0.1:3099`) that exposes
only `GET /healthz` and the signed webhook. A local worker can reach it directly. Kaggle/Colab cannot
reach `127.0.0.1`; for remote workers open a tunnel to the callback listener and set the public base
before starting the Studio:

```bash
cloudflared tunnel --url http://127.0.0.1:3099
export VOXINDICA_PUBLIC_URL="https://YOUR-TUNNEL.trycloudflare.com"
```

Without `VOXINDICA_PUBLIC_URL`, remote batch creation returns `503` with this instruction. The Studio
never opens a tunnel automatically. The listener is intentionally separate from the main Studio app so
a public tunnel does not expose the UI, creator projects, or provider routes.

Batch data is stored under `data/batches/` (`VOXINDICA_BATCH_DATA_DIR` overrides). On restart, queued or
running jobs become `interrupted`; completed items and their audio are kept. A late signed callback may
still finish the job.

---

## 2. Hugging Face

### Token

Create one at <https://huggingface.co/settings/tokens> (read + inference scopes). The Studio validates it
with `GET https://huggingface.co/api/whoami-v2`.

```bash
curl -s https://huggingface.co/api/whoami-v2 -H "Authorization: Bearer $HF_TOKEN"
```

### Inference

```bash
curl -s -X POST https://api-inference.huggingface.co/models/facebook/mms-tts-ben \
  -H "Authorization: Bearer $HF_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"inputs": "নমস্কার"}' --output out.wav
```

Python SDK:

```python
from huggingface_hub import InferenceClient

client = InferenceClient(model="facebook/mms-tts-ben", token="hf_...")
audio = client.text_to_speech("নমস্কার")
open("out.wav", "wb").write(audio)
```

**Honest limits.** Serverless inference hosts small, popular models. VoxCPM2 (~1B class, reference-audio
conditioning) is not reliably served there; cold starts and `503 model loading` are normal. For real voice
cloning use either a dedicated **Inference Endpoint** (billed per hour) or the Kaggle/Colab worker.

---

## 3. Kaggle API

Base URL: `https://www.kaggle.com/api/v1` · Auth: HTTP Basic `username:api-key` (`kaggle.json`).

Create the key at <https://www.kaggle.com/settings/api>.

### Which credential should you create?

Kaggle's settings page offers two generations. Both can push a kernel; only one can read live logs.

| Page button | Result | Works with |
|---|---|---|
| **Generate New Token** *(recommended)* | a `KGAT_…` access token | `Authorization: Bearer` against both `www.kaggle.com/api/v1` (push/status/output) **and** `api.kaggle.com/v1` (live session log stream) |
| **Create Legacy API Key** | downloads `kaggle.json` with `username` + `key` | `Authorization: Basic` against `www.kaggle.com/api/v1` only — no live logs, so the tunnel URL must be copied from the notebook |

Use **Generate New Token** and paste `username` + `KGAT_…` into the Studio. The Studio then reads
`GetKernelSessionLogsStream` while the kernel runs and fills in the tunnel URL and bearer token automatically.

```bash
# v2 host, KGAT token — same call the Studio's poll route makes
curl -sN -X POST \
  https://api.kaggle.com/v1/kernels.KernelsApiService/GetKernelSessionLogsStream \
  -H "Authorization: Bearer $KAGGLE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"userName":"me","kernelSlug":"voxindica-voxcpm2-worker","waitForLogsUrlSeconds":20}'
```

```bash
curl -s -u "$KAGGLE_USERNAME:$KAGGLE_KEY" \
  "https://www.kaggle.com/api/v1/kernels/list?user=$KAGGLE_USERNAME&pageSize=5"
```

Note: `/kernels/push` takes **JSON** (`KernelPushRequest`), not a multipart upload. Sending multipart returned
`400 Error reading JToken from JsonReader` before this was fixed.

### Push a notebook (start the worker)

`POST /kernels/push` is `multipart/form-data` with three text parts:

| Part | Value |
|---|---|
| `metadata` | JSON string: `id`, `title`, `code_file`, `language`, `kernel_type`, `is_private`, `enable_gpu`, `enable_internet`, `dataset_sources`, … |
| `fileName` | notebook file name, e.g. `voxindica_worker.ipynb` |
| `fileData` | raw notebook JSON |

```bash
curl -s -u "$KAGGLE_USERNAME:$KAGGLE_KEY" -X POST \
  https://www.kaggle.com/api/v1/kernels/push \
  -F 'metadata={"id":"me/voxindica-voxcpm2-worker","title":"VoxIndica Worker","code_file":"voxindica_worker.ipynb","language":"python","kernel_type":"notebook","is_private":"true","enable_gpu":"true","enable_internet":"true","dataset_sources":[],"competition_sources":[],"kernel_sources":[]}' \
  -F 'fileName=voxindica_worker.ipynb' \
  -F 'fileData=@notebooks/kaggle/voxindica_worker.ipynb'
```

Then poll `GET /kernels/status/{owner}/{slug}` → `KernelWorkerStatus.QUEUED | RUNNING | COMPLETE | ERROR`,
and fetch `GET /kernels/output/{owner}/{slug}` (zip) when it is available.

The Studio wires this through `server.ts` (`POST /api/providers/kaggle/launch`,
`POST /api/providers/kaggle/poll`) so the browser never sees the key.

### Known limitation of the auto-fill

A worker kernel never *completes* — it runs a server until the session limit (~12 h on GPU). Kaggle
generally exposes the output zip only for finished kernels, so the tunnel URL may not be readable through
the API while the kernel is still alive. In that case the Studio tells you so and offers the kernel link;
paste the URL printed in the live log. Everything else (push, queue status, GPU allocation, errors) is
automated.

Dataset download (used by the Colab notebook for its reference clip):

```bash
curl -s -L -u "$KAGGLE_USERNAME:$KAGGLE_KEY" \
  https://www.kaggle.com/api/v1/datasets/download/mrsandipmandal/sample-file -o ref.zip
```

---

## 4. Google Colab

There is **no public API and no official CLI to start a consumer Colab runtime**. Anyone claiming
otherwise is using an unofficial client against internal endpoints. Your real options:

| Option | Automated? | Notes |
|---|---|---|
| Browser: open the notebook, *Run all* | no | What the Studio's Colab tab assumes |
| Local Jupyter runtime + `google.colab` package | partly | you host the kernel, Colab UI connects to it |
| Colab Enterprise on Vertex AI | yes (GCP API) | paid, service-account auth, different product |
| Kaggle instead of Colab | yes | Kaggle has the official API — use the Kaggle tab |

Colab is still useful *without* any API: it can call the Hugging Face and Kaggle APIs from inside the
notebook, which is why the Colab reference-audio cell uses the Kaggle dataset API instead of asking you to
upload every session.

---

## 5. Local

```bash
bash scripts/local/install_local.sh
source .venv-worker/bin/activate
python scripts/local/run_worker.py --port 8000
python scripts/local/run_worker.py --check          # probe /health
```

No tunnel, no key. The Studio probes `http://127.0.0.1:8000/health` and reports the true device, or
`Disconnected` when the process is not running. See [`local-install.md`](./local-install.md).

---

## 6. Security rules

- Credentials live in the browser vault (`voxindica_api_keys_vault`) and are sent to `server.ts` per
  request only. Nothing is persisted server-side and nothing is committed.
- The worker token is generated per session (`secrets.token_hex(16)`); restarting the worker invalidates it.
- Tunnels are public URLs: treat the bearer token as the only access control, and stop the kernel when done.
- Batch callback secrets and URL tokens are generated per job, stored server-side only, and never returned
  by the Studio API. The worker signs every callback with HMAC-SHA256; the Studio also enforces a ±5-minute
  timestamp window and rejects unknown tokens.
- A public tunnel for batch callbacks must point at the dedicated listener (`127.0.0.1:3099`), not the main
  Studio app. The listener exposes only `/healthz` and the signed webhook route.
- Worker audio is accepted only after the Studio validates a RIFF/WAVE header and the 50 MB size limit.
  No batch item is ever marked completed without a real worker response.
- The Studio never reports a provider as online without a successful response from that provider.
