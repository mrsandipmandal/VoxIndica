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
import hashlib
import hmac
import io
import json
import os
import platform as _platform
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
import urllib.request
import wave
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

WORKER_VERSION = "1.0.6"
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

MAX_BATCH_ITEMS = 32
MAX_BATCH_ITEM_CHARS = 10000
MAX_BATCH_TOTAL_CHARS = 100000
CALLBACK_TIMEOUT_SECONDS = 30
CALLBACK_RETRIES = 3
SUPPORTED_LANGUAGES = {"bn-IN", "hi-IN", "en-IN"}
BATCH_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$")

SESSION_FILE = "worker_session.json"
_LOG_LOCK = threading.Lock()
# A single loaded model is shared by single and batch requests. Serialize calls
# into the model so a batch thread cannot race an interactive synthesis.
_MODEL_LOCK = threading.Lock()

# cloudflared is a child of this process; POST /shutdown needs a handle to it so
# the tunnel closes before the interpreter exits. Left running, the tunnel (and
# therefore a reachable-looking URL) would outlive the kernel.
_ACTIVE_TUNNEL: Optional["subprocess.Popen[Any]"] = None
_SHUTDOWN_GRACE_SECONDS = 1.2


def log(message: str) -> None:
    """Thread-safe print that also flushes (notebooks buffer otherwise)."""
    with _LOG_LOCK:
        print(message, flush=True)


def _exit_process(code: int = 0) -> None:
    """Hard-exit seam, kept separate so tests can stub it."""
    os._exit(code)


def _shutdown_worker(tunnel_process: Optional["subprocess.Popen[Any]"], grace: float) -> None:
    """Close the tunnel, then exit the interpreter.

    The short sleep lets the HTTP response travel back through the tunnel before
    the tunnel is torn down. cloudflared must not outlive this process: a live
    quick tunnel would otherwise keep pointing at a dead worker.
    """
    time.sleep(grace)
    if tunnel_process is not None and tunnel_process.poll() is None:
        try:
            tunnel_process.terminate()
            tunnel_process.wait(timeout=5)
        except Exception:  # noqa: BLE001 - best effort on the way out
            pass
    log("[voxindica] worker stopped by the Studio")
    _exit_process(0)


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
        log(
            f"[voxindica] reference audio is {duration:.2f}s; "
            f"using the first {MAX_REFERENCE_SECONDS:.0f}s"
        )
        data = data[: int(MAX_REFERENCE_SECONDS * rate)]
        duration = len(data) / float(rate)

    destination.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(destination), data, int(rate), subtype="PCM_16")
    return str(destination)


CLOUDFLARED_ENV = "CLOUDFLARED_BIN"
CLOUDFLARED_MIN_BYTES = 1_000_000


def _writable_workdir() -> Path:
    """Return a writable directory for downloaded binaries.

    Notebook kernels sometimes run cells from a directory that is not the one
    that was current when the download happened, so binaries are cached in a
    stable, writable location instead of a bare relative name.
    """
    candidates = [Path.cwd()]
    for fixed in ("/kaggle/working", "/content"):
        if Path(fixed).is_dir():
            candidates.append(Path(fixed))
    candidates.append(Path(tempfile.gettempdir()))

    for candidate in candidates:
        try:
            candidate.mkdir(parents=True, exist_ok=True)
            probe = candidate / f".voxindica-write-{os.getpid()}"
            probe.write_text("ok", encoding="utf-8")
            probe.unlink()
            return candidate
        except OSError:
            continue
    return Path(tempfile.gettempdir())


