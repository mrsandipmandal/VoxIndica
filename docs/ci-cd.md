# CI/CD

Two GitHub Actions workflows live in `.github/workflows/`. Nothing external is required — they use the
repository's own `GITHUB_TOKEN`.

## `ci.yml` — every push and pull request

Runs on `main`, `feat/**`, `fix/**`, all pull requests, and can be started manually
(**Actions → CI → Run workflow**).

| Job | What it proves |
|---|---|
| `web` | `npm run lint` (strict `tsc --noEmit`) and `npm run build` (Vite production bundle). Uploads `dist` as an artifact. |
| `worker` | `scripts/test/worker_smoke.py` (worker HTTP contract with a fake model), `compileall` over `workers/` + `scripts/`, and a **drift check**: regenerating the notebooks must produce zero git diff. |

The drift check is the important one: if someone edits `workers/voxindica_worker_core.py` without running
`python workers/build_notebooks.py`, CI fails instead of shipping notebooks that no longer match the worker.

### Run the same checks locally

```bash
npm install --legacy-peer-deps
npm run lint
npm run build
python scripts/test/worker_smoke.py
python workers/build_notebooks.py && git diff --exit-code -- notebooks public src/data
python -m compileall -q workers scripts
```

## `release.yml` — on a version tag

Triggered by pushing a tag such as `v0.2.0` (or manually via workflow dispatch).

1. Type-checks, builds the web app, regenerates the notebooks and runs the worker contract test.
2. Packages three assets into a GitHub Release:
   - `voxindica-web-<version>.zip` — the production `dist/` bundle
   - `voxindica-notebooks-<version>.zip` — `notebooks/` + `docs/`
   - `voxindica-worker-<version>.zip` — worker core, downloadable scripts, local/API helper scripts
   - `SHA256SUMS.txt`
3. Publishes the release with generated notes.

### Cut a release

```bash
git switch main
git pull
git tag -a v0.2.0 -m "VoxIndica 0.2.0 — API-first providers"
git push origin v0.2.0
```

Watch it under **Actions → Release**. If the workflow fails after the tag exists, fix the issue on `main` and
re-run the workflow from the Actions tab — it will reuse the same tag.

### Notes

- `npm install --legacy-peer-deps` is required because the template's React 19 / peer ranges are not all
  resolvable by npm's strict peer resolver. There is intentionally no lockfile in this repo.
- The worker job installs only `fastapi`, `pydantic`, `numpy` and `httpx` — no torch, no model download — so CI
  stays fast. Real VoxCPM2 inference is exercised on Kaggle/Colab or locally, never in CI.
