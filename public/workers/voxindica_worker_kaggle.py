# ==============================================================================
# VoxIndica Studio — Kaggle worker (single-cell script)
# ==============================================================================
"""VoxIndica Studio — shared VoxCPM2 worker core.

This module is the single source of truth for every place the worker runs:

  * ``notebooks/kaggle/voxindica_worker.ipynb``  (generated, cloudflared tunnel)
  * ``notebooks/colab/voxindica_worker.ipynb``   (generated, cloudflared tunnel)
  * ``public/workers/voxindica_worker_local.py`` (generated, 127.0.0.1 only)

Regenerate the generated artifacts with::

    python workers/build_notebooks.py

Runtime contract (consumed by ``server.ts`` and ``providerService.ts``):

    GET  /health          -> worker + GPU state (no auth)
    POST /clone_voice     -> few-shot clone / TTS from reference audio (auth)
    POST /synthesize      -> alias of /clone_voice (auth)

Every response is 16-bit mono PCM WAV, base64 encoded. There is deliberately no
synthetic fallback: if the model is unavailable the endpoint returns HTTP 503
with the real error message, so the Studio can show an honest failure instead of
playing fabricated audio.
"""

import base64
import io
import json
import os
import platform as _platform
import re
import secrets
import shutil
import subprocess
import sys
import threading
import time
import wave
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

WORKER_VERSION = "1.0.0"
DEFAULT_MODEL_ID = "openbmb/VoxCPM2"
DEFAULT_SAMPLE_RATE = 24000
DEFAULT_CFG_VALUE = 2.0
DEFAULT_INFERENCE_TIMESTEPS = 8
DEFAULT_PORT = 8000

# Long scripts are synthesized in chunks so a single forward pass cannot OOM.
CHUNK_CHARS = int(os.environ.get("VOXINDICA_CHUNK_CHARS", "800"))
CHUNK_SILENCE_SECONDS = 0.12

MAX_REFERENCE_BYTES = 25 * 1024 * 1024
MIN_REFERENCE_SECONDS = 1.0
MAX_REFERENCE_SECONDS = 60.0

SESSION_FILE = "worker_session.json"
_LOG_LOCK = threading.Lock()


def log(message: str) -> None:
    """Thread-safe print that also flushes (notebooks buffer otherwise)."""
    with _LOG_LOCK:
        print(message, flush=True)


def detect_platform() -> str:
    """Best-effort runtime detection: 'kaggle' | 'colab' | 'local'."""
    if os.environ.get("KAGGLE_KERNEL_RUN_TYPE") or os.environ.get("KAGGLE_URL_BASE"):
        return "kaggle"
    if Path("/kaggle/working").is_dir():
        return "kaggle"
    if os.environ.get("COLAB_RELEASE_TAG") or os.environ.get("COLAB_GPU"):
        return "colab"
    if "google.colab" in sys.modules or Path("/content").is_dir():
        return "colab"
    return "local"


def gpu_report() -> Dict[str, Any]:
    """Return GPU/VRAM facts without importing torch twice."""
    info: Dict[str, Any] = {
        "gpu_device": "CPU Host",
        "vram_used": 0,
        "vram_total": 0,
        "cuda_available": False,
        "torch_version": None,
    }
    try:
        import torch  # imported lazily: notebooks install it before this runs

        info["torch_version"] = torch.__version__
        if torch.cuda.is_available():
            info["cuda_available"] = True
            info["gpu_device"] = torch.cuda.get_device_name(0)
            props = torch.cuda.get_device_properties(0)
            info["vram_total"] = round(props.total_memory / (1024**2))
            info["vram_used"] = round(torch.cuda.memory_allocated(0) / (1024**2))
    except Exception as exc:  # pragma: no cover - depends on host
        info["gpu_device"] = f"CPU Host ({type(exc).__name__})"
    return info


def pick_device() -> str:
    try:
        import torch

        return "cuda" if torch.cuda.is_available() else "cpu"
    except Exception:
        return "cpu"


def model_sample_rate(model: Any) -> int:
    """VoxCPM2 exposes the rate on ``model.tts_model.sample_rate``."""
    for owner in (getattr(model, "tts_model", None), getattr(model, "model", None), model):
        if owner is None:
            continue
        rate = getattr(owner, "sample_rate", None)
        if rate:
            try:
                return int(rate)
            except (TypeError, ValueError):
                continue
    return DEFAULT_SAMPLE_RATE


