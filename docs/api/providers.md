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
  "version": "1.0.0",
  "platform": "kaggle",
  "model": "openbmb/VoxCPM2",
  "model_loaded": true,
  "model_error": null,
  "sample_rate": 24000,
  "auth_required": true,
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
| `reference_audio` | string | base64 or data-URL, RIFF/WAVE, 3–30 s recommended, ≤ 25 MB |
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
- The Studio never reports a provider as online without a successful response from that provider.
