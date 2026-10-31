#!/usr/bin/env python3
"""Generate the VoxIndica worker notebooks and UI script bundles.

Single source of truth: ``workers/voxindica_worker_core.py``.

Outputs (all committed, so ``npm run build`` never needs Python):

    notebooks/kaggle/voxindica_worker.ipynb
    notebooks/colab/voxindica_worker.ipynb
    notebooks/kaggle/kernel-metadata.json   (template for the Kaggle API push)
    public/notebooks/voxindica_worker_kaggle.ipynb
    public/notebooks/voxindica_worker_colab.ipynb
    public/workers/voxindica_worker_local.py
    public/workers/voxindica_worker_kaggle.py
    public/workers/voxindica_worker_colab.py
    src/data/workerScripts.ts

Run: ``python workers/build_notebooks.py``
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CORE_PATH = ROOT / "workers" / "voxindica_worker_core.py"
CORE = CORE_PATH.read_text(encoding="utf-8").rstrip() + "\n"

INSTALL_PACKAGES = ["voxcpm==2.0.3", "soundfile", "fastapi", "uvicorn"]

DOCS_URL = "/docs/providers.md"
NOTEBOOK_PUBLIC_DIR = ROOT / "public" / "notebooks"
WORKER_PUBLIC_DIR = ROOT / "public" / "workers"


# --------------------------------------------------------------------------- #
# notebook helpers
# --------------------------------------------------------------------------- #
def _source(text: str) -> list[str]:
    text = text.strip("\n")
    lines = text.split("\n")
    return [line + "\n" for line in lines[:-1]] + [lines[-1]]


def md(text: str) -> dict:
    return {"cell_type": "markdown", "metadata": {}, "source": _source(text)}


def code(text: str) -> dict:
    return {
        "cell_type": "code",
        "execution_count": None,
        "metadata": {},
        "outputs": [],
        "source": _source(text),
    }


def notebook(cells: list[dict], platform: str) -> dict:
    return {
        "cells": cells,
        "metadata": {
            "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
            "language_info": {"name": "python", "version": "3.11"},
            "accelerator": "GPU",
            "voxindica": {"platform": platform, "worker": "voxcpm2", "core_version_file": "workers/voxindica_worker_core.py"},
        },
        "nbformat": 4,
        "nbformat_minor": 5,
    }


# --------------------------------------------------------------------------- #
# shared cells
# --------------------------------------------------------------------------- #
INSTALL_CELL = f'''
import sys
import subprocess

PACKAGES = {json.dumps(INSTALL_PACKAGES)}
print("Python executable:", sys.executable)
result = subprocess.run(
    [sys.executable, "-m", "pip", "install", "--no-cache-dir", *PACKAGES],
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    text=True,
)
print(result.stdout[-15000:])
print("Install exit code:", result.returncode)
if result.returncode != 0:
    raise RuntimeError("VoxCPM installation failed; inspect the output above.")
'''

ENV_CELL = '''
import importlib.util
import os
import sys

import torch

PLATFORM_LABEL = PLATFORM  # set by the previous cell
print("Platform:", PLATFORM_LABEL)
print("Python:", sys.version.split()[0])
print("VoxCPM module:", bool(importlib.util.find_spec("voxcpm")))
print("PyTorch:", torch.__version__)
print("CUDA available:", torch.cuda.is_available())
if torch.cuda.is_available():
    props = torch.cuda.get_device_properties(0)
    print("GPU:", torch.cuda.get_device_name(0))
    print("VRAM:", round(props.total_memory / 1024**3, 1), "GB")
else:
    print("WARNING: CUDA is not available. VoxCPM2 on CPU is extremely slow and the studio will time out.")
'''

CORE_HEADER = '''
# ==============================================================================
# VoxIndica worker core — generated from workers/voxindica_worker_core.py
# Do not edit this cell by hand; edit the core and run: python workers/build_notebooks.py
# ==============================================================================
'''

KAGGLE_REF_CELL = '''
from pathlib import Path

import soundfile as sf
from IPython.display import Audio, display

# Point this at an exact file if the automatic search picks the wrong clip.
REFERENCE_OVERRIDE = ""


def locate_reference() -> str:
    if REFERENCE_OVERRIDE:
        if not Path(REFERENCE_OVERRIDE).is_file():
            raise FileNotFoundError(f"REFERENCE_OVERRIDE not found: {REFERENCE_OVERRIDE}")
        return REFERENCE_OVERRIDE
    root = Path("/kaggle/input")
    patterns = ("datasets/*/*/*.wav", "*/*/*.wav", "*/*.wav", "*.wav")
    for pattern in patterns:
        hits = sorted(p for p in root.glob(pattern) if p.is_file())
        if hits:
            return str(hits[0])
    # Not fatal: the Studio uploads a reference clip with every cloning request,
    # so the worker can start with no bundled default.
    print(
        "No .wav under /kaggle/input. Starting without a default reference — "
        "the Studio sends one with each clone_voice request."
    )
    return ""


REFERENCE_WAV = locate_reference()
if REFERENCE_WAV:
    data, rate = sf.read(REFERENCE_WAV)
    print("Reference audio:", REFERENCE_WAV)
    print("Sample rate:", rate, "Hz")
    print("Duration:", round(len(data) / rate, 2), "seconds")
    print("Size:", Path(REFERENCE_WAV).stat().st_size, "bytes")
    display(Audio(data, rate=rate))
else:
    print("Default reference: none (per-request audio will be used)")

'''

COLAB_REF_CELL = '''
import io
import os
import zipfile
from pathlib import Path

import soundfile as sf
from IPython.display import Audio, display

# Owner/dataset-slug on Kaggle. Change this to your own reference dataset.
KAGGLE_DATASET = "mrsandipmandal/sample-file"
REFERENCE_WAV = "/content/voxindica_reference.wav"


def _kaggle_credentials():
    try:
        from google.colab import userdata

        return userdata.get("KAGGLE_USERNAME"), userdata.get("KAGGLE_KEY")
    except Exception:
        return os.environ.get("KAGGLE_USERNAME"), os.environ.get("KAGGLE_KEY")


def _download_from_kaggle() -> bool:
    username, key = _kaggle_credentials()
    if not (username and key):
        return False
    import base64
    import urllib.request

    token = base64.b64encode(f"{username}:{key}".encode()).decode()
    url = f"https://www.kaggle.com/api/v1/datasets/download/{KAGGLE_DATASET}"
    request = urllib.request.Request(url, headers={"Authorization": f"Basic {token}"})
    print("Downloading reference dataset from the Kaggle API...")
    with urllib.request.urlopen(request, timeout=120) as response:  # noqa: S310
        payload = response.read()
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        for name in archive.namelist():
            if name.lower().endswith(".wav"):
                with archive.open(name) as handle:
                    Path(REFERENCE_WAV).write_bytes(handle.read())
                print("Extracted:", name)
                return True
    return False


def _upload_reference() -> bool:
    from google.colab import files

    print("Select an audio file (3-30s):")
    uploaded = files.upload()
    for name, payload in uploaded.items():
        Path(REFERENCE_WAV).write_bytes(payload)
        print("Uploaded:", name)
        return True
    return False


if not Path(REFERENCE_WAV).is_file():
    if not _download_from_kaggle():
        print("Kaggle credentials not found in Colab Secrets (KAGGLE_USERNAME / KAGGLE_KEY).")
        if not _upload_reference():
            raise RuntimeError("A reference recording is required for voice cloning.")

data, rate = sf.read(REFERENCE_WAV)
print("Reference audio:", REFERENCE_WAV)
print("Sample rate:", rate, "Hz")
print("Duration:", round(len(data) / rate, 2), "seconds")
display(Audio(data, rate=rate))
'''

SERVE_CELL = '''
session = serve(
    platform_name=PLATFORM,
    port=8000,
    tunnel=True,
    reference_wav=REFERENCE_WAV,
    block=False,
)

print()
print("COPY THESE INTO VOXINDICA STUDIO -> INFERENCE PROVIDER")
print("TUNNEL URL   :", session["url"])
print("BEARER TOKEN :", session["token"])
'''

STATUS_CELL = '''
import json
from pathlib import Path

import urllib.request

status = json.loads(urllib.request.urlopen("http://127.0.0.1:8000/health", timeout=5).read().decode())
print(json.dumps(status, indent=2))
print()
print("Session file:", Path("worker_session.json").resolve())
'''

KEEPALIVE_CELL = '''
# Kaggle (and Colab) stop the process as soon as the last cell finishes, which also
# kills the Cloudflare tunnel. This cell blocks on purpose so the worker stays reachable.
import time

print("Worker is live. Leave this cell running — stop the session to shut it down.")
while True:
    time.sleep(600)
'''

TROUBLESHOOTING = '''
## Troubleshooting

- **`ModuleNotFoundError: voxcpm`** — rerun the install cell with the same kernel, restart the session, then start again from the environment cell.
- **Model download error** — enable Internet (Kaggle: *Settings → Internet*, Colab: it is on by default) and rerun the start cell.
- **CUDA out of memory** — restart the session, make sure no other GPU process is running, and retry. The worker keeps the denoiser disabled to save VRAM.
- **`TUNNEL URL: unavailable`** — `cloudflared` could not reach GitHub. Rerun the start cell, or download `cloudflared-linux-amd64` manually into the working directory.
- **Studio shows `Disconnected`** — the tunnel URL changes on every restart. Copy the new URL and token, or use *Launch on Kaggle* in the Studio.
- **HTTP 503 from `/clone_voice`** — the model never loaded. Check the install cell output; the worker never returns synthetic audio, by design.
- **HTTP 401** — the bearer token does not match the one printed by the start cell.
- **Long scripts** — text is synthesized in ~800 character chunks (`VOXINDICA_CHUNK_CHARS` overrides this). Expect minutes, not seconds, on a T4.
- **Session limits** — Kaggle GPU kernels stop after roughly 12 hours and Colab frees idle runtimes. Re-run the start cell afterwards; the Studio reports the worker as offline rather than faking a remaining time.
'''


def build_notebook(platform: str) -> dict:
    label = "Kaggle" if platform == "kaggle" else "Google Colab"
    reference_cell = KAGGLE_REF_CELL if platform == "kaggle" else COLAB_REF_CELL
    platform_cell = f'PLATFORM = "{platform}"\nprint("Runtime target:", PLATFORM)'
    output_note = (
        "Outputs are written to `/kaggle/working/` (the notebook **Output** tab)."
        if platform == "kaggle"
        else "Outputs stay in the Colab kernel; download them from the Files panel."
    )

    cells = [
        md(
            f"""
