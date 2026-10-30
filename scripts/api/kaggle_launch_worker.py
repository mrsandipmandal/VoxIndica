#!/usr/bin/env python3
"""Push the VoxIndica worker notebook to Kaggle over HTTP and try to read the tunnel URL.

Absolutely no CLI involved — this is the same multipart call the Kaggle SDK makes.

    export KAGGLE_USERNAME=you KAGGLE_KEY=xxxx
    python scripts/api/kaggle_launch_worker.py push
    python scripts/api/kaggle_launch_worker.py status
    python scripts/api/kaggle_launch_worker.py session       # waits, then prints URL + token

Credentials can also live in ~/.kaggle/kaggle.json.
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid
import zipfile
from pathlib import Path

API = "https://www.kaggle.com/api/v1"
ROOT = Path(__file__).resolve().parents[2]
NOTEBOOK = ROOT / "notebooks" / "kaggle" / "voxindica_worker.ipynb"
METADATA = ROOT / "notebooks" / "kaggle" / "kernel-metadata.json"
SESSION_KEY = "worker_session.json"


def credentials() -> tuple[str, str]:
    username = os.environ.get("KAGGLE_USERNAME")
    key = os.environ.get("KAGGLE_KEY")
    if username and key:
        return username, key
    config = Path(os.environ.get("KAGGLE_CONFIG_DIR", Path.home() / ".kaggle")) / "kaggle.json"
    if config.is_file():
        data = json.loads(config.read_text(encoding="utf-8"))
        if data.get("username") and data.get("key"):
            return data["username"], data["key"]
    raise SystemExit("missing credentials: set KAGGLE_USERNAME/KAGGLE_KEY or create ~/.kaggle/kaggle.json")


def auth_header(username: str, key: str) -> str:
    return "Basic " + base64.b64encode(f"{username}:{key}".encode()).decode()


def slug(username: str) -> str:
    metadata = json.loads(METADATA.read_text(encoding="utf-8"))
    kernel_id = metadata.get("id", f"{username}/voxindica-worker")
    return kernel_id.split("/", 1)[-1]


def multipart(fields: dict[str, str]) -> tuple[bytes, str]:
    boundary = f"----voxindica{uuid.uuid4().hex}"
    chunks: list[bytes] = []
    for name, value in fields.items():
        chunks.append(f"--{boundary}\r\n".encode())
        chunks.append(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode())
        chunks.append(str(value).encode("utf-8"))
        chunks.append(b"\r\n")
    chunks.append(f"--{boundary}--\r\n".encode())
    return b"".join(chunks), f"multipart/form-data; boundary={boundary}"


def call(method: str, path: str, username: str, key: str, body: bytes | None = None, content_type: str | None = None) -> tuple[int, bytes]:
    headers = {"Authorization": auth_header(username, key)}
    if content_type:
        headers["Content-Type"] = content_type
    request = urllib.request.Request(f"{API}{path}", data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=180) as response:  # noqa: S310
            return response.status, response.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read()
    except Exception as exc:  # noqa: BLE001
        return 0, str(exc).encode()


def cmd_push(args: argparse.Namespace) -> int:
    username, key = credentials()
    metadata = json.loads(METADATA.read_text(encoding="utf-8"))
    metadata["id"] = f"{username}/{metadata.get('id', '').split('/', 1)[-1] or 'voxindica-worker'}"
    metadata["code_file"] = NOTEBOOK.name
    if args.dataset:
        metadata["dataset_sources"] = [args.dataset]

    payload, content_type = multipart(
        {
            "metadata": json.dumps(metadata),
            "fileName": NOTEBOOK.name,
            "fileData": NOTEBOOK.read_text(encoding="utf-8"),
        }
    )
    status, body = call("POST", "/kernels/push", username, key, payload, content_type)
    print(f"push -> HTTP {status}")
    print(body.decode("utf-8", "replace")[:2000])
    if status >= 400:
        return 1
    print(f"\nkernel: {metadata['id']}")
    print("open:  https://www.kaggle.com/code/" + metadata["id"])
    return 0


def cmd_status(args: argparse.Namespace) -> int:
    username, key = credentials()
    status, body = call("GET", f"/kernels/status/{username}/{args.slug or slug(username)}", username, key)
    print(f"HTTP {status}: {body.decode('utf-8', 'replace')[:500]}")
    return 0 if status == 200 else 1


def extract_session(archive: bytes) -> dict | None:
    """Find worker_session.json (preferred) or scrape TUNNEL URL / BEARER TOKEN from logs."""
    try:
        zf = zipfile.ZipFile(io.BytesIO(archive))
    except zipfile.BadZipFile:
        return None

    if SESSION_KEY in zf.namelist():
        try:
            return json.loads(zf.read(SESSION_KEY).decode("utf-8"))
        except json.JSONDecodeError:
            pass

    for name in zf.namelist():
        if not name.endswith((".log", ".txt")):
            continue
        text = zf.read(name).decode("utf-8", "replace")
        url = None
        token = None
        for line in text.splitlines():
            if "TUNNEL URL" in line and "https://" in line:
                url = line.split("https://", 1)[1].strip().split()[0]
                url = "https://" + url.rstrip(".,)")
            if "BEARER TOKEN" in line and ":" in line:
                token = line.rsplit(":", 1)[1].strip()
        if url and token:
            return {"url": url, "token": token, "platform": "kaggle", "source": name}
    return None


def cmd_session(args: argparse.Namespace) -> int:
    username, key = credentials()
    kernel_slug = args.slug or slug(username)
    deadline = time.time() + args.timeout

    while time.time() < deadline:
        status_code, body = call("GET", f"/kernels/status/{username}/{kernel_slug}", username, key)
        state = body.decode("utf-8", "replace").strip()
        print(f"[{time.strftime('%H:%M:%S')}] {state}")

        if "COMPLETE" in state or "ERROR" in state:
            print("kernel finished (not running anymore)", file=sys.stderr)
            break

        out_code, archive = call("GET", f"/kernels/output/{username}/{kernel_slug}", username, key)
        if out_code == 200:
            session = extract_session(archive)
            if session:
                print(json.dumps(session, indent=2))
                print("\nPaste these into VoxIndica Studio:")
                print("  TUNNEL URL   :", session.get("url"))
                print("  BEARER TOKEN :", session.get("token"))
                return 0
        else:
            print(f"  output not available yet (HTTP {out_code})")

        time.sleep(args.interval)

    print(
        "\nCould not read the session from the Kaggle API.\n"
        "Kaggle usually exposes output only after a kernel stops, and a worker kernel never stops.\n"
        f"Open https://www.kaggle.com/code/{username}/{kernel_slug} and copy TUNNEL URL / BEARER TOKEN "
        "from the live log into the Studio.",
        file=sys.stderr,
    )
    return 2


def main() -> int:
    parser = argparse.ArgumentParser(description="Kaggle worker launcher (pure HTTP)")
    parser.add_argument("--slug", default=None, help="kernel slug (default: from kernel-metadata.json)")
    sub = parser.add_subparsers(dest="command", required=True)

    push = sub.add_parser("push", help="push a new kernel version and start it")
    push.add_argument("--dataset", default=None, help="dataset source, e.g. mrsandipmandal/sample-file")
    push.set_defaults(func=cmd_push)

    status = sub.add_parser("status", help="print the kernel status")
    status.set_defaults(func=cmd_status)

    session = sub.add_parser("session", help="poll until the worker session is readable")
    session.add_argument("--interval", type=int, default=20)
    session.add_argument("--timeout", type=int, default=900)
    session.set_defaults(func=cmd_session)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
