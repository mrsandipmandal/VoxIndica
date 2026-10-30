#!/usr/bin/env python3
"""Hugging Face calls over plain HTTP — no CLI, no kaggle/hf tooling required.

    export HF_TOKEN=hf_xxxxxxxx
    python scripts/api/hf_inference.py whoami
    python scripts/api/hf_inference.py tts --model facebook/mms-tts-ben \
        --text "নমস্কার" --out out.wav
    python scripts/api/hf_inference.py search --query "bengali tts"
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

API_BASE = "https://api-inference.huggingface.co"
HUB_BASE = "https://huggingface.co"
TIMEOUT = 120


def _token(explicit: str | None) -> str:
    token = explicit or os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_API_KEY")
    if not token:
        print("missing token: pass --token or set HF_TOKEN (create one at https://huggingface.co/settings/tokens)", file=sys.stderr)
        raise SystemExit(1)
    return token


def _request(url: str, token: str, data: bytes | None = None, content_type: str | None = None) -> bytes:
    headers = {"Authorization": f"Bearer {token}"}
    if content_type:
        headers["Content-Type"] = content_type
    request = urllib.request.Request(url, data=data, headers=headers, method="POST" if data else "GET")
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:  # noqa: S310 - fixed hosts
            return response.read()
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")
        raise SystemExit(f"HTTP {exc.code} from {url}: {detail}") from exc
    except Exception as exc:  # noqa: BLE001
        raise SystemExit(f"request failed for {url}: {exc}") from exc


def cmd_whoami(args: argparse.Namespace) -> int:
    payload = json.loads(_request(f"{HUB_BASE}/api/whoami-v2", _token(args.token)))
    print(json.dumps(payload, indent=2))
    return 0


def cmd_search(args: argparse.Namespace) -> int:
    query = urllib.parse.urlencode({"search": args.query, "limit": args.limit, "filter": "text-to-speech"})
    payload = json.loads(_request(f"{HUB_BASE}/api/models?{query}", _token(args.token)))
    for item in payload:
        print(f"{item.get('modelId'):<60} downloads={item.get('downloads', 0)}")
    return 0


def cmd_tts(args: argparse.Namespace) -> int:
    body = json.dumps({"inputs": args.text}).encode("utf-8")
    audio = _request(f"{API_BASE}/models/{args.model}", _token(args.token), body, "application/json")
    if audio[:4] != b"RIFF" and args.out.endswith(".wav"):
        preview = audio[:200].decode("utf-8", "replace")
        raise SystemExit(f"model did not return WAV audio (try --out out.bin or another model): {preview}")
    with open(args.out, "wb") as handle:
        handle.write(audio)
    print(f"wrote {len(audio)} bytes to {args.out}")
    print("note: serverless inference may cold-start (503). For VoxCPM2 cloning use a dedicated Inference Endpoint or the worker.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Hugging Face HTTP client (no CLI)")
    parser.add_argument("--token", default=None, help="hf_... token (default: $HF_TOKEN)")
    sub = parser.add_subparsers(dest="command", required=True)

    whoami = sub.add_parser("whoami", help="verify the token")
    whoami.set_defaults(func=cmd_whoami)

    search = sub.add_parser("search", help="list text-to-speech models")
    search.add_argument("--query", required=True)
    search.add_argument("--limit", type=int, default=10)
    search.set_defaults(func=cmd_search)

    tts = sub.add_parser("tts", help="synthesize speech to a file")
    tts.add_argument("--model", required=True)
    tts.add_argument("--text", required=True)
    tts.add_argument("--out", default="out.wav")
    tts.set_defaults(func=cmd_tts)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