# VoxIndica Studio — VoxCPM-2 Worker ({label})

Turns this notebook into an HTTP worker that VoxIndica Studio can call: **zero-shot voice cloning**
plus **multilingual TTS** for Bengali (`bn-IN`), Hindi (`hi-IN`) and Indian English (`en-IN`).

**Model:** `openbmb/VoxCPM2` · **Package:** `voxcpm==2.0.3` · **Output:** 16-bit mono PCM WAV, 24 kHz

Run the cells top to bottom. The last cell prints two values you paste into the Studio:

```
TUNNEL URL   : https://xxxx.trycloudflare.com
BEARER TOKEN : <32 hex chars>
```

{output_note}
"""
        ),
        md(
            """
## 1. Turn on the GPU

- **Kaggle:** *Settings → Accelerator → GPU T4 x2* (or P100), *Internet → On*.
- **Colab:** *Runtime → Change runtime type → T4 GPU*.

Then run the next cell.
"""
        ),
        code(platform_cell),
        md(
            f"""
## 2. Install the worker packages

Installs `{"`, `".join(INSTALL_PACKAGES)}` into the **active kernel** (`sys.executable`), which is the
only reliable way to make the import work after a fresh Kaggle session.
"""
        ),
        code(INSTALL_CELL),
        md("## 3. Verify the runtime"),
        code(ENV_CELL),
        md(
            """
