#!/usr/bin/env python3
"""Generate the Phase 4.2 avatar spike notebooks.

Two independent Kaggle kernels are produced so SadTalker and MuseTalk can be
compared on the same T4 without one engine's dependencies breaking the other:

    notebooks/kaggle/sadtalker_spike/voxindica_sadtalker_spike.ipynb
    notebooks/kaggle/sadtalker_spike/kernel-metadata.json
    notebooks/kaggle/musetalk_spike/voxindica_musetalk_spike.ipynb
    notebooks/kaggle/musetalk_spike/kernel-metadata.json

These notebooks are deliberately unverified: this repository cannot run a GPU
kernel. They walk the operator through input discovery, installation, weight
download, one inference run, wall-clock/VRAM measurement and a result check. A
failure is printed verbatim; no step fabricates a clip.

Run: ``python workers/build_video_notebooks.py``
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
KAGGLE_DIR = ROOT / "notebooks" / "kaggle"

DISCLAIMER = """
> **Status: unverified.** This notebook is generated from a template in
> `workers/build_video_notebooks.py` and has not been executed on a T4 by this
> repository. Installation commands and flags are a starting point, not a
> guarantee. If a step fails, keep the real error and report it — do not paper
> over it with a placeholder clip.
>
> **Consent:** use only a presenter photo and voice clip that the person has
> explicitly agreed to use for an AI-generated likeness and synthetic voice.
> Never upload someone else's face.
"""

INPUTS_MD = """
## Inputs

Attach a **private** Kaggle dataset containing:

- one clear, front-facing photo (`jpg`/`png`, at least 512×512, eyes visible)
- one narration clip (`wav`, mono/stereo, 3–30 seconds)

The next cell lists `/kaggle/input`. If automatic discovery picks the wrong
file, set `IMAGE_OVERRIDE` and `AUDIO_OVERRIDE` to absolute paths.
"""

INPUT_CELL = '''
from pathlib import Path

import soundfile as sf
from IPython.display import Audio, display

IMAGE_OVERRIDE = ""
AUDIO_OVERRIDE = ""

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}
AUDIO_SUFFIXES = {".wav"}


def _find(root: Path, suffixes: set[str]) -> list[Path]:
    if not root.is_dir():
        return []
    return sorted(
        p for p in root.rglob("*")
        if p.is_file() and p.suffix.lower() in suffixes
    )


def locate_image() -> Path:
    if IMAGE_OVERRIDE:
        path = Path(IMAGE_OVERRIDE)
        if not path.is_file():
            raise FileNotFoundError(f"IMAGE_OVERRIDE not found: {path}")
        return path
    hits = _find(Path("/kaggle/input"), IMAGE_SUFFIXES)
    if not hits:
        raise FileNotFoundError(
            "No image under /kaggle/input. Attach a dataset with a presenter photo "
            "and set IMAGE_OVERRIDE if needed."
        )
    return hits[0]


def locate_audio() -> Path:
    if AUDIO_OVERRIDE:
        path = Path(AUDIO_OVERRIDE)
        if not path.is_file():
            raise FileNotFoundError(f"AUDIO_OVERRIDE not found: {path}")
        return path
    hits = _find(Path("/kaggle/input"), AUDIO_SUFFIXES)
    if not hits:
        raise FileNotFoundError(
            "No .wav under /kaggle/input. Attach a 3-30s narration clip and set "
            "AUDIO_OVERRIDE if needed."
        )
    return hits[0]


IMAGE_PATH = locate_image()
AUDIO_PATH = locate_audio()

data, rate = sf.read(str(AUDIO_PATH))
duration = len(data) / rate
print("Image:", IMAGE_PATH, f"({IMAGE_PATH.stat().st_size} bytes)")
print("Audio:", AUDIO_PATH, f"({duration:.2f}s at {rate} Hz)")
if not 3 <= duration <= 30:
    raise ValueError(
        f"The reference clip is {duration:.1f}s. This spike expects 3-30s; trim it first."
    )
display(Audio(data, rate=rate))
'''

GPU_CELL = '''
import platform
import shutil
import subprocess
import sys

import torch

print("Python:", sys.version.split()[0], "|", platform.platform())
print("PyTorch:", torch.__version__)
print("CUDA available:", torch.cuda.is_available())
if not torch.cuda.is_available():
    raise RuntimeError(
        "No CUDA device. In Kaggle, open Settings -> Accelerator -> GPU T4 x2, "
        "then restart the kernel."
    )
props = torch.cuda.get_device_properties(0)
print("GPU:", torch.cuda.get_device_name(0))
print("VRAM:", round(props.total_memory / 1024**3, 1), "GB")
print("ffmpeg:", shutil.which("ffmpeg") or "missing")
print(subprocess.run(
    ["nvidia-smi", "--query-gpu=name,memory.total,driver_version", "--format=csv"],
    capture_output=True, text=True
).stdout)
'''

MEASURE_MD = """
## Run and measure