def load_model(
    model_id: str = DEFAULT_MODEL_ID,
    device: Optional[str] = None,
    load_denoiser: bool = False,
) -> Tuple[Any, Dict[str, Any]]:
    """Load VoxCPM2 and return ``(model, metadata)``.

    Raises if the package or weights are unavailable; callers surface the real
    error instead of degrading to synthetic audio.
    """
    from voxcpm import VoxCPM  # type: ignore

    target_device = device or pick_device()
    log(f"[voxindica] loading {model_id} on {target_device} (denoiser={load_denoiser})...")
    started = time.time()
    model = VoxCPM.from_pretrained(model_id, load_denoiser=load_denoiser, device=target_device)
    meta = {
        "model_id": model_id,
        "device": target_device,
        "load_seconds": round(time.time() - started, 1),
        "sample_rate": model_sample_rate(model),
    }
    log(f"[voxindica] model ready in {meta['load_seconds']}s · sample_rate={meta['sample_rate']} Hz")
    return model, meta


_SENTENCE_BOUNDARY = re.compile(r"(?<=[.!?।॥])\s+|\n{2,}")


def split_text(text: str, max_chars: int = CHUNK_CHARS) -> List[str]:
    """Split long scripts on sentence/paragraph boundaries, never mid-sentence."""
    cleaned = re.sub(r"[ \t]+", " ", text).strip()
    if not cleaned:
        return []
    if len(cleaned) <= max_chars:
        return [cleaned]

    pieces = [p.strip() for p in _SENTENCE_BOUNDARY.split(cleaned) if p and p.strip()]
    chunks: List[str] = []
    current = ""
    for piece in pieces:
        if not current:
            current = piece
        elif len(current) + 1 + len(piece) <= max_chars:
            current = f"{current} {piece}"
        else:
            chunks.append(current)
            current = piece
        while len(current) > max_chars:  # single runaway sentence
            chunks.append(current[:max_chars])
            current = current[max_chars:]
    if current:
        chunks.append(current)
    return chunks


def _to_numpy(audio: Any) -> "Any":
    import numpy as np

    if hasattr(audio, "detach"):
        audio = audio.detach().float().cpu().numpy()
    arr = np.asarray(audio)
    if arr.ndim > 1:
        arr = arr.mean(axis=-1)
    return np.asarray(arr, dtype="float32").squeeze()


def synth_samples(
    model: Any,
    text: str,
    reference_wav_path: Optional[str],
    prompt_text: str = "",
    cfg_value: float = DEFAULT_CFG_VALUE,
    inference_timesteps: int = DEFAULT_INFERENCE_TIMESTEPS,
) -> Tuple["Any", int, int]:
    """Generate float32 samples for ``text``, chunking when needed."""
    import numpy as np

    sample_rate = model_sample_rate(model)
    chunks = split_text(text)
    if not chunks:
        raise ValueError("Text is required")

    kwargs: Dict[str, Any] = {
        "cfg_value": float(cfg_value),
        "inference_timesteps": int(inference_timesteps),
    }
    if reference_wav_path:
        kwargs["reference_wav_path"] = reference_wav_path
    if prompt_text:
        kwargs["prompt_text"] = prompt_text

    parts: List["Any"] = []
    gap = np.zeros(int(sample_rate * CHUNK_SILENCE_SECONDS), dtype="float32")
    for index, chunk in enumerate(chunks, start=1):
        log(f"[voxindica] generating chunk {index}/{len(chunks)} ({len(chunk)} chars)...")
        out = model.generate(text=chunk, **kwargs)
        parts.append(_to_numpy(out))
        if index != len(chunks):
            parts.append(gap)

    audio = np.concatenate(parts) if len(parts) > 1 else parts[0]
    peak = float(np.max(np.abs(audio))) if audio.size else 0.0
    if peak > 1.0:
        audio = audio / peak * 0.95
    return audio, sample_rate, len(chunks)


def pcm16_wav_bytes(samples: "Any", sample_rate: int) -> bytes:
    """Encode float32 samples as a 16-bit mono PCM RIFF WAV."""
    import numpy as np

    clipped = np.clip(np.asarray(samples, dtype="float32"), -1.0, 1.0)
    pcm = (clipped * 32767.0).astype("<i2")
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(int(sample_rate))
        handle.writeframes(pcm.tobytes())
    return buffer.getvalue()


