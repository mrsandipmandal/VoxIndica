#!/usr/bin/env python3
"""Start (or probe) the VoxIndica worker on this machine.

    python scripts/local/run_worker.py                 # http://127.0.0.1:8000
    python scripts/local/run_worker.py --port 8001
    python scripts/local/run_worker.py --check         # print /health and exit
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKERS_DIR = ROOT / "workers"
if str(WORKERS_DIR) not in sys.path:
    sys.path.insert(0, str(WORKERS_DIR))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="VoxIndica local VoxCPM2 worker")
    parser.add_argument("--host", default="127.0.0.1", help="bind address (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=int(os.environ.get("VOXINDICA_PORT", "8000")))
    parser.add_argument("--token", default=os.environ.get("VOXINDICA_WORKER_TOKEN"), help="fixed bearer token")
    parser.add_argument("--model", default="openbmb/VoxCPM2", help="Hugging Face model id")
    parser.add_argument("--check", action="store_true", help="probe a running worker and exit")
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    try:
        import voxindica_worker_core as core
    except Exception as exc:  # noqa: BLE001
        print(f"cannot import the worker core: {exc}", file=sys.stderr)
        return 1

    if args.check:
        target = f"http://{args.host}:{args.port}"
        report = core.health_probe(target, token=args.token or "")
        print(json.dumps(report, indent=2))
        return 0 if report.get("status") == "online" else 2

    try:
        import voxcpm  # noqa: F401
    except Exception:  # noqa: BLE001
        print(
            "voxcpm is not installed in this interpreter.\n"
            f"  interpreter: {sys.executable}\n"
            "  fix: bash scripts/local/install_local.sh && source .venv-worker/bin/activate",
            file=sys.stderr,
        )
        return 1

    core.serve(
        platform_name="local",
        host=args.host,
        port=args.port,
        token=args.token,
        model_id=args.model,
        tunnel=False,
        block=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
