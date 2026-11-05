#!/usr/bin/env python3
"""Fast, GPU-free contract test for the shared VoxCPM2 worker core.

Runs with a fake model so it works in CI: it verifies the HTTP contract, auth,
WAV encoding, chunking and the honest error codes — not model quality.

    python scripts/test/worker_smoke.py
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import io
import json
import os
import sys
import tempfile
import threading
import time
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "workers"))

import voxindica_worker_core as core  # noqa: E402

try:
    from fastapi.testclient import TestClient
except ImportError:  # pragma: no cover
    print("fastapi/httpx missing — pip install fastapi pydantic numpy httpx", file=sys.stderr)
    raise SystemExit(2)

TOKEN = "smoke-token"
FAILURES: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"PASS {name}")
        return
    FAILURES.append(name)
    print(f"FAIL {name}{f' :: {detail}' if detail else ''}")


def write_reference() -> str:
    path = os.path.join(tempfile.mkdtemp(), "reference.wav")
    with wave.open(path, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(16000)
        handle.writeframes(np.zeros(48000, dtype="<i2").tobytes())
    return path


def wait_until(predicate, timeout: float = 10.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return True
        time.sleep(0.05)
    return False


class FakeTtsModel:
    sample_rate = 24000


class FakeModel:
    """Mimics the two attributes the worker actually uses from VoxCPM2."""

    tts_model = FakeTtsModel()

    def generate(self, text: str, **kwargs):
        if "reference_wav_path" not in kwargs:
            raise AssertionError("reference_wav_path was not forwarded to the model")
        return (np.random.RandomState(len(text)).rand(24000) - 0.5) * 0.2


class ExplodingModel(FakeModel):
    def generate(self, text: str, **kwargs):
        raise RuntimeError("CUDA out of memory (simulated)")


def main() -> int:
    reference = write_reference()

    client = TestClient(
        core.build_app(model=FakeModel(), token=TOKEN, platform_name="kaggle", default_reference=reference)
    )

    health = client.get("/health").json()
    check("health reports online", health["status"] == "online", str(health))
    check("health reports the real platform", health["platform"] == "kaggle")
    check("health exposes device fields", "gpu_device" in health and "vram_total" in health)
    check("health advertises auth", health["auth_required"] is True)

    check("missing token is rejected", client.post("/clone_voice", json={"text": "x"}).status_code == 401)
    check(
        "wrong token is rejected",
        client.post("/clone_voice", json={"text": "x"}, headers={"Authorization": "Bearer nope"}).status_code
        == 401,
    )
    check(
        "empty text is rejected",
        client.post("/clone_voice", json={"text": ""}, headers={"Authorization": f"Bearer {TOKEN}"}).status_code
        == 422,
    )

    response = client.post(
        "/clone_voice",
        json={"text": "এটি একটি পরীক্ষা। দ্বিতীয় বাক্য।"},
        headers={"Authorization": f"Bearer {TOKEN}"},
    )
    payload = response.json()
    check("clone_voice returns 200", response.status_code == 200, str(payload)[:160])

    raw = base64.b64decode(payload.get("audio_base64", ""))
    check("payload is a RIFF/WAVE file", raw[:4] == b"RIFF" and raw[8:12] == b"WAVE")
    with wave.open(io.BytesIO(raw)) as wav:
        fmt = (wav.getnchannels(), wav.getsampwidth(), wav.getframerate())
    check("audio is 16-bit mono at the model rate", fmt == (1, 2, 24000), str(fmt))
    check("reports duration and chunk count", payload.get("duration_seconds", 0) > 0 and payload.get("chunks") == 1)

    alias = client.post(
        "/synthesize", json={"text": "alias"}, headers={"Authorization": f"Bearer {TOKEN}"}
    )
    check("/synthesize alias works", alias.status_code == 200)

    chunks = core.split_text("This is one sentence for the chunker. " * 60, 800)
    check("long text is chunked under the limit", len(chunks) > 1 and all(len(c) <= 800 for c in chunks))

    exploding = TestClient(
        core.build_app(model=ExplodingModel(), token=TOKEN, platform_name="local", default_reference=reference)
    )
    boom = exploding.post("/clone_voice", json={"text": "x"}, headers={"Authorization": f"Bearer {TOKEN}"})
    check(
        "generation errors surface as HTTP 500 with the real message",
        boom.status_code == 500 and "CUDA out of memory" in str(boom.json().get("detail")),
    )

    unloaded = TestClient(
        core.build_app(model=None, token=TOKEN, platform_name="local", model_error="no voxcpm")
    )
    missing = unloaded.post("/clone_voice", json={"text": "x"}, headers={"Authorization": f"Bearer {TOKEN}"})
    check("missing model is HTTP 503, never synthetic audio", missing.status_code == 503)
    check("missing model reports degraded health", unloaded.get("/health").json()["status"] == "degraded")

    # --- batch webhooks -------------------------------------------------
    received: list[dict] = []
    signature_results: list[bool] = []
    callback_secret = "batch-test-secret-0123456789abcdef"

    class CallbackHandler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
            length = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(length)
            timestamp = self.headers.get("X-VoxIndica-Timestamp", "")
            expected = "sha256=" + hmac.new(
                callback_secret.encode("utf-8"),
                timestamp.encode("utf-8") + b"." + body,
                hashlib.sha256,
            ).hexdigest()
            signature_results.append(
                hmac.compare_digest(expected, self.headers.get("X-VoxIndica-Signature", ""))
            )
            received.append(json.loads(body))
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"ok":true}')

        def log_message(self, *_args) -> None:
            return

    sink = ThreadingHTTPServer(("127.0.0.1", 0), CallbackHandler)
    threading.Thread(target=sink.serve_forever, daemon=True).start()

    batch_client = TestClient(
        core.build_app(
            model=FakeModel(),
            token=TOKEN,
            platform_name="local",
            default_reference=reference,
        )
    )
    batch_headers = {"Authorization": f"Bearer {TOKEN}"}
    batch_payload = {
        "batch_id": "test-batch-0001",
        "items": [
            {"id": "item-1", "text": "প্রথম বাক্য।", "language": "bn-IN"},
            {"id": "item-2", "text": "দ্বিতীয় বাক্য।", "language": "bn-IN"},
        ],
        "callback_url": f"http://127.0.0.1:{sink.server_port}/api/providers/batch/webhook/test-token",
        "callback_secret": callback_secret,
    }

    unauthorized = batch_client.post("/batch", json={**batch_payload, "batch_id": "test-batch-0000"})
    check("batch requires the worker token", unauthorized.status_code == 401)

    invalid_callback = batch_client.post(
        "/batch",
        json={**batch_payload, "batch_id": "test-batch-0002", "callback_url": "ftp://example.com/hook"},
        headers=batch_headers,
    )
    check("batch rejects a non-HTTP callback URL", invalid_callback.status_code == 422)

    accepted = batch_client.post("/batch", json=batch_payload, headers=batch_headers)
    accepted_body = accepted.json()
    check("batch returns 202", accepted.status_code == 202, str(accepted_body))
    check("batch echoes the batch id", accepted_body.get("batch_id") == "test-batch-0001")
    check("batch reports its item count", accepted_body.get("total") == 2)

    delivered = wait_until(
        lambda: any(event.get("event") == "batch.completed" for event in received)
    )
    check("batch callbacks are delivered", delivered, str(received)[:300])
    check(
        "every callback signature is valid",
        bool(signature_results) and all(signature_results),
        str(signature_results),
    )

    snapshot = batch_client.get("/batch/test-batch-0001", headers=batch_headers).json()
    check("batch reaches completed", snapshot.get("status") == "completed", str(snapshot))
    check(
        "batch counts both completed items",
        snapshot.get("completed") == 2 and snapshot.get("failed") == 0,
        str(snapshot),
    )
    check(
        "batch item states are terminal",
        all(item.get("status") == "completed" for item in snapshot.get("items", [])),
        str(snapshot),
    )

    completed_events = [event for event in received if event.get("event") == "item.completed"]
    check("both item.completed callbacks carry audio", len(completed_events) == 2, str(received))
    if completed_events:
        audio = base64.b64decode(completed_events[0].get("audio_base64", ""))
        check(
            "callback audio is a RIFF/WAVE file",
            audio[:4] == b"RIFF" and audio[8:12] == b"WAVE",
        )
        check("callback audio reports the model sample rate", completed_events[0].get("sample_rate") == 24000)

    duplicate = batch_client.post("/batch", json=batch_payload, headers=batch_headers)
    check("a duplicate batch id is rejected", duplicate.status_code == 409)

    missing_batch = unloaded.post("/batch", json=batch_payload, headers=batch_headers)
    check("a worker without a model rejects batch with 503", missing_batch.status_code == 503)

    sink.shutdown()
    sink.server_close()

    print()
    if FAILURES:
        print(f"{len(FAILURES)} check(s) failed: {', '.join(FAILURES)}")
        return 1
    print("all worker contract checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