def decode_reference_audio(payload: str, destination: Path) -> str:
    """Decode a data-URL/base64 reference clip to a mono 16-bit WAV on disk."""
    import numpy as np

    raw = payload.split(",", 1)[-1].strip()
    if not raw:
        raise ValueError("reference_audio is empty")
    try:
        blob = base64.b64decode(raw, validate=False)
    except Exception as exc:
        raise ValueError(f"reference_audio is not valid base64: {exc}") from exc
    if len(blob) > MAX_REFERENCE_BYTES:
        raise ValueError(f"reference audio exceeds {MAX_REFERENCE_BYTES // (1024 * 1024)} MB")
    if len(blob) < 44:
        raise ValueError("reference audio is too small to be a WAV file")
    if blob[:4] != b"RIFF" or blob[8:12] != b"WAVE":
        raise ValueError("reference audio must be a RIFF/WAVE file (16-bit PCM)")

    import soundfile as sf

    data, rate = sf.read(io.BytesIO(blob), dtype="float32", always_2d=False)
    if getattr(data, "ndim", 1) > 1:
        data = np.mean(data, axis=1)
    duration = len(data) / float(rate)
    if duration < MIN_REFERENCE_SECONDS:
        raise ValueError(f"reference audio is {duration:.2f}s, minimum is {MIN_REFERENCE_SECONDS:.0f}s")
    if duration > MAX_REFERENCE_SECONDS:
        raise ValueError(f"reference audio is {duration:.2f}s, maximum is {MAX_REFERENCE_SECONDS:.0f}s")

    destination.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(destination), data, int(rate), subtype="PCM_16")
    return str(destination)


def _cloudflared_binary() -> Path:
    """Locate or download cloudflared for the current OS/arch."""
    local = Path("cloudflared-linux-amd64")
    if local.exists():
        return local
    if shutil.which("cloudflared"):
        return Path(shutil.which("cloudflared") or "cloudflared")

    system = _platform.system().lower()
    machine = _platform.machine().lower()
    if system == "linux":
        asset = "cloudflared-linux-arm64" if machine in ("aarch64", "arm64") else "cloudflared-linux-amd64"
    elif system == "darwin":
        asset = "cloudflared-darwin-arm64.tgz" if machine in ("arm64",) else "cloudflared-darwin-amd64.tgz"
    else:
        asset = "cloudflared-windows-amd64.exe"

    import urllib.request

    url = f"https://github.com/cloudflare/cloudflared/releases/latest/download/{asset}"
    log(f"[voxindica] downloading cloudflared ({asset})...")
    target = local if system == "linux" else Path(asset)
    urllib.request.urlretrieve(url, target)  # noqa: S310 - fixed GitHub release URL
    target.chmod(0o755)
    return target


def start_tunnel(port: int, wait_seconds: int = 90) -> Tuple[Optional[str], Optional[subprocess.Popen], str]:
    """Start a quick cloudflared tunnel and return its public URL."""
    try:
        binary = _cloudflared_binary()
    except Exception as exc:
        return None, None, f"cloudflared unavailable: {exc}"

    process = subprocess.Popen(  # noqa: S603 - explicit binary path
        [str(binary), "tunnel", "--no-autoupdate", "--url", f"http://127.0.0.1:{port}"],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )

    found: Dict[str, Optional[str]] = {"url": None}
    ready = threading.Event()

    def _pump() -> None:
        assert process.stdout is not None
        for line in iter(process.stdout.readline, ""):
            match = re.search(r"https://[a-z0-9-]+\.trycloudflare\.com", line)
            if match and found["url"] is None:
                found["url"] = match.group(0)
                ready.set()
            elif "ERR" in line or "error" in line.lower():
                log(f"[cloudflared] {line.strip()}")

    threading.Thread(target=_pump, daemon=True).start()
    ready.wait(wait_seconds)
    if not found["url"]:
        return None, process, "cloudflared did not report a trycloudflare.com URL in time"
    return found["url"], process, ""


def write_session(platform: str, url: Optional[str], token: str, extra: Optional[Dict[str, Any]] = None) -> Path:
    """Persist the session so tooling can pick the URL/token up later."""
    payload: Dict[str, Any] = {
        "platform": platform,
        "url": url,
        "token": token,
        "started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "worker_version": WORKER_VERSION,
        **gpu_report(),
    }
    if extra:
        payload.update(extra)
    path = Path(SESSION_FILE)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return path