def _cloudflared_binary() -> Path:
    """Locate or download cloudflared and return an absolute path.

    ``subprocess.Popen`` resolves commands *without a slash* through ``PATH``,
    never through the current directory. Returning ``Path("cloudflared-linux-amd64")``
    therefore made Kaggle fail with ``FileNotFoundError: [Errno 2] No such file
    or directory: 'cloudflared-linux-amd64'`` even though the download succeeded.
    """
    override = os.environ.get(CLOUDFLARED_ENV, "").strip()
    if override:
        path = Path(override).expanduser()
        if not path.is_file():
            raise RuntimeError(f"{CLOUDFLARED_ENV} points at a missing file: {path}")
        path.chmod(0o755)
        return path.resolve()

    system = _platform.system().lower()
    machine = _platform.machine().lower()
    if system == "linux":
        asset = "cloudflared-linux-arm64" if machine in ("aarch64", "arm64") else "cloudflared-linux-amd64"
    elif system == "darwin":
        asset = "cloudflared-darwin-arm64.tgz" if machine in ("arm64", "aarch64") else "cloudflared-darwin-amd64.tgz"
    else:
        asset = "cloudflared-windows-amd64.exe"

    workdir = _writable_workdir()
    filename = "cloudflared" if asset.endswith(".tgz") else asset
    target = (workdir / filename).resolve()

    if target.is_file() and target.stat().st_size >= CLOUDFLARED_MIN_BYTES:
        target.chmod(0o755)
        return target

    system_binary = shutil.which("cloudflared")
    if system_binary:
        return Path(system_binary).resolve()

    import urllib.request

    url = f"https://github.com/cloudflare/cloudflared/releases/latest/download/{asset}"
    log(f"[voxindica] downloading cloudflared ({asset}) -> {target}")
    try:
        urllib.request.urlretrieve(url, target)  # noqa: S310 - fixed GitHub release URL
    except Exception as exc:  # noqa: BLE001 - surfaced through the tunnel error
        raise RuntimeError(f"download failed for {url}: {type(exc).__name__}: {exc}") from exc

    if asset.endswith(".tgz"):
        import tarfile

        try:
            with tarfile.open(target, "r:gz") as archive:
                archive.extractall(workdir)
        finally:
            target.unlink(missing_ok=True)
        target = (workdir / "cloudflared").resolve()

    if not target.is_file() or target.stat().st_size < CLOUDFLARED_MIN_BYTES:
        raise RuntimeError(f"{target} is missing or truncated after download")

    if system == "linux":
        with target.open("rb") as handle:
            magic = handle.read(4)
        if magic != b"\x7fELF":
            target.unlink(missing_ok=True)
            raise RuntimeError(
                f"{target} is not a Linux executable (got {magic!r}); GitHub returned an error page"
            )

    target.chmod(0o755)
    return target


