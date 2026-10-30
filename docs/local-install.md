# Run VoxIndica on your own PC

The local mode runs the exact same worker code as the Kaggle/Colab notebooks, bound to
`127.0.0.1:8000` with **no tunnel and no public exposure**. The Studio probes it directly, so nothing is
reported online unless the process is really running.

## Requirements

- Python 3.10 – 3.12 (VoxCPM pins PyTorch; 3.13 usually has no wheels yet)
- 16 GB RAM minimum, 8 GB+ VRAM recommended (CUDA) — CPU works but is far slower than audio
- ~6 GB disk for model weights

## 1. Install

```bash
bash scripts/local/install_local.sh
```

This creates `.venv-worker/` and installs `scripts/local/requirements-local.txt`.
For an NVIDIA GPU with CUDA 12.1, install the CUDA build of torch first:

```bash
.venv-worker/bin/pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu121
```

Manual equivalent:

```bash
python3 -m venv .venv-worker
source .venv-worker/bin/activate
python -m pip install --upgrade pip
python -m pip install -r scripts/local/requirements-local.txt
```

## 2. Start the worker

```bash
source .venv-worker/bin/activate
python scripts/local/run_worker.py --port 8000
```

First run downloads `openbmb/VoxCPM2` (several GB). Wait for:

```
VOXINDICA WORKER READY
  Local URL     : http://127.0.0.1:8000
  Model         : openbmb/VoxCPM2 (loaded)
  BEARER TOKEN  : <hex>
```

The printed token is also stored in `worker_session.json`. Copy it into the Studio's Local tab.

## 3. Verify from the terminal

```bash
python scripts/local/run_worker.py --check
```

```json
{"status": "online", "model_loaded": true, "gpu_device": "NVIDIA GeForce RTX 4060", "cuda_available": true}
```

## 4. Point the Studio at it

*Inference Providers & API → Local Hardware* → endpoint `http://127.0.0.1:8000`, paste the token, press
**Test & Save**. The panel shows the real device reported by `/health`, not a hardcoded latency.

## Options

| Flag | Default | Meaning |
|---|---|---|
| `--host` | `127.0.0.1` | keep on loopback unless you know what you are doing |
| `--port` | `8000` | must match the Studio endpoint |
| `--token` | random | fixed token for long-lived installs (`VOXINDICA_WORKER_TOKEN` also works) |
| `--model` | `openbmb/VoxCPM2` | Hugging Face repo id |
| `--check` | — | probe a running worker and exit |

## Troubleshooting

| Symptom | Fix |
|---|---|
| `CUDA is not available` | install the CUDA torch wheel; verify with `python -c "import torch;print(torch.cuda.is_available())"` |
| `Address already in use` | another worker is running — `--port 8001` and update the Studio endpoint |
| Studio shows **Disconnected** | the process stopped; check the terminal, then press Recheck |
| `503` on synthesis | the model failed to load — the response body contains the real exception |
| Out of memory | close other GPU apps, lower `VOXINDICA_CHUNK_CHARS` (e.g. `400`), or use the T4 worker instead |
| Slow on CPU | expected; a T4 is roughly 20–40× faster for this model |