def build_app(
    model: Any = None,
    token: str = "",
    platform_name: Optional[str] = None,
    default_reference: Optional[str] = None,
    model_error: Optional[str] = None,
    work_dir: Optional[Path] = None,
) -> Any:
    """Create the FastAPI application around an already-loaded model."""
    from fastapi import Depends, FastAPI, Header, HTTPException
    from fastapi.middleware.cors import CORSMiddleware
    from pydantic import BaseModel, Field

    platform_name = platform_name or detect_platform()
    work_dir = work_dir or Path(os.environ.get("VOXINDICA_WORK_DIR", "/tmp"))
    work_dir.mkdir(parents=True, exist_ok=True)
    runtime: Dict[str, Any] = {"model": model, "error": model_error}

    app = FastAPI(title="VoxIndica VoxCPM2 Worker", version=WORKER_VERSION)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["*"],
    )

    def require_token(authorization: Optional[str] = Header(default=None)) -> None:
        if not token:
            return
        presented = (authorization or "").strip()
        expected = f"Bearer {token}"
        if not secrets.compare_digest(presented, expected):
            raise HTTPException(status_code=401, detail="Invalid worker bearer token")

    class SpeechRequest(BaseModel):
        text: str = Field(min_length=1)
        language: str = "bn-IN"
        reference_audio: str = ""
        prompt_text: str = ""
        speed: float = 1.0
        pitch: float = 1.0
        cfg_value: float = DEFAULT_CFG_VALUE
        inference_timesteps: int = DEFAULT_INFERENCE_TIMESTEPS

    @app.get("/")
    def root() -> Dict[str, Any]:
        return {
            "service": "voxindica-worker",
            "version": WORKER_VERSION,
            "platform": platform_name,
            "docs": "/health",
        }

    @app.get("/health")
    def health() -> Dict[str, Any]:
        gpu = gpu_report()
        active = runtime.get("model")
        return {
            "status": "online" if active is not None else "degraded",
            "service": "voxindica-worker",
            "version": WORKER_VERSION,
            "platform": platform_name,
            "model": DEFAULT_MODEL_ID,
            "model_loaded": active is not None,
            "model_error": runtime.get("error"),
            "sample_rate": model_sample_rate(active) if active is not None else None,
            "auth_required": bool(token),
            "timestamp": time.time(),
            **gpu,
        }

    @app.post("/clone_voice")
    @app.post("/synthesize")
    def synthesize(request: SpeechRequest, _: None = Depends(require_token)) -> Dict[str, Any]:
        active = runtime.get("model")
        if active is None:
            raise HTTPException(
                status_code=503,
                detail=f"VoxCPM2 model is not loaded: {runtime.get('error') or 'unknown error'}",
            )

        text = request.text.strip()
        if not text:
            raise HTTPException(status_code=400, detail="Text is required")

        reference_path: Optional[str] = None
        reference_source = "none"
        try:
            if request.reference_audio:
                reference_path = decode_reference_audio(
                    request.reference_audio, work_dir / "voxindica_reference.wav"
                )
                reference_source = "request"
            elif default_reference and Path(default_reference).is_file():
                reference_path = default_reference
                reference_source = "worker_default"
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

        if reference_path is None:
            raise HTTPException(
                status_code=422,
                detail="Voice cloning requires reference audio (3-30s, 16-bit PCM WAV)",
            )

        try:
            started = time.time()
            samples, sample_rate, chunk_count = synth_samples(
                active,
                text,
                reference_path,
                prompt_text=request.prompt_text,
                cfg_value=request.cfg_value,
                inference_timesteps=request.inference_timesteps,
            )
            audio = pcm16_wav_bytes(samples, sample_rate)
        except HTTPException:
            raise
        except Exception as exc:  # noqa: BLE001 - surfaced to the Studio verbatim
            raise HTTPException(status_code=500, detail=f"VoxCPM2 generation failed: {exc}") from exc

        gpu = gpu_report()
        return {
            "status": "success",
            "audio_base64": base64.b64encode(audio).decode("ascii"),
            "sample_rate": sample_rate,
            "duration_seconds": round(len(samples) / float(sample_rate), 2),
            "chunks": chunk_count,
            "reference_source": reference_source,
            "requested_speed": request.speed,
            "requested_pitch": request.pitch,
            "applied_post_processing": [],
            "generation_seconds": round(time.time() - started, 2),
            "model": DEFAULT_MODEL_ID,
            "worker_version": WORKER_VERSION,
            "platform": platform_name,
            "gpu": gpu["gpu_device"],
            "vram_used": gpu["vram_used"],
            "vram_total": gpu["vram_total"],
        }

    return app