## 4. Reference recording

Voice cloning needs 3–30 seconds of clean speech. The Studio sends its own reference audio with every
request; this clip is the fallback used when you call the worker directly.
"""
        ),
        code(reference_cell),
        md(
            """
## 5. Worker core

Generated from `workers/voxindica_worker_core.py` — the same code that runs on your own PC.
Exposes `/health`, `/clone_voice` and `/synthesize` behind a bearer token.
"""
        ),
        code(CORE_HEADER + CORE),
        md(
            """
## 6. Start the worker and the Cloudflare tunnel

This cell keeps running in the background and prints the tunnel URL + bearer token.
If the session resets, rerun cell 3 and then this cell.
"""
        ),
        code(SERVE_CELL),
        md("## 7. Confirm the worker is healthy"),
        code(STATUS_CELL),
        md(
            """
## 8. Keep the session alive

The worker runs in a background thread, so the notebook would otherwise finish and Kaggle would stop the
process — taking the tunnel down with it. This last cell blocks on purpose.
"""
        ),
        code(KEEPALIVE_CELL),
        md(TROUBLESHOOTING),
    ]
    return notebook(cells, platform)


def build_python_bundle(platform: str) -> str:
    label = "Kaggle" if platform == "kaggle" else "Google Colab"
    if platform == "local":
        footer = '''

if __name__ == "__main__":
    serve(
        platform_name="local",
        port=int(os.environ.get("VOXINDICA_PORT", "8000")),
        host="127.0.0.1",
        tunnel=False,
        block=True,
    )
'''
        header = "# ==============================================================================\n# VoxIndica Studio — local VoxCPM2 worker (127.0.0.1 only, no tunnel)\n# ==============================================================================\n"
    else:
        footer = f'''

if __name__ == "__main__":
    _ensure_packages()
    serve(
        platform_name="{platform}",
        port=8000,
        tunnel=True,
        block=False,
    )
'''
        header = f"# ==============================================================================\n# VoxIndica Studio — {label} worker (single-cell script)\n# ==============================================================================\n"

    installer = "" if platform == "local" else f'''

def _ensure_packages() -> None:
    import subprocess

    subprocess.run(
        [sys.executable, "-m", "pip", "install", "--no-cache-dir", *{json.dumps(INSTALL_PACKAGES)}],
        check=False,
    )
'''

    return header + CORE + installer + footer


def write_ts(bundles: dict[str, dict]) -> None:
    payload = json.dumps(bundles, indent=2, ensure_ascii=False)
    ts = f"""// AUTO-GENERATED by workers/build_notebooks.py — do not edit by hand.
