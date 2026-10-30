#!/usr/bin/env bash
# Create the local VoxCPM2 worker environment for VoxIndica Studio.
# Usage: bash scripts/local/install_local.sh [--cuda cu121]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

VENV_DIR="${VOXINDICA_VENV:-.venv-worker}"
PYTHON_BIN="${PYTHON_BIN:-python3}"
CUDA_TAG=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --cuda)
      CUDA_TAG="${2:-cu121}"
      shift 2
      ;;
    --cuda=*)
      CUDA_TAG="${1#*=}"
      shift
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "python3 not found. Install Python 3.10-3.12 first: https://www.python.org/downloads/" >&2
  exit 1
fi

PY_VERSION="$("$PYTHON_BIN" -c 'import sys;print("%d.%d"%sys.version_info[:2])')"
echo "Using $PYTHON_BIN (Python $PY_VERSION)"

if [[ ! -d "$VENV_DIR" ]]; then
  "$PYTHON_BIN" -m venv "$VENV_DIR"
  echo "Created virtual environment: $VENV_DIR"
fi

# shellcheck disable=SC1091
source "$VENV_DIR/bin/activate"
python -m pip install --upgrade pip >/dev/null

if [[ -n "$CUDA_TAG" ]]; then
  echo "Installing CUDA torch (${CUDA_TAG})..."
  python -m pip install torch torchaudio --index-url "https://download.pytorch.org/whl/${CUDA_TAG}"
fi

echo "Installing worker requirements..."
python -m pip install -r scripts/local/requirements-local.txt

echo
echo "Done. Next:"
echo "  source $VENV_DIR/bin/activate"
echo "  python scripts/local/run_worker.py --port 8000"
echo
echo "Then in VoxIndica Studio: Inference Providers & API -> Local Hardware"
echo "  endpoint: http://127.0.0.1:8000"
echo "  token:    the BEARER TOKEN printed by the worker"
