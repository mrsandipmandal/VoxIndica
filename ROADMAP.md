# Project Roadmap — VoxIndica Studio

## Milestones & Completion Criteria

### Phase 1: Core Studio Workstation (Completed)
- [x] Multilingual TTS support for Bengali (West Bengal), Hindi, and Indian English.
- [x] Model capabilities registry with 5 verified Indic speech models.
- [x] Few-shot voice cloning studio with audio recording, validation, and mandatory consent verification.
- [x] Interactive waveform player with real-time seeking, playback speed control, and 16-bit PCM WAV export.
- [x] Dynamic provider orchestration for Local, Kaggle, and Google Colab workers with true ping heartbeats.
- [x] Benchmark matrix covering all 6 combinations with WER, MOS, Similarity, and RTF metrics.

### Phase 2: Tauri Desktop Wrapper Integration
- [ ] Initialize `src-tauri` directory with Tauri v2 Rust shell.
- [ ] Package Python FastAPI sidecar binary with PyInstaller.
- [ ] Test cross-platform builds: `.AppImage` (Linux), `.msi` (Windows), `.dmg` (macOS).

### Phase 3: Live Worker Notebook Bridges
- [x] Release production Jupyter notebooks for Kaggle and Google Colab with automated Cloudflare tunnel spinup.
  - Both notebooks are generated from `workers/voxindica_worker_core.py` via `python workers/build_notebooks.py`.
- [x] API-first provider layer: Kaggle API proxy (`/api/providers/kaggle/{test,launch,poll}`), real `/health` probes, and `WORKER_TIMEOUT_MS`-bounded worker routing for every task.
- [ ] Implement end-to-end webhook callbacks for long-running batch inference.