The next cell runs the engine once and samples `nvidia-smi` in the background.
`peak_vram_mb` is the highest **total** GPU memory observed, so it includes
CUDA context and any other process on the device — treat it as an upper bound,
not an isolated model footprint.
"""

RESULT_CELL = '''
import shutil
import subprocess
from pathlib import Path

from IPython.display import Video, display

WORK = Path("/kaggle/working")
output_dirs = [WORK / "sadtalker_out", WORK / "musetalk_out"]
clips = sorted(
    (
        p for root in output_dirs if root.is_dir()
        for p in root.rglob("*.mp4")
        if p.stat().st_size > 0
    ),
    key=lambda p: p.stat().st_mtime,
)
if not clips:
    raise FileNotFoundError(
        "No MP4 was produced under the engine output directory. The inference "
        "log above is the real failure; do not continue as if this spike passed."
    )

latest = clips[-1]
final = WORK / "avatar_spike.mp4"
shutil.copy2(latest, final)
probe = subprocess.run(
    ["ffprobe", "-v", "error", "-show_entries",
     "format=duration,size:stream=width,height,r_frame_rate",
     "-of", "json", str(final)],
    capture_output=True, text=True,
)
print("Clip:", final)
print("Bytes:", final.stat().st_size)
print(probe.stdout)
display(Video(str(final), embed=False, width=480))
'''

REPORT_MD = """
## Report back

Copy these into the spike result table:

| Field | Value |
| --- | --- |
| Engine + version/commit | |
| Wall time (s) | |
| Peak GPU memory (MB, upper bound) | |
| Output duration / resolution | |
| Subjective lip-sync (1–5) | |
| Subjective identity retention (1–5) | |
| Artifacts or failure mode | |