def start_tunnel(port: int, wait_seconds: int = 90) -> Tuple[Optional[str], Optional[subprocess.Popen], str]:
    """Start a quick cloudflared tunnel and return its public URL."""
    try:
        binary = _cloudflared_binary()
    except Exception as exc:
        return None, None, f"cloudflared unavailable: {exc}"

    command = [str(binary), "tunnel", "--no-autoupdate", "--url", f"http://127.0.0.1:{port}"]
    log(f"[voxindica] starting tunnel with {binary}")
    try:
        process = subprocess.Popen(  # noqa: S603 - explicit absolute binary path
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
    except OSError as exc:
        # Popen only searches PATH for names without a slash, and we resolved the
        # path above. Surface the real reason instead of killing the kernel cell.
        return None, None, f"could not launch {binary}: {type(exc).__name__}: {exc}"

    found: Dict[str, Optional[str]] = {"url": None}
    tail: List[str] = []
    ready = threading.Event()

    def _pump() -> None:
        assert process.stdout is not None
        for line in iter(process.stdout.readline, ""):
            cleaned = line.strip()
            if cleaned:
                tail.append(cleaned)
                del tail[:-5]
            match = re.search(r"https://[a-z0-9-]+\.trycloudflare\.com", line)
            if match and found["url"] is None:
                found["url"] = match.group(0)
                ready.set()
            elif "ERR" in line or "error" in line.lower():
                log(f"[cloudflared] {cleaned}")

    threading.Thread(target=_pump, daemon=True).start()
    ready.wait(wait_seconds)
    if not found["url"]:
        reason = "cloudflared did not report a trycloudflare.com URL in time"
        exit_code = process.poll()
        if exit_code is not None:
            reason = f"cloudflared exited with code {exit_code} before the tunnel was ready"
        if tail:
            reason = f"{reason}: {tail[-1]}"
        return None, process, reason
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


def _post_batch_callback(callback_url: str, callback_secret: str, payload: Dict[str, Any]) -> bool:
    """POST one signed batch event, retrying only the delivery (not synthesis).

    The Studio verifies ``sha256(timestamp + "." + raw_body)``. The callback URL
    contains a per-job token, so it is never printed here.
    """
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    for attempt in range(1, CALLBACK_RETRIES + 1):
        timestamp = str(int(time.time()))
        signature = hmac.new(
            callback_secret.encode("utf-8"),
            f"{timestamp}.".encode("utf-8") + body,
            hashlib.sha256,
        ).hexdigest()
        request = urllib.request.Request(
            callback_url,
            data=body,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "X-VoxIndica-Timestamp": timestamp,
                "X-VoxIndica-Signature": f"sha256={signature}",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=CALLBACK_TIMEOUT_SECONDS) as response:
                response.read()
                if 200 <= response.status < 300:
                    return True
                log(
                    f"[batch] callback {payload.get('event')} rejected with HTTP {response.status} "
                    f"(attempt {attempt}/{CALLBACK_RETRIES})"
                )
        except Exception as exc:  # noqa: BLE001 - delivery is best effort, job state stays queryable
            # Do not print the exception text: URLError can include the callback
            # URL, whose path contains the per-job token.
            log(
                f"[batch] callback {payload.get('event')} failed: "
                f"{type(exc).__name__} (attempt {attempt}/{CALLBACK_RETRIES})"
            )
        if attempt < CALLBACK_RETRIES:
            time.sleep(min(2 ** (attempt - 1), 4))
    return False


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

    class BatchItemRequest(BaseModel):
        id: str = Field(min_length=1, max_length=80)
        text: str = Field(min_length=1, max_length=MAX_BATCH_ITEM_CHARS)
        language: str = "bn-IN"

    class BatchRequest(BaseModel):
        batch_id: str = Field(min_length=8, max_length=80)
        items: List[BatchItemRequest]
        callback_url: str
        callback_secret: str = Field(min_length=32, max_length=200)
        reference_audio: str = ""
        prompt_text: str = ""
        cfg_value: float = DEFAULT_CFG_VALUE
        inference_timesteps: int = DEFAULT_INFERENCE_TIMESTEPS

    batches: Dict[str, Dict[str, Any]] = {}
    batch_state_lock = threading.Lock()

    def batch_snapshot(job: Dict[str, Any]) -> Dict[str, Any]:
        with batch_state_lock:
            return {
                "batch_id": job["batch_id"],
                "status": job["status"],
                "total": job["total"],
                "completed": job["completed"],
                "failed": job["failed"],
                "cancel_requested": job["cancel"].is_set(),
                "created_at": job["created_at"],
                "updated_at": job["updated_at"],
                "worker_version": WORKER_VERSION,
                "items": [
                    {
                        "id": item["id"],
                        "index": item["index"],
                        "status": item["status"],
                        "error": item["error"],
                        "sample_rate": item["sample_rate"],
                        "duration_seconds": item["duration_seconds"],
                    }
                    for item in job["items"]
                ],
            }

    def send_batch_event(job: Dict[str, Any], event: str, **fields: Any) -> None:
        payload: Dict[str, Any] = {
            "event": event,
            "job_id": job["batch_id"],
            "total": job["total"],
            "completed": job["completed"],
            "failed": job["failed"],
            "sent_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        payload.update(fields)
        _post_batch_callback(job["callback_url"], job["callback_secret"], payload)

    def run_batch(job: Dict[str, Any]) -> None:
        active = runtime.get("model")
        if active is None:
            with batch_state_lock:
                job["status"] = "failed"
                job["error"] = (
                    f"VoxCPM2 model is not loaded: {runtime.get('error') or 'unknown error'}"
                )
                job["updated_at"] = time.time()
            send_batch_event(job, "batch.failed", status="failed", error=job["error"])
            return

        try:
            for item in job["items"]:
                if job["cancel"].is_set():
                    break
                with batch_state_lock:
                    if job["status"] == "cancelled":
                        break
                    item["status"] = "running"
                    item["started_at"] = time.time()
                    job["status"] = "running"
                    job["updated_at"] = time.time()

                send_batch_event(
                    job,
                    "item.started",
                    item_id=item["id"],
                    index=item["index"],
                    status="running",
                )

                try:
                    started = time.time()
                    # The model is not safe for concurrent generate() calls.
                    with _MODEL_LOCK:
                        samples, sample_rate, chunk_count = synth_samples(
                            active,
                            item["text"],
                            job["reference_path"],
                            prompt_text=job["prompt_text"],
                            cfg_value=job["cfg_value"],
                            inference_timesteps=job["inference_timesteps"],
                        )
                    audio = pcm16_wav_bytes(samples, sample_rate)
                    duration_seconds = round(len(samples) / float(sample_rate), 2)
                    generation_seconds = round(time.time() - started, 2)
                except Exception as exc:  # noqa: BLE001 - one item must not kill the batch
                    error = str(exc)
                    with batch_state_lock:
                        item["status"] = "failed"
                        item["error"] = error
                        item["finished_at"] = time.time()
                        job["failed"] += 1
                        job["updated_at"] = time.time()
                    send_batch_event(
                        job,
                        "item.failed",
                        item_id=item["id"],
                        index=item["index"],
                        status="failed",
                        error=error,
                    )
                    continue

                with batch_state_lock:
                    item["status"] = "completed"
                    item["error"] = None
                    item["sample_rate"] = sample_rate
                    item["duration_seconds"] = duration_seconds
                    item["chunks"] = chunk_count
                    item["generation_seconds"] = generation_seconds
                    item["finished_at"] = time.time()
                    job["completed"] += 1
                    job["updated_at"] = time.time()

                send_batch_event(
                    job,
                    "item.completed",
                    item_id=item["id"],
                    index=item["index"],
                    status="completed",
                    audio_base64=base64.b64encode(audio).decode("ascii"),
                    sample_rate=sample_rate,
                    duration_seconds=duration_seconds,
                    chunks=chunk_count,
                    generation_seconds=generation_seconds,
                )

            with batch_state_lock:
                if job["cancel"].is_set():
                    job["status"] = "cancelled"
                    for item in job["items"]:
                        if item["status"] in ("pending", "running"):
                            item["status"] = "interrupted"
                            item["error"] = "Batch cancelled before this item completed."
                elif job["completed"] == 0 and job["failed"] > 0:
                    job["status"] = "failed"
                    job["error"] = f"All {job['failed']} batch item(s) failed."
                else:
                    job["status"] = "completed"
                job["updated_at"] = time.time()

            event = {
                "cancelled": "batch.cancelled",
                "failed": "batch.failed",
            }.get(job["status"], "batch.completed")
            send_batch_event(
                job,
                event,
                status=job["status"],
                error=job.get("error"),
            )
        except Exception as exc:  # noqa: BLE001 - a crashed batch must still report failure
            with batch_state_lock:
                job["status"] = "failed"
                job["error"] = f"Batch worker failed: {exc}"
                for item in job["items"]:
                    if item["status"] in ("pending", "running"):
                        item["status"] = "interrupted"
                        item["error"] = "Batch stopped before this item completed."
                job["updated_at"] = time.time()
            send_batch_event(
                job,
                "batch.failed",
                status="failed",
                error=job["error"],
            )
        finally:
            if job.get("cleanup_reference"):
                try:
                    Path(job["reference_path"]).unlink(missing_ok=True)
                except Exception:  # noqa: BLE001 - temporary file cleanup is best effort
                    pass

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
            "shutdown_supported": True,
            "timestamp": time.time(),
            **gpu,
        }

    @app.post("/shutdown")
    def shutdown(_: None = Depends(require_token)) -> Dict[str, Any]:
        """Stop this worker (and its tunnel) at the Studio's request."""
        log("[voxindica] shutdown requested by the Studio")
        threading.Thread(
            target=_shutdown_worker,
            args=(_ACTIVE_TUNNEL, _SHUTDOWN_GRACE_SECONDS),
            daemon=True,
        ).start()
        return {
            "status": "shutting_down",
            "worker_version": WORKER_VERSION,
            "message": "Worker is stopping; the tunnel closes in about a second.",
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
            with _MODEL_LOCK:
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

    @app.post("/batch", status_code=202)
    def create_batch(request: BatchRequest, _: None = Depends(require_token)) -> Dict[str, Any]:
        """Accept a long-running batch and deliver results via signed webhooks."""
        active = runtime.get("model")
        if active is None:
            raise HTTPException(
                status_code=503,
                detail=f"VoxCPM2 model is not loaded: {runtime.get('error') or 'unknown error'}",
            )

        batch_id = request.batch_id.strip()
        if not BATCH_ID_PATTERN.fullmatch(batch_id):
            raise HTTPException(
                status_code=422,
                detail="batch_id must be 8-80 characters of letters, digits, '-' or '_'",
            )
        if not request.items:
            raise HTTPException(status_code=422, detail="items must contain at least one entry")
        if len(request.items) > MAX_BATCH_ITEMS:
            raise HTTPException(
                status_code=422,
                detail=f"items must contain at most {MAX_BATCH_ITEMS} entries",
            )

        parsed_callback = urllib.parse.urlparse(request.callback_url.strip())
        if parsed_callback.scheme not in ("http", "https") or not parsed_callback.netloc:
            raise HTTPException(
                status_code=422,
                detail="callback_url must be an absolute http:// or https:// URL",
            )

        normalized: List[Dict[str, Any]] = []
        seen_ids: set[str] = set()
        total_chars = 0
        for index, item in enumerate(request.items):
            item_id = item.id.strip()
            if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,79}", item_id):
                raise HTTPException(
                    status_code=422,
                    detail=f"items[{index}].id must be 1-80 characters of letters, digits, '-' or '_'",
                )
            if item_id in seen_ids:
                raise HTTPException(
                    status_code=422,
                    detail=f"duplicate item id: {item_id}",
                )
            text = item.text.strip()
            if not text:
                raise HTTPException(status_code=422, detail=f"items[{index}].text is empty")
            if len(text) > MAX_BATCH_ITEM_CHARS:
                raise HTTPException(
                    status_code=422,
                    detail=f"items[{index}].text exceeds {MAX_BATCH_ITEM_CHARS} characters",
                )
            if item.language not in SUPPORTED_LANGUAGES:
                raise HTTPException(
                    status_code=422,
                    detail=f"items[{index}].language must be one of {sorted(SUPPORTED_LANGUAGES)}",
                )
            total_chars += len(text)
            if total_chars > MAX_BATCH_TOTAL_CHARS:
                raise HTTPException(
                    status_code=422,
                    detail=f"batch text exceeds {MAX_BATCH_TOTAL_CHARS} characters",
                )
            seen_ids.add(item_id)
            normalized.append(
                {
                    "id": item_id,
                    "index": index,
                    "text": text,
                    "language": item.language,
                }
            )

        with batch_state_lock:
            if batch_id in batches:
                raise HTTPException(status_code=409, detail=f"batch_id {batch_id} already exists")

        reference_path: Optional[str] = None
        cleanup_reference = False
        try:
            if request.reference_audio:
                reference_path = decode_reference_audio(
                    request.reference_audio,
                    work_dir / f"voxindica_batch_{batch_id}.wav",
                )
                cleanup_reference = True
            elif default_reference and Path(default_reference).is_file():
                reference_path = default_reference
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

        if reference_path is None:
            raise HTTPException(
                status_code=422,
                detail="Voice cloning requires reference audio (3-30s, 16-bit PCM WAV)",
            )

        now = time.time()
        job: Dict[str, Any] = {
            "batch_id": batch_id,
            "status": "queued",
            "total": len(normalized),
            "completed": 0,
            "failed": 0,
            "cancel": threading.Event(),
            "items": [
                {
                    **item,
                    "status": "pending",
                    "error": None,
                    "sample_rate": None,
                    "duration_seconds": None,
                    "chunks": None,
                    "generation_seconds": None,
                    "started_at": None,
                    "finished_at": None,
                }
                for item in normalized
            ],
            "callback_url": request.callback_url.strip(),
            "callback_secret": request.callback_secret,
            "reference_path": reference_path,
            "cleanup_reference": cleanup_reference,
            "prompt_text": request.prompt_text,
            "cfg_value": request.cfg_value,
            "inference_timesteps": request.inference_timesteps,
            "created_at": now,
            "updated_at": now,
            "error": None,
        }

        with batch_state_lock:
            if batch_id in batches:
                if cleanup_reference:
                    Path(reference_path).unlink(missing_ok=True)
                raise HTTPException(status_code=409, detail=f"batch_id {batch_id} already exists")
            batches[batch_id] = job

        try:
            threading.Thread(
                target=run_batch,
                args=(job,),
                daemon=True,
                name=f"voxindica-batch-{batch_id}",
            ).start()
        except Exception as exc:  # noqa: BLE001 - report a real thread-start failure
            with batch_state_lock:
                job["status"] = "failed"
                job["error"] = f"Could not start the batch worker: {exc}"
                job["updated_at"] = time.time()
            if cleanup_reference:
                Path(reference_path).unlink(missing_ok=True)
            raise HTTPException(
                status_code=500,
                detail=f"Could not start the batch worker: {exc}",
            ) from exc

        log(f"[batch] accepted {batch_id} with {len(normalized)} item(s)")
        return {
            "status": "accepted",
            "batch_id": batch_id,
            "total": len(normalized),
            "worker_version": WORKER_VERSION,
        }

    @app.get("/batch/{batch_id}")
    def get_batch(batch_id: str, _: None = Depends(require_token)) -> Dict[str, Any]:
        with batch_state_lock:
            job = batches.get(batch_id)
        if job is None:
            raise HTTPException(status_code=404, detail=f"batch {batch_id} not found")
        return batch_snapshot(job)

    @app.post("/batch/{batch_id}/cancel")
    def cancel_batch(batch_id: str, _: None = Depends(require_token)) -> Dict[str, Any]:
        with batch_state_lock:
            job = batches.get(batch_id)
            if job is None:
                raise HTTPException(status_code=404, detail=f"batch {batch_id} not found")
            if job["status"] in ("completed", "failed", "cancelled", "interrupted"):
                return {
                    "status": job["status"],
                    "batch_id": batch_id,
                    "message": "Batch already finished.",
                }
            job["cancel"].set()
            job["updated_at"] = time.time()
        log(f"[batch] cancellation requested for {batch_id}")
        return {"status": "cancelling", "batch_id": batch_id}

    return app


def _keep_announcing_tunnel(url: str, interval: float = 60.0) -> None:
    """Re-print the tunnel URL on a timer.

    A kernel that never finishes only exposes its log through the live session
    stream, and readers can attach late, so a single print at startup is easy to
    miss. Repeating the line keeps the URL discoverable for the whole session.
    """

    def _loop() -> None:
        while True:
            time.sleep(interval)
            log(f"  TUNNEL URL    : {url}")

    threading.Thread(target=_loop, daemon=True).start()


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
    global _ACTIVE_TUNNEL

    platform_name = platform_name or detect_platform()
    token = token or os.environ.get("VOXINDICA_WORKER_TOKEN") or secrets.token_hex(16)
    model_error: Optional[str] = None

    # On a hosted GPU runtime the Studio can only reach the worker through the
    # tunnel, so `tunnel=False` there would produce a session that can never be
    # used. Treat it as required instead of silently starting nothing.
    hosted = platform_name in ("kaggle", "colab")
    if hosted and not tunnel:
        log("[voxindica] hosted GPU runtime: the tunnel is mandatory, starting it anyway")
        tunnel = True

    log(
        f"[voxindica] core {WORKER_VERSION} · platform={platform_name} · "
        f"port={port} · tunnel={'on' if tunnel else 'off'}"
    )

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
        if public_url:
            _keep_announcing_tunnel(public_url)

    _ACTIVE_TUNNEL = tunnel_process

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
            "reachable": bool(public_url) or not hosted,
        },
    )

    log("")
    log("=" * 64)
    log("  VOXINDICA WORKER READY")
    log("=" * 64)
    log(f"  Platform      : {platform_name}")
    log(f"  Core version  : {WORKER_VERSION}")
    log(f"  Local URL     : http://{host}:{port}")
    log(f"  Model         : {model_id} ({'loaded' if model is not None else 'FAILED'})")
    if public_url:
        log(f"  TUNNEL URL    : {public_url}")
    elif tunnel:
        log(f"  TUNNEL URL    : FAILED ({tunnel_error or 'cloudflared did not report a URL'})")
        log("  ERROR: no public URL — VoxIndica Studio cannot reach this worker.")
        log("  Fix  : rerun this cell with Internet enabled, then copy the new URL.")
    else:
        log("  TUNNEL URL    : disabled (local-only worker, reachable at the Local URL)")
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
        # Never report a loopback URL as the tunnel URL: the Studio would call
        # 127.0.0.1 on its own machine and show a bogus "offline".
        "url": public_url or (None if hosted else f"http://{host}:{port}"),
        "local_url": f"http://{host}:{port}",
        "reachable": bool(public_url) or not hosted,
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
