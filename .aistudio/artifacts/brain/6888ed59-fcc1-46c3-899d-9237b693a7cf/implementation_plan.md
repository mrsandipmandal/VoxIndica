# VoxIndica Studio — Master Architectural & Implementation Plan

VoxIndica Studio is a production-grade, cross-platform, multilingual AI Voice Studio supporting Text-to-Speech (TTS) and few-shot voice cloning across Bengali (West Bengal accent target), Hindi (Indian accent target), and Indian English. The system features dynamic provider routing (local GPU/CPU, Kaggle, Google Colab), verifiable model capabilities, real-time worker telemetry, and local privacy-first audio asset management.

---

### User Review & Critical Decisions

> [!IMPORTANT]
> The project is currently strictly in **Stage 1 (PLAN ONLY)**. No repository files, configurations, or system settings have been modified. 
> Execution requires explicit, stepwise user approval at each stage gate:
> - **Stage 1 (Current)**: Master Plan Delivery & Review.
> - **Stage 2 (Next Gate)**: Read-Only Repository Audit (requires explicit permission).
> - **Stage 3**: Audit Findings, Diff Proposal, and Phase 1 Implementation Plan.
> - **Stages 4–6**: Phased Implementation, Testing, Verification, and Documentation.

#### Confirmed Architectural Decisions (from Phase 1 Interview):
1. **Desktop Wrapper**: **Tauri (v2)** with a lightweight Rust application shell, native IPC, and Python (FastAPI) managed sidecar. Tauri delivers a minimal memory footprint (<60MB base RAM vs. Electron's ~180MB+), strict system capability isolation, and clean native installer packaging (`.deb`/`.rpm`/`AppImage` on Linux, `.msi`/`.exe` on Windows, `.dmg` on macOS).
2. **Remote Worker Integration**: **Secure reverse tunnel** (Cloudflare Tunnel / ngrok) with cryptographic token-authenticated webhooks and active heartbeats. Workers never require static open ports or long-lived public IP addresses; connection lifecycle and disconnect detection are deterministic.
3. **Data & Artifact Storage**: **Local SQLite database** (`voxindica.db`) with Write-Ahead Logging (WAL) for transactional job and history metadata, paired with structured filesystem directories (`~/.voxindica/audio/{cache,recordings,exports}`) for raw WAV audio artifacts.

---

## 1. Overview & Core Concept

### What It Does
VoxIndica Studio provides voice artists, accessibility developers, and content creators with an open-architecture desktop studio to synthesize speech and clone voices in Indian linguistic contexts. It connects transparently to local hardware (CUDA, Apple Silicon MPS, or CPU fallback) or remote cloud compute instances (free or custom Kaggle and Google Colab GPU runtimes) through a unified API interface.

### Target Personas
1. **Content Creators & Localization Producers**: Producing natural audiobooks, podcasts, and regional video dubs in West Bengal Bengali, Hindi, and Indian English with authentic native inflections.
2. **AI & Speech Researchers**: Benchmarking Indic TTS and voice cloning models across varied compute providers with reproducible latency and quality rubrics.
3. **Privacy-Conscious Individuals**: Running end-to-end voice synthesis on local workstations without exposing voice audio or prompt texts to proprietary third-party cloud APIs.

### Primary Value Proposition
- **Authentic Indic Phonology**: Explicit pronunciation targets designed around West Bengal Bengali (মান্য পশ্চিমবঙ্গীয় উচ্চারণ), Hindi, and Indian English prosody.
- **Provider Agnostic**: Switch seamlessly between a local laptop GPU, an external workstation, a Kaggle notebook, or a Google Colab notebook without changing UI workflow or project structure.
- **Honest Telemetry**: Real-time heartbeats and clear "Worker Disconnected" states. Zero fabricated countdown timers or fake remaining-quota estimates.

---

## 2. User Experience & Visual Design

### Key User Flows

```
[1. Script & Language] ──> [2. Task & Voice Selection] ──> [3. Provider & Routing] ──> [4. Synthesis & Preview]
       │                                │                                │                         │
       ▼                                ▼                                ▼                         ▼
Input text in Bengali,     Choose TTS (Preset) or Voice    Select Local (CUDA/MPS/CPU),     Live waveform generation,
Hindi, or Indian English;  Cloning (Upload/Record 5-15s    Kaggle, or Colab worker; check   playback scrubber, export
auto-script validation     reference audio + consent)      heartbeat & memory quota         WAV/FLAC & history log
```

1. **Text-to-Speech (TTS) Flow**:
   - User writes or pastes text in the editor. The app identifies the script (Bengali/Devanagari/Latin) and validates character coverage against the active model's vocabulary.
   - User picks language & accent (e.g., *Bengali (WB)*, *Hindi (IN)*, *English (IN)*).
   - User selects an available voice preset (e.g., *Arpita (WB Female)*, *Subhash (WB Male)*, *Aarav (Hindi Male)*, *Pooja (Hindi Female)*).
   - User configures speech parameters (Speed: 0.5x–2.0x, Pitch shift, Temperature/Purity).
   - Clicks "Synthesize Audio". Job is dispatched to the chosen provider with live progress indicators (`Queued` $\rightarrow$ `Running` $\rightarrow$ `Completed`).
   - Generated waveform renders with playback scrubber, sample rate details, generation duration, and instant one-click WAV export.

2. **Few-Shot Voice Cloning Flow**:
   - User switches task mode to "Voice Cloning".
   - User uploads or records a clean 5–15 second reference audio sample of the target voice.
   - **Consent Verification Gate**: The user must check a mandatory explicit consent acknowledgement before synthesis is unlocked ("*I confirm I have explicit permission and rights to synthesize this voice*").
   - System performs automated audio sanity checks: SNR (Signal-to-Noise Ratio), silence trimming, sample rate normalization (resampled to 22,050Hz or 24,000Hz), and clipping detection.
   - Synthesize and compare reference voice pitch/timbre against generated output.

3. **Compute Provider & Worker Orchestration Flow**:
   - **Local Mode**: Automatically probes local hardware (NVIDIA CUDA via PyTorch, Apple Metal MPS, or AVX-512 CPU). Shows available VRAM/RAM.
   - **Cloud Worker Mode (Kaggle / Colab)**:
     - User inputs the secure worker tunnel URL (e.g., `https://...trycloudflare.com`) and worker session bearer token.
     - Clicks "Connect Worker". Studio sends a signed ping handshake.
     - Worker card displays connection health: `Online`, `Latency: 48ms`, `Last Heartbeat: 4s ago`, `GPU: Tesla T4 (15.0 GB VRAM)`.
     - If the notebook kernel disconnects or times out, status immediately transitions to `Disconnected (Worker offline)` with instructions to re-run the notebook cell.

### Visual Identity & Theme (Domain: SaaS & Audio Production)
Following the strict **Universal Frontend Design Constitution** and **SaaS & Audio Dashboard** reference:
- **Aesthetic Direction**: High-density, utilitarian audio production workstation. Flat surfaces with 1px structural hairline borders (`border-slate-800`), dark graphite canvas, and crisp high-contrast typography.
- **Color Palette (60-30-10 Rule)**:
  - **60% Dominant Canvas**: Deep slate `#0B0F17` / neutral charcoal `#111827`.
  - **30% Structural Surfaces**: Card surfaces `#161F30`, borders `#1E293B`, subtle dividers `#334155`.
  - **10% Semantic Accent Budget**: Amber-Orange `#F59E0B` (primary studio action / recording focus), Emerald `#10B981` (active worker online / success), Rose `#F43F5E` (error / alert), Sky Blue `#0284C7` (waveform player).
- **Typography**:
  - Display & Headings: `Plus Jakarta Sans` (weights 600, 700) with tight tracking (`tracking-tight`).
  - Interface & Body: `Public Sans` / `Manrope` (weights 400, 500) with generous line heights (`leading-relaxed`).
  - Telemetry & Data: `JetBrains Mono` with `tabular-nums` for sample rates, timestamps, durations, buffer sizes, and latency figures.
- **Zero-Pill Discipline**: Metadata displayed as clean, unboxed text separated by typographic middots (`·`) or slashes (`/`), never floating colored capsule badges.
- **Anti-Slop Restraint**: Zero decorative glowing neon pills, zero fake innovation scoreboards, zero comment headers (`// HEADER`), and zero synthetic countdown timers.

---

## 3. Indic Language & Model Evaluation Plan

### Target Accent & Linguistic Criteria

| Target Combination | Language & Accent Target | Phonological Benchmark Focus | Recommended Candidate Models |
| :--- | :--- | :--- | :--- |
| **Combo 1: Bengali TTS** | Bengali (West Bengal / Kolkata standard) | Nasal vowel retention (চাঁদ, হাঁস), conjunct clarity (ক্ষ, জ্ঞ, ষ্ণ), schwa deletion/retention balance, native intonation contours. | **AI4Bharat Indic-TTS2**, **XTTS-v2 (fine-tuned Bengali)**, **VITS-Bengali** |
| **Combo 2: Bengali Voice Clone** | Bengali (West Bengal accent) | Speaker timbre preservation, characteristic Bengali pitch fluctuation, natural phrasing across clause boundaries. | **XTTS-v2**, **CosyVoice / F5-TTS (multilingual weights)** |
| **Combo 3: Hindi TTS** | Hindi (Standard Indian / Khariboli) | Nuanced aspiration contrast (খ/ক, ঘ/গ, খ/খ়, ph vs f), nuqta accuracy (ज़, फ़, ख़), retroflex vs dental stops (ट vs त, ड vs द). | **AI4Bharat Indic-TTS2**, **MeloTTS-Hindi**, **XTTS-v2** |
| **Combo 4: Hindi Voice Clone** | Hindi (Indian standard) | Voice similarity score > 0.82 (speaker embedding cosine distance), steady vowel length, emotion/cadence retention. | **XTTS-v2**, **F5-TTS** |
| **Combo 5: Indian English TTS** | Indian English (Pan-Indian standard) | Non-rhoticity, retroflex alveolar realization of /t/ and /d/, syllable-timed rhythm without exaggerated caricature. | **MeloTTS-English (Indian accent profile)**, **Piper (en_IN)**, **XTTS-v2** |
| **Combo 6: Indian English Clone**| Indian English | Accent consistency, natural diphthong transitions (/eɪ/, /oʊ/), crisp consonant clusters. | **XTTS-v2**, **CosyVoice** |

### Benchmark Evaluation Rubric & Protocol

```
┌────────────────────────────────────────────────────────────────────────┐
│                        EVALUATION CRITERIA (1–5)                       │
├─────────────────────────┬──────────────────────────────────────────────┤
│ 1. Pronunciation (WER)  │ Phonetic accuracy, stress, conjunct resolution│
│ 2. Naturalness (MOS)    │ Human Mean Opinion Score on 50 blind samples │
│ 3. Speaker Cosine Sim   │ Resemblyzer / WavLM speaker embedding score  │
│ 4. Real-Time Factor     │ RTF = Generation Time / Audio Duration (<0.5)│
│ 5. Memory Footprint     │ Peak VRAM consumption during batch synthesis  │
│ 6. Audio Artifacts      │ Absence of robotic buzzing, clicks, phasing  │
└─────────────────────────┴──────────────────────────────────────────────┘
```

- **Open Weights & Licenses**: Verify Apache-2.0, MIT, or CC-BY-NC-4.0 licenses. Prohibit any model without explicit redistribution and commercial usage terms clearly logged in `models.yaml`.
- **Consent & Ethics Guardrail**: Voice cloning requires a cryptographic hash of reference audio + logged consent verification timestamp. Prohibit spoofing well-known public figures through a built-in blocklist of disallowed speaker embeddings.

---

## 4. Technical Architecture & Component Hierarchy

### System Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                  VOXINDICA STUDIO DESKTOP (TAURI)                                │
│                                                                                                  │
│  ┌────────────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                              REACT + TYPESCRIPT FRONTEND (VITE)                            │  │
│  │                                                                                            │  │
│  │   ┌────────────────────┐   ┌────────────────────┐   ┌─────────────────┐   ┌────────────┐   │  │
│  │   │ Generation Workspace│   │ Model Capability   │   │ Provider Health │   │ Audio Lab  │   │  │
│  │   │ (TTS & Clone Studio│   │ Registry & Router  │   │ & Worker Panel  │   │ & History  │   │  │
│  │   └─────────┬──────────┘   └─────────┬──────────┘   └────────┬────────┘   └──────┬─────┘   │  │
│  │             │                        │                       │                   │         │  │
│  │   ┌─────────▼────────────────────────▼───────────────────────▼───────────────────▼─────┐   │  │
│  │   │                        Studio State Store (Zustand / Context)                      │   │  │
│  │   └──────────────────────────────────────────┬─────────────────────────────────────────┘   │  │
│  │                                              │ Typed HTTP / SSE Fetch                      │  │
│  └──────────────────────────────────────────────┼─────────────────────────────────────────────┘  │
│                                                 │                                                │
│  ┌──────────────────────────────────────────────┼─────────────────────────────────────────────┐  │
│  │ TAURI RUST CORE (src-tauri)                  │ Native Sidecar Manager                      │  │
│  │  - Manages Python FastAPI subprocess         │                                             │  │
│  │  - Monitors CPU, RAM, & OS Signal traps      ▼                                             │  │
│  └──────────────────────────────────────────────┬─────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┼────────────────────────────────────────────────┘
                                                  │
                                                  ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                LOCAL FASTAPI BACKEND (Python Sidecar)                            │
│                                                                                                  │
│   ┌───────────────────┐    ┌─────────────────────┐    ┌──────────────────┐    ┌──────────────┐   │
│   │ API Routes (v1)   │    │ Job Orchestrator    │    │ Audio Processor  │    │ SQLite DB    │   │
│   │ /generate, /models│───▶│ & Queue (SQLite/In) │───▶│ (sox, ffmpeg, lib│───▶│ (voxindica. │   │
│   │ /providers/health │    │ Status / Heartbeat  │    │ rosa, soundfile) │    │  db + WAL)   │   │
│   └─────────┬─────────┘    └──────────┬──────────┘    └──────────────────┘    └──────────────┘   │
│             │                         │                                                          │
│             ▼                         ▼                                                          │
│   ┌───────────────────────────────────────────────────────┐                                      │
│   │               PROVIDER ADAPTER ABSTRACTION            │                                      │
│   │       BaseProvider (generate, check_health, cancel)   │                                      │
│   └─────────┬─────────────────────────┬─────────────────┬─┘                                      │
└─────────────┼─────────────────────────┼─────────────────┼────────────────────────────────────────┘
              │                         │                 │
              ▼                         ▼                 ▼
     ┌──────────────────┐     ┌───────────────────┐     ┌─────────────────────┐
     │  LOCAL INFERENCE │     │  KAGGLE WORKER    │     │  GOOGLE COLAB       │
     │  CUDA / MPS / CPU│     │  (Tunnel Webhook) │     │  (Tunnel Webhook)   │
     │  In-Process Torch│     │  T4/P100 PyTorch  │     │  T4/A100 PyTorch    │
     └──────────────────┘     └───────────────────┘     └─────────────────────┘
```

### Data Storage Strategy
- **SQLite Database** (`voxindica.db`):
  - `jobs`: `(id, prompt_text, language, accent, model_id, provider_id, status, error_message, latency_ms, created_at, finished_at)`
  - `voices`: `(id, name, gender, language, accent, sample_path, is_cloned, consent_verified_at)`
  - `models`: `(id, name, version, tasks, languages, accents, min_vram_mb, provider_compat)`
  - `provider_sessions`: `(id, provider_type, tunnel_url, last_ping_at, status, gpu_info)`
- **Local Audio Storage**: Raw files saved to user data directory (`$HOME/.local/share/voxindica/audio` or OS equivalent) as standard uncompressed 16-bit PCM WAV. SQLite stores relative paths only.

---

## 5. Security Threat Model & Risk Register

Following standard threat modeling (STRIDE / OWASP ML):

| Threat ID | Category | Attack Surface / Vector | Impact | Mitigation Strategy |
| :--- | :--- | :--- | :--- | :--- |
| **SEC-01** | **Tampering / Traversal** | Malicious audio filename or multipart upload payload containing `../../` | Overwriting system files or arbitrary code execution | Sanitize filenames via UUIDv4; strictly parse audio headers using `soundfile`/`wave` rather than raw file extensions. |
| **SEC-02** | **Information Disclosure** | Hardcoded Kaggle/Colab tokens or tunnel auth keys committed to git | Exposure of user cloud quota and environment | Store secrets in OS secure credential store or strictly ephemeral `.env.local`. Never echo auth headers or query parameters in logs. |
| **SEC-03** | **Unauthorized Access** | Local FastAPI server listening on `0.0.0.0` allowing local network access | Remote execution of TTS jobs on host machine | Bind FastAPI strictly to `127.0.0.1` with a dynamically generated per-session bearer token passed from Tauri via IPC. |
| **SEC-04** | **Abuse & Impersonation** | Voice cloning of non-consenting individuals or deepfake generation | Ethical breach, legal liability, reputational harm | Explicit UI consent checkpoint, audio fingerprint hashing, disallowing synthetic speech targeting prominent protected public figures. |
| **SEC-05** | **Denial of Service** | Gigabyte-sized WAV uploads or runaway text generation prompts | Host or worker memory exhaustion / crashing OOM | Maximum input length limit (e.g. 5,000 characters per request), audio upload cap (15MB max, 30s max duration), streaming generation limits. |
| **SEC-06** | **Supply Chain** | Compromised PyPI or NPM packages | Malicious dependency execution | Dependabot locks, pinned hashes (`poetry.lock` or `requirements.txt` with SHA-256), `npm audit` gate in CI. |

---

## 6. Test-Driven Development (TDD) Matrix

Every feature follows strict Red-Green-Refactor:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        TDD VERIFICATION MATRIX                         │
├──────────────────────┬────────────────────────┬────────────────────────┤
│ Test Suite           │ Scope                  │ Execution Environment  │
├──────────────────────┼────────────────────────┼────────────────────────┤
│ Backend Unit Tests   │ Schemas, routing, audio│ pytest, mocked I/O, CI │
│                      │ validation, models     │ (sub-second execution) │
├──────────────────────┼────────────────────────┼────────────────────────┤
│ API Contract Tests   │ FastAPI OpenAPI schema │ Schemathesis / pact, CI│
│                      │ vs. TypeScript client  │                        │
├──────────────────────┼────────────────────────┼────────────────────────┤
│ Frontend Unit & UI   │ React components, state│ Vitest + Testing Lib,  │
│                      │ stores, audio player   │ jsdom, CI              │
├──────────────────────┼────────────────────────┼────────────────────────┤
│ Provider Mock Tests  │ Kaggle/Colab adapters, │ Mock HTTP/SSE server,  │
│                      │ disconnect, timeouts   │ flaky network tests    │
├──────────────────────┼────────────────────────┼────────────────────────┤
│ Desktop Smoke Tests  │ Tauri app launch, IPC  │ GitHub Actions (Linux, │
│                      │ handshake, shutdown    │ Windows, macOS runners)│
├──────────────────────┼────────────────────────┼────────────────────────┤
│ Voice Benchmark Tests│ WER, MOS, and RTF      │ Opt-in GPU integration │
│                      │ regression suite       │ workflow (non-blocking)│
└──────────────────────┴────────────────────────┴────────────────────────┘
```

---

## 7. CI/CD & Cross-Platform Release Strategy

- **GitHub Actions Matrix**:
  - `lint-and-check`: `ruff` + `mypy` for Python; `biome` / `eslint` + `tsc --noEmit` for TypeScript.
  - `test-backend`: `pytest` with 85%+ branch coverage enforcement on core routing and validation logic.
  - `test-frontend`: `vitest` for React feature components and state workflows.
  - `build-desktop`: Matrix across `ubuntu-22.04`, `windows-latest`, and `macos-latest` producing:
    - Linux: `.AppImage` and `.deb`
    - Windows: `.msi` (WiX) and `.exe` (NSIS)
    - macOS: `.dmg` (Universal binary for Apple Silicon & Intel)
- **Release Verification Rule**: No release is published automatically. Every tagged release generates signed SHA-256 checksums and drafts a GitHub Release requiring manual operator verification.

---

## 8. Phased Roadmap with Acceptance Criteria

| Phase | Milestone | Deliverables | Measurable Acceptance Criteria |
| :--- | :--- | :--- | :--- |
| **Phase 0** | **Stage 2: Read-Only Audit** | Non-invasive inspection of existing repo files, package versions, and build scripts. | Complete audit findings report in Bengali with verified file inventory. |
| **Phase 1** | **Core Foundation & Contracts** | FastAPI backend skeleton, OpenAPI schema, TypeScript API client, and SQLite store. | All contract tests passing; zero TypeScript compilation errors; SQLite WAL active. |
| **Phase 2** | **Model Registry & Local Inference** | Model capability registry (`models.yaml`), Indic-TTS2 / MeloTTS adapters, local CPU/CUDA routing. | Synthesis of Bengali, Hindi, and Indian English test sentences produces valid WAV files locally. |
| **Phase 3** | **Cloud Worker Adapters** | Kaggle and Google Colab Jupyter notebooks, Cloudflare tunnel bridge, webhook listener. | Remote worker sends heartbeats; synthesizes audio; recovers gracefully when worker kernel stops. |
| **Phase 4** | **Few-Shot Voice Cloning** | Audio upload validator, consent verification modal, reference audio normalization, XTTS/F5 adapter. | 10s voice clip processed; cloned output generated with speaker cosine similarity > 0.80. |
| **Phase 5** | **Desktop Packaging & Tauri Shell** | Tauri v2 wrapper, sidecar process supervisor, installer packaging for Linux, Windows, macOS. | App installs and launches on clean VM; backend starts and terminates cleanly with GUI window. |
| **Phase 6** | **Benchmarking & Documentation** | Automated benchmark script, complete `PROJECT_MEMORY.md`, `AGENTS.md`, and `ROADMAP.md`. | Verified metrics documented; zero fabricated capabilities. |

---

## 9. Known Technical Uncertainties & Missing Features

1. **Colab / Kaggle Free Tier Session Eviction**: Notebook sessions on free tiers can be terminated without warning by the host platform after idle periods or GPU quota exhaustion.
   *Resolution*: The desktop app must never assume guaranteed remaining time; it relies on 30s heartbeats. If a heartbeat is missed for 90s, the state displays `Worker Disconnected` and halts job submission.
2. **Apple Silicon PyTorch MPS Stability**: Certain complex TTS neural network layers (e.g. customized dilated convolutions or complex STFT operations) may lack complete MPS support in PyTorch.
   *Resolution*: Implement an automated device feature detector that falls back to CPU execution if an unsupported MPS operator is encountered.
3. **Indic Pronunciation Dictionaries**: Complex Bengali conjuncts (যুক্তাক্ষর) and Hindi words without explicit vowel markers can occasionally lead to pronunciation errors.
   *Resolution*: Provide an optional G2P (Grapheme-to-Phoneme) and phoneme override editor in the settings panel for advanced phonetic corrections.

---

## 10. Decisions Requiring Your Approval

Before proceeding to any code or repository modifications, your explicit authorization is required for:
1. **Granting Permission for Stage 2 (Read-Only Repository Audit)** to inspect the current project files, configuration, and dependencies.
2. **Confirming Indic-TTS2 and MeloTTS** as primary baseline models for Bengali and Hindi TTS.
3. **Confirming Cloudflare Tunnel / ngrok** as the standard reverse tunnel utility for the Kaggle/Colab notebooks.