// Source of truth: workers/voxindica_worker_core.py

export type WorkerPlatform = 'kaggle' | 'colab' | 'local';

export interface WorkerStep {{
  title: string;
  detail: string;
  link?: {{ label: string; href: string }};
}}

export interface WorkerScriptBundle {{
  platform: WorkerPlatform;
  label: string;
  pythonFileName: string;
  notebookPath: string | null;
  pythonPath: string;
  docsUrl: string;
  packages: string[];
  steps: WorkerStep[];
  code: string;
}}

export const WORKER_SCRIPTS: Record<WorkerPlatform, WorkerScriptBundle> = {payload};

export const getWorkerScript = (platform: WorkerPlatform): WorkerScriptBundle => WORKER_SCRIPTS[platform];
"""
    target = ROOT / "src" / "data" / "workerScripts.ts"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(ts, encoding="utf-8")


def main() -> int:
    if not CORE_PATH.is_file():
        print(f"missing core: {CORE_PATH}", file=sys.stderr)
        return 1

    NOTEBOOK_PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
    WORKER_PUBLIC_DIR.mkdir(parents=True, exist_ok=True)

    common_steps = [
        {
            "title": "Open the notebook and enable the GPU",
            "detail": "Kaggle: Settings → Accelerator → GPU T4 x2, Internet → On. Colab: Runtime → Change runtime type → T4 GPU.",
            "link": {"label": "Open Kaggle", "href": "https://www.kaggle.com/code"},
        },
        {
            "title": "Run all cells",
            "detail": "The install cell pins voxcpm==2.0.3 into the active kernel; the last cell starts the API and the tunnel.",
        },
        {
            "title": "Paste the URL and token",
            "detail": "Copy TUNNEL URL and BEARER TOKEN from the last cell into this screen, then press Test & Save.",
        },
    ]

    bundles: dict[str, dict] = {}

    for platform in ("kaggle", "colab"):
        label = "Kaggle" if platform == "kaggle" else "Google Colab"
        nb = build_notebook(platform)
        target_dir = ROOT / "notebooks" / platform
        target_dir.mkdir(parents=True, exist_ok=True)
        target = target_dir / "voxindica_worker.ipynb"
        text = json.dumps(nb, indent=1, ensure_ascii=False) + "\n"
        target.write_text(text, encoding="utf-8")
        (NOTEBOOK_PUBLIC_DIR / f"voxindica_worker_{platform}.ipynb").write_text(text, encoding="utf-8")

        python_bundle = build_python_bundle(platform)
        (WORKER_PUBLIC_DIR / f"voxindica_worker_{platform}.py").write_text(python_bundle, encoding="utf-8")

        steps = list(common_steps)
        if platform == "colab":
            steps[0]["link"] = {"label": "Open Colab", "href": "https://colab.research.google.com/"}
            steps.insert(
                2,
                {
                    "title": "Optional: load the reference clip via API",
                    "detail": "Store KAGGLE_USERNAME and KAGGLE_KEY in Colab Secrets to pull the dataset through the Kaggle API instead of uploading.",
                },
            )

        bundles[platform] = {
            "platform": platform,
            "label": label,
            "pythonFileName": f"voxindica_worker_{platform}.py",
            "notebookPath": f"/notebooks/voxindica_worker_{platform}.ipynb",
            "pythonPath": f"/workers/voxindica_worker_{platform}.py",
            "docsUrl": DOCS_URL,
            "packages": INSTALL_PACKAGES,
            "steps": steps,
            "code": python_bundle,
        }

    local_bundle = build_python_bundle("local")
    (WORKER_PUBLIC_DIR / "voxindica_worker_local.py").write_text(local_bundle, encoding="utf-8")

    bundles["local"] = {
        "platform": "local",
        "label": "Local Hardware",
        "pythonFileName": "voxindica_worker_local.py",
        "notebookPath": None,
        "pythonPath": "/workers/voxindica_worker_local.py",
        "docsUrl": "/docs/local-install.md",
        "packages": ["voxcpm==2.0.3", "soundfile", "fastapi", "uvicorn"],
        "steps": [
            {
                "title": "Install Python 3.10+ and the worker",
                "detail": "pip install voxcpm==2.0.3 soundfile fastapi uvicorn (or bash scripts/local/install_local.sh).",
                "link": {"label": "Python downloads", "href": "https://www.python.org/downloads/"},
            },
            {
                "title": "Start the worker",
                "detail": "python voxindica_worker_local.py — binds 127.0.0.1:8000, no tunnel and no public exposure.",
            },
            {
                "title": "Recheck the connection",
                "detail": "The Local tab probes /health directly. If it says Disconnected, the process is not running.",
            },
        ],
        "code": local_bundle,
    }

    kernel_metadata = {
        "id": "__KAGGLE_USERNAME__/voxindica-voxcpm2-worker",
        "title": "VoxIndica VoxCPM2 Worker",
        "code_file": "voxindica_worker.ipynb",
        "language": "python",
        "kernel_type": "notebook",
        "is_private": "true",
        "enable_gpu": "true",
        "enable_internet": "true",
        "dataset_sources": [],
        "competition_sources": [],
        "kernel_sources": [],
        "keywords": ["tts", "voice-cloning", "voxcpm2"],
    }
    (ROOT / "notebooks" / "kaggle" / "kernel-metadata.json").write_text(
        json.dumps(kernel_metadata, indent=2) + "\n", encoding="utf-8"
    )

    write_ts(bundles)

    print("generated:")
    for path in (
        "notebooks/kaggle/voxindica_worker.ipynb",
        "notebooks/colab/voxindica_worker.ipynb",
        "notebooks/kaggle/kernel-metadata.json",
        "public/notebooks/voxindica_worker_kaggle.ipynb",
        "public/notebooks/voxindica_worker_colab.ipynb",
        "public/workers/voxindica_worker_kaggle.py",
        "public/workers/voxindica_worker_colab.py",
        "public/workers/voxindica_worker_local.py",
        "src/data/workerScripts.ts",
    ):
        print("  -", path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