def serve(
    platform_name: Optional[str] = None,
    port: int = DEFAULT_PORT,
    host: str = "127.0.0.1",
    token: Optional[str] = None,
    model_id: str = DEFAULT_MODEL_ID,
    tunnel: bool = True,
    reference_wav: Optional[str] = None,
    model: Any = None,
    block: bool = True,
    wait_seconds: int = 90,
    ready_timeout: int = 60,
) -> Dict[str, Any]:
    """Load the model, start uvicorn (+ optional tunnel) and announce the session."""
    platform_name = platform_name or detect_platform()
    token = token or os.environ.get("VOXINDICA_WORKER_TOKEN") or secrets.token_hex(16)
    model_error: Optional[str] = None

    if model is None:
        try:
            model, _meta = load_model(model_id=model_id)
        except Exception as exc:  # noqa: BLE001 - reported through /health
            model_error = f"{type(exc).__name__}: {exc}"
            log(f"[voxindica] model load failed: {model_error}")

    app = build_app(
        model=model,
        token=token,
        platform_name=platform_name,
        default_reference=reference_wav,
        model_error=model_error,
    )

    import uvicorn

    config = uvicorn.Config(app, host=host, port=port, log_level="warning")
    server = uvicorn.Server(config)
    threading.Thread(target=server.run, daemon=True).start()

    deadline = time.time() + ready_timeout
    while time.time() < deadline and not server.started:
        time.sleep(0.2)
    if not server.started:
        log("[voxindica] uvicorn did not report ready; continuing anyway")

    public_url: Optional[str] = None
    tunnel_process: Optional[subprocess.Popen] = None
    tunnel_error = ""
    if tunnel:
        public_url, tunnel_process, tunnel_error = start_tunnel(port, wait_seconds=wait_seconds)

    session_path = write_session(
        platform_name,
        public_url,
        token,
        {
            "model": model_id,
            "model_loaded": model is not None,
            "model_error": model_error,
            "local_url": f"http://{host}:{port}",
            "tunnel_error": tunnel_error,
        },
    )

    log("")
    log("=" * 64)
    log("  VOXINDICA WORKER READY")
    log("=" * 64)
    log(f"  Platform      : {platform_name}")
    log(f"  Local URL     : http://{host}:{port}")
    log(f"  Model         : {model_id} ({'loaded' if model is not None else 'FAILED'})")
    if public_url:
        log(f"  TUNNEL URL    : {public_url}")
    else:
        log(f"  TUNNEL URL    : unavailable ({tunnel_error or 'not requested'})")
    log(f"  BEARER TOKEN  : {token}")
    log(f"  Session file  : {session_path.resolve()}")
    log("=" * 64)
    log("")

    if block:
        try:
            while True:
                time.sleep(3600)
        except KeyboardInterrupt:
            log("[voxindica] shutting down")
            if tunnel_process is not None:
                tunnel_process.terminate()

    return {
        "url": public_url or f"http://{host}:{port}",
        "local_url": f"http://{host}:{port}",
        "token": token,
        "platform": platform_name,
        "model_loaded": model is not None,
        "model_error": model_error,
        "tunnel_error": tunnel_error,
        "session_file": str(session_path),
    }


def health_probe(url: str, token: str = "", timeout: float = 5.0) -> Dict[str, Any]:
    """Probe a running worker; used by ``scripts/local/run_worker.py --check``."""
    import urllib.error
    import urllib.request

    request = urllib.request.Request(url.rstrip("/") + "/health", method="GET")
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        return {"status": "error", "http_status": exc.code, "detail": exc.read().decode("utf-8", "replace")}
    except Exception as exc:  # noqa: BLE001
        return {"status": "offline", "detail": f"{type(exc).__name__}: {exc}"}


if __name__ == "__main__":
    serve(tunnel=os.environ.get("VOXINDICA_TUNNEL", "0") == "1")


def _ensure_packages() -> None:
    import subprocess

    subprocess.run(
        [sys.executable, "-m", "pip", "install", "--no-cache-dir", *["voxcpm==2.0.3", "soundfile", "fastapi", "uvicorn"]],
        check=False,
    )


if __name__ == "__main__":
    _ensure_packages()
    serve(
        platform_name="kaggle",
        port=8000,
        tunnel=True,
        block=False,
    )
