#!/usr/bin/env python3
"""Fast, GPU-free contract test for the shared VoxCPM2 worker core.

Runs with a fake model so it works in CI: it verifies the HTTP contract, auth,
WAV encoding, chunking and the honest error codes — not model quality.

    python scripts/test/worker_smoke.py
"""

from __future__ import annotations

import base64
import io
import os
import sys
import tempfile
import wave
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

    print()
    if FAILURES:
        print(f"{len(FAILURES)} check(s) failed: {', '.join(FAILURES)}")
        return 1
    print("all worker contract checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