The studio will only integrate an engine after a real clip is produced and these
numbers are recorded. A notebook that errors is a useful result; a fabricated
pass is not.
"""


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


def notebook(cells: list[dict], engine: str) -> dict:
    return {
        "cells": cells,
        "metadata": {
            "kernelspec": {
                "display_name": "Python 3",
                "language": "python",
                "name": "python3",
            },
            "language_info": {"name": "python", "version": "3.11"},
            "accelerator": "GPU",
            "voxindica": {
                "phase": "4.2",
                "engine": engine,
                "status": "unverified",
                "builder": "workers/build_video_notebooks.py",
            },
        },
        "nbformat": 4,
        "nbformat_minor": 5,
    }


def metadata(slug: str, title: str, code_file: str, keywords: list[str]) -> dict:
    return {
        "id": f"__KAGGLE_USERNAME__/{slug}",
        "title": title,
        "code_file": code_file,
        "language": "python",
        "kernel_type": "notebook",
        "is_private": "true",
        "enable_gpu": "true",
        "enable_internet": "true",
        "dataset_sources": [],
        "competition_sources": [],
        "kernel_sources": [],
        "keywords": keywords,
    }


SADTALKER_RUN = '''
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

REPO = Path("/kaggle/working/SadTalker")
OUT = Path("/kaggle/working/sadtalker_out")
OUT.mkdir(parents=True, exist_ok=True)

cmd = [
    sys.executable, "inference.py",
    "--driven_audio", str(AUDIO_PATH),
    "--source_image", str(IMAGE_PATH),
    "--result_dir", str(OUT),
    "--still",
    "--preprocess", "full",
    "--size", "256",
    "--batch_size", "2",
]

peak = {"mb": 0}
stop = threading.Event()


def sample_vram() -> None:
    while not stop.is_set():
        try:
            raw = subprocess.run(
                ["nvidia-smi", "--query-gpu=memory.used",
                 "--format=csv,noheader,nounits"],
                capture_output=True, text=True, timeout=5,
            ).stdout
            values = [int(part) for part in raw.replace(",", " ").split() if part.isdigit()]
            if values:
                peak["mb"] = max(peak["mb"], max(values))
        except Exception:
            pass
        time.sleep(0.5)


os.chdir(REPO)
sampler = threading.Thread(target=sample_vram, daemon=True)
sampler.start()
started = time.time()
proc = subprocess.run(cmd, text=True, capture_output=True)
elapsed = time.time() - started
stop.set()
sampler.join(timeout=3)

print(proc.stdout[-12000:])
print(proc.stderr[-12000:])
print(f"exit={proc.returncode} wall_s={elapsed:.1f} peak_vram_mb={peak['mb']}")
if proc.returncode != 0:
    raise RuntimeError(
        "SadTalker inference failed. The log above is the real error; do not "
        "fabricate a result."
    )
'''

SADTALKER_INSTALL = '''
import os
import subprocess
import sys
from pathlib import Path

REPO = Path("/kaggle/working/SadTalker")
if not (REPO / "inference.py").is_file():
    subprocess.run(
        ["git", "clone", "--depth", "1",
         "https://github.com/OpenTalker/SadTalker.git", str(REPO)],
        check=True,
    )
print("SadTalker commit:")
print(subprocess.run(
    ["git", "-C", str(REPO), "rev-parse", "HEAD"],
    capture_output=True, text=True,
).stdout.strip())
print(subprocess.run(
    ["git", "-C", str(REPO), "log", "-1", "--format=%cs %s"],
    capture_output=True, text=True,
).stdout.strip())

install = subprocess.run(
    [sys.executable, "-m", "pip", "install", "--no-cache-dir",
     "-r", str(REPO / "requirements.txt")],
    text=True, capture_output=True,
)
print(install.stdout[-12000:])
print(install.stderr[-6000:])
print("pip exit:", install.returncode)
if install.returncode != 0:
    raise RuntimeError(
        "SadTalker requirements did not install. Report the pip error above; "
        "do not skip the install and pretend the run worked."
    )
'''

SADTALKER_WEIGHTS = '''
import os
import subprocess
from pathlib import Path

REPO = Path("/kaggle/working/SadTalker")
script = REPO / "scripts" / "download_models.sh"
if not script.is_file():
    raise FileNotFoundError(f"Missing SadTalker weight script: {script}")

os.chdir(REPO)
result = subprocess.run(["bash", str(script)], text=True, capture_output=True)
print(result.stdout[-12000:])
print(result.stderr[-6000:])
print("weights exit:", result.returncode)
if result.returncode != 0:
    raise RuntimeError("SadTalker checkpoint download failed; see the output above.")

for path in sorted((REPO / "checkpoints").glob("*")):
    print(path.name, path.stat().st_size if path.is_file() else "<dir>")
'''

SADTALKER_COMPAT = '''
import importlib.util
from pathlib import Path

# SadTalker pulls basicsr, whose old import of
# torchvision.transforms.functional_tensor breaks on newer torchvision. Apply
# the standard one-line compatibility patch only when that import is present.
spec = importlib.util.find_spec("basicsr")
if spec and spec.origin:
    degradations = Path(spec.origin).parent / "data" / "degradations.py"
    if degradations.is_file():
        text = degradations.read_text(encoding="utf-8")
        old = "from torchvision.transforms.functional_tensor import rgb_to_grayscale"
        new = "from torchvision.transforms.functional import rgb_to_grayscale"
        if old in text:
            degradations.write_text(text.replace(old, new), encoding="utf-8")
            print("Patched basicsr:", degradations)
        else:
            print("basicsr needs no functional_tensor patch.")
    else:
        print("basicsr installed but degradations.py was not found; continuing.")
else:
    print("basicsr is not importable; the inference cell will show the real error.")
'''

MUSETALK_INSTALL = '''
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path("/kaggle/working/MuseTalk")
if not (REPO / "scripts" / "inference.py").is_file():
    subprocess.run(
        ["git", "clone", "--depth", "1",
         "https://github.com/TMElyralab/MuseTalk.git", str(REPO)],
        check=True,
    )
print("MuseTalk commit:")
print(subprocess.run(
    ["git", "-C", str(REPO), "rev-parse", "HEAD"],
    capture_output=True, text=True,
).stdout.strip())
print(subprocess.run(
    ["git", "-C", str(REPO), "log", "-1", "--format=%cs %s"],
    capture_output=True, text=True,
).stdout.strip())
print("Python:", sys.version.split()[0])
if sys.version_info[:2] != (3, 10):
    print(
        "WARNING: MuseTalk documents Python 3.10. This kernel is not 3.10; "
        "dependency resolution may fail. Keep the real error if it does."
    )

# Upstream documents torch 2.0.1 + cu118, and mmcv 2.0.1 wheels match that ABI.
# Pin the trio explicitly instead of mixing Kaggle's torch with old mmcv.
PIN_TORCH = True
if PIN_TORCH:
    pin = subprocess.run(
        [sys.executable, "-m", "pip", "install", "--no-cache-dir",
         "torch==2.0.1", "torchvision==0.15.2", "torchaudio==2.0.2",
         "--index-url", "https://download.pytorch.org/whl/cu118"],
        text=True, capture_output=True,
    )
    print(pin.stdout[-10000:])
    print(pin.stderr[-5000:])
    print("torch pin exit:", pin.returncode)
    if pin.returncode != 0:
        raise RuntimeError(
            "Could not install the documented torch 2.0.1/cu118 stack. Report "
            "the pip output above; do not continue with mismatched wheels."
        )

install = subprocess.run(
    [sys.executable, "-m", "pip", "install", "--no-cache-dir",
     "-r", str(REPO / "requirements.txt")],
    text=True, capture_output=True,
)
print(install.stdout[-12000:])
print(install.stderr[-6000:])
print("requirements exit:", install.returncode)
if install.returncode != 0:
    raise RuntimeError(
        "MuseTalk requirements did not install. Report the pip error above; "
        "do not continue as if the environment were ready."
    )

mim = shutil.which("mim")
if not mim:
    boot = subprocess.run(
        [sys.executable, "-m", "pip", "install", "--no-cache-dir", "-U", "openmim"],
        text=True, capture_output=True,
    )
    print(boot.stdout[-6000:])
    print(boot.stderr[-3000:])
    mim = shutil.which("mim")
if not mim:
    raise RuntimeError("openmim installed but the `mim` executable is not on PATH.")

for package in ("mmengine", "mmcv==2.0.1", "mmdet==3.1.0", "mmpose==1.1.0"):
    result = subprocess.run(
        [mim, "install", package], text=True, capture_output=True,
    )
    print("mim install", package, "exit:", result.returncode)
    print(result.stdout[-8000:])
    print(result.stderr[-4000:])
    if result.returncode != 0:
        raise RuntimeError(
            f"`mim install {package}` failed. Report the real output above; "
            "do not skip the MMLab stack."
        )
'''

MUSETALK_WEIGHTS = '''
import os
import subprocess
from pathlib import Path

REPO = Path("/kaggle/working/MuseTalk")
script = REPO / "download_weights.sh"
if not script.is_file():
    raise FileNotFoundError(f"Missing MuseTalk weight script: {script}")

os.chdir(REPO)
result = subprocess.run(["bash", str(script)], text=True, capture_output=True)
print(result.stdout[-12000:])
print(result.stderr[-6000:])
print("weights exit:", result.returncode)
if result.returncode != 0:
    raise RuntimeError("MuseTalk checkpoint download failed; see the output above.")

required = [
    "models/musetalkV15/unet.pth",
    "models/musetalkV15/musetalk.json",
    "models/sd-vae/config.json",
    "models/whisper/config.json",
    "models/dwpose/dw-ll_ucoco_384.pth",
    "models/face-parse-bisent/79999_iter.pth",
    "models/face-parse-bisent/resnet18-5c106cde.pth",
]
missing = [name for name in required if not (REPO / name).is_file()]
for name in required:
    path = REPO / name
    print(name, round(path.stat().st_size / 1024**2, 1) if path.is_file() else "MISSING", "MB")
if missing:
    raise FileNotFoundError(
        "Weight download finished but these files are missing: " + ", ".join(missing)
    )
'''

MUSETALK_CONFIG = '''
from pathlib import Path

CONFIG = Path("/kaggle/working/musetalk_task.yaml")
CONFIG.write_text(
    "task_0:\\n"
    f'  video_path: "{Path("/kaggle/working/driving_loop.mp4")}"\\n'
    f'  audio_path: "{AUDIO_PATH}"\\n',
    encoding="utf-8",
)
print(CONFIG.read_text())
'''

MUSETALK_RUN = '''
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

REPO = Path("/kaggle/working/MuseTalk")
OUT = Path("/kaggle/working/musetalk_out")
OUT.mkdir(parents=True, exist_ok=True)

cmd = [
    sys.executable, "-m", "scripts.inference",
    "--inference_config", "/kaggle/working/musetalk_task.yaml",
    "--result_dir", str(OUT),
    "--unet_model_path", "models/musetalkV15/unet.pth",
    "--unet_config", "models/musetalkV15/musetalk.json",
    "--version", "v15",
    "--fps", "25",
    "--batch_size", "4",
    "--use_float16",
]

peak = {"mb": 0}
stop = threading.Event()


def sample_vram() -> None:
    while not stop.is_set():
        try:
            raw = subprocess.run(
                ["nvidia-smi", "--query-gpu=memory.used",
                 "--format=csv,noheader,nounits"],
                capture_output=True, text=True, timeout=5,
            ).stdout
            values = [int(part) for part in raw.replace(",", " ").split() if part.isdigit()]
            if values:
                peak["mb"] = max(peak["mb"], max(values))
        except Exception:
            pass
        time.sleep(0.5)


os.chdir(REPO)
sampler = threading.Thread(target=sample_vram, daemon=True)
sampler.start()
started = time.time()
proc = subprocess.run(cmd, text=True, capture_output=True)
elapsed = time.time() - started
stop.set()
sampler.join(timeout=3)

print(proc.stdout[-12000:])
print(proc.stderr[-12000:])
print(f"exit={proc.returncode} wall_s={elapsed:.1f} peak_vram_mb={peak['mb']}")
if proc.returncode != 0:
    raise RuntimeError(
        "MuseTalk inference failed. The log above is the real error; do not "
        "fabricate a result."
    )
print(
    "Note: scripts/inference.py catches per-task exceptions internally. The next "
    "cell checks that an MP4 actually exists, so a caught failure still fails the spike."
)
'''

MUSETALK_DRIVING = '''
import subprocess
from pathlib import Path

WORK = Path("/kaggle/working")
DRIVING = WORK / "driving_loop.mp4"

# MuseTalk expects a talking-head video, not a still image. Loop the photo into
# a 10s 25fps clip so the spike can run. Head motion is therefore minimal; this
# is a dependency/throughput test, not a realism test.
cmd = [
    "ffmpeg", "-y", "-loop", "1", "-i", str(IMAGE_PATH),
    "-t", "10", "-r", "25",
    "-vf", "scale=512:512:force_original_aspect_ratio=decrease,"
           "pad=512:512:(ow-iw)/2:(oh-ih)/2,setsar=1",
    "-pix_fmt", "yuv420p", str(DRIVING),
]
result = subprocess.run(cmd, text=True, capture_output=True)
print(result.stdout[-4000:])
print(result.stderr[-8000:])
if result.returncode != 0 or not DRIVING.is_file():
    raise RuntimeError("Could not build the looped driving video; see ffmpeg output above.")
print("Driving video:", DRIVING, DRIVING.stat().st_size, "bytes")
'''

MUSETALK_RUN = '''
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

REPO = Path("/kaggle/working/MuseTalk")
OUT = Path("/kaggle/working/musetalk_out")
OUT.mkdir(parents=True, exist_ok=True)

cmd = [
    sys.executable, "scripts/inference.py",
    "--video_path", "/kaggle/working/driving_loop.mp4",
    "--audio_path", str(AUDIO_PATH),
    "--output_path", str(OUT),
    "--fps", "25",
    "--batch_size", "4",
]

peak = {"mb": 0}
stop = threading.Event()


def sample_vram() -> None:
    while not stop.is_set():
        try:
            raw = subprocess.run(
                ["nvidia-smi", "--query-gpu=memory.used",
                 "--format=csv,noheader,nounits"],
                capture_output=True, text=True, timeout=5,
            ).stdout
            values = [int(part) for part in raw.replace(",", " ").split() if part.isdigit()]
            if values:
                peak["mb"] = max(peak["mb"], max(values))
        except Exception:
            pass
        time.sleep(0.5)


os.chdir(REPO)
sampler = threading.Thread(target=sample_vram, daemon=True)
sampler.start()
started = time.time()
proc = subprocess.run(cmd, text=True, capture_output=True)
elapsed = time.time() - started
stop.set()
sampler.join(timeout=3)

print(proc.stdout[-12000:])
print(proc.stderr[-12000:])
print(f"exit={proc.returncode} wall_s={elapsed:.1f} peak_vram_mb={peak['mb']}")
if proc.returncode != 0:
    raise RuntimeError(
        "MuseTalk inference failed. The log above is the real error; do not "
        "fabricate a result."
    )
'''


def build_sadtalker() -> dict:
    cells = [
        md(
            "# VoxIndica — SadTalker T4 spike\n"
            + DISCLAIMER
            + "\n"
            "Goal: one consented photo + one 3–30s WAV → one MP4, with wall time,\n"
            "peak GPU memory and the real failure mode recorded.\n"
            "\n"
            "Engine: [OpenTalker/SadTalker](https://github.com/OpenTalker/SadTalker).\n"
            "This notebook clones the default branch; the commit is printed so the\n"
            "result can be tied to an exact revision."
        ),
        md("## 1. GPU check"),
        code(GPU_CELL),
        md(INPUTS_MD),
        code(INPUT_CELL),
        md(
            "## 2. Install SadTalker\n"
            "SadTalker's requirements pin several older packages. Pip is allowed to\n"
            "resolve against Kaggle's image; if it fails, stop and report the pip error."
        ),
        code(SADTALKER_INSTALL),
        md(
            "### torchvision compatibility\n"
            "`basicsr` (a SadTalker dependency) imports a module that newer\n"
            "torchvision releases removed. This cell applies the standard one-line\n"
            "patch only if the old import is present."
        ),
        code(SADTALKER_COMPAT),
        md("## 3. Download checkpoints"),
        code(SADTALKER_WEIGHTS),
        md(MEASURE_MD),
        code(SADTALKER_RUN),
        md("## 4. Inspect the clip"),
        code(RESULT_CELL),
        md(REPORT_MD),
    ]
    return notebook(cells, "sadtalker")


def build_musetalk() -> dict:
    cells = [
        md(
            "# VoxIndica — MuseTalk T4 spike\n"
            + DISCLAIMER
            + "\n"
            "Goal: measure MuseTalk on a T4 and record whether it is usable for the\n"
            "studio's presenter stage.\n"
            "\n"
            "Engine: [TMElyralab/MuseTalk](https://github.com/TMElyralab/MuseTalk).\n"
            "**Important:** MuseTalk drives a talking-head **video**, not a still\n"
            "photo. This notebook loops the consented photo into a 10s 25fps clip so\n"
            "the pipeline can run. Head motion and realism will be lower than with a\n"
            "real driving clip — record that limitation instead of hiding it."
        ),
        md("## 1. GPU check"),
        code(GPU_CELL),
        md(INPUTS_MD),
        code(INPUT_CELL),
        md(
            "## 2. Install MuseTalk\n"
            "MuseTalk documents Python 3.10. Kaggle may ship a different version; the\n"
            "cell prints the interpreter and keeps the real pip error if resolution fails."
        ),
        code(MUSETALK_INSTALL),
        md("## 3. Download checkpoints"),
        code(MUSETALK_WEIGHTS),
        md(
            "## 4. Build a driving clip from the photo\n"
            "MuseTalk normally dubs an existing talking-head video. Looping the still\n"
            "photo is only a way to exercise the pipeline; motion realism will be low."
        ),
        code(MUSETALK_DRIVING),
        md(
            "## 5. Write the inference config\n"
            "`scripts/inference.py` takes a YAML task file, not direct `--video_path`\n"
            "flags. This cell writes a one-task config pointing at the looped clip and\n"
            "the narration."
        ),
        code(MUSETALK_CONFIG),
        md(MEASURE_MD),
        code(MUSETALK_RUN),
        md("## 6. Inspect the clip"),
        code(RESULT_CELL),
        md(REPORT_MD),
    ]
    return notebook(cells, "musetalk")


def write_notebook(directory: Path, name: str, payload: dict, meta: dict) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    notebook_path = directory / f"{name}.ipynb"
    notebook_path.write_text(
        json.dumps(payload, indent=1, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    (directory / "kernel-metadata.json").write_text(
        json.dumps(meta, indent=2) + "\n", encoding="utf-8"
    )
    print(f"wrote {notebook_path.relative_to(ROOT)}")
    print(f"wrote {(directory / 'kernel-metadata.json').relative_to(ROOT)}")


def main() -> None:
    write_notebook(
        KAGGLE_DIR / "sadtalker_spike",
        "voxindica_sadtalker_spike",
        build_sadtalker(),
        metadata(
            "voxindica-sadtalker-spike",
            "VoxIndica SadTalker Spike",
            "voxindica_sadtalker_spike.ipynb",
            ["avatar", "sadtalker", "talking-head", "voxindica"],
        ),
    )
    write_notebook(
        KAGGLE_DIR / "musetalk_spike",
        "voxindica_musetalk_spike",
        build_musetalk(),
        metadata(
            "voxindica-musetalk-spike",
            "VoxIndica MuseTalk Spike",
            "voxindica_musetalk_spike.ipynb",
            ["avatar", "musetalk", "talking-head", "voxindica"],
        ),
    )


if __name__ == "__main__":
    main()
