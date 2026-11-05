# Desktop shell — Tauri v2 (Phase 2)

VoxIndica Studio ships as a Tauri v2 desktop app. The Rust shell owns the window
and process lifecycle; the existing Express server runs beside it as a bundled
Node single-executable-application (SEA) sidecar.

```
Tauri v2 (Rust)
  ├─ picks a free 127.0.0.1 port
  ├─ spawns src-tauri/binaries/voxindica-server-<target-triple>
  │    └─ Express (server.ts) → /api/*, /docs, built SPA in dist/
  └─ opens the window at http://127.0.0.1:<port>
```

Nothing is loaded from the public internet and the server never binds to
`0.0.0.0` in desktop mode. If the sidecar does not answer `/healthz` within 20
seconds, the window shows `public/desktop-error.html`; it never renders a fake
workspace.

## Why Node SEA instead of PyInstaller

The original roadmap line said "package the Python FastAPI sidecar with
PyInstaller". That does not match the shipped architecture:

- `server.ts` (Express) is the application backend for the UI, `/api/tts`,
  `/api/providers/*` and `/api/creator/*`.
- `workers/voxindica_worker_core.py` is a FastAPI inference worker that runs on
  Kaggle, Colab or a local machine. It is not the desktop app server, and
  bundling it would not serve the UI.

The desktop sidecar is therefore a Node SEA built from `server.ts`. A future
"local worker" bundle can still use PyInstaller for the FastAPI worker, but it
is a separate artifact.

## Prerequisites

| Platform | Requirements |
|---|---|
| All | Node.js 22+, Rust stable, `ffmpeg` and `ffprobe` on `PATH` |
| Linux | `libwebkit2gtk-4.1-dev`, `librsvg2-dev`, `libappindicator3-dev`, `patchelf` |
| Windows | WebView2 runtime (bundled with Windows 10/11), MSVC build tools |
| macOS | Xcode command-line tools; Homebrew paths are appended to `PATH` for `ffmpeg` |

## Development

```bash
npm install --legacy-peer-deps
npm run desktop:dev
```

`tauri dev` starts `npm run dev` (Express + Vite middleware on
`http://localhost:3000`) and opens a window pointed at it. The Rust shell does
not spawn the sidecar in debug builds, so HMR keeps working. If `tauri dev`
complains that the external sidecar binary is missing, run
`npm run desktop:sidecar` once first.

## Production build

```bash
npm run desktop:build
```

This runs:

1. `npm run build` — Vite bundle in `dist/`.
2. `npm run desktop:sidecar` — esbuild bundle of `server.ts` plus Node SEA
   injection into `src-tauri/binaries/voxindica-server-<triple>`.
3. `cargo build --release` and the platform bundler.

The sidecar build script also handles macOS ad-hoc signing and the Windows
`signtool remove` step when that tool is available. Release builds are currently
unsigned; code signing is a distribution task, not a Phase 2 requirement.

### Sidecar environment

| Variable | Value |
|---|---|
| `PORT` | random free port chosen by the Rust shell |
| `HOST` | `127.0.0.1` |
| `NODE_ENV` | `production` |
| `VOXINDICA_WEB_DIR` | bundled `dist/` resource |
| `VOXINDICA_DOCS_DIR` | bundled `docs/` resource |
| `VOXINDICA_NOTEBOOKS_DIR` | bundled `notebooks/` resource |
| `VOXINDICA_CREATOR_DATA_DIR` | `<app-data>/projects` |
| `VOXINDICA_BATCH_DATA_DIR` | `<app-data>/batches` |
| `VOXINDICA_ENV_FILE` | `<app-config>/.env` |
| `VOXINDICA_RESOURCE_DIR` | platform resource directory |

User projects live in the platform app-data directory, not next to the
executable. Provider keys stay server-side in `<app-config>/.env` and are never
exposed to the webview. Sidecar output and shell startup errors are appended to
`<app-data>/desktop.log`, which is the first place to look when the startup
error page appears.

Batch inference starts a dedicated loopback callback listener on
`127.0.0.1:3099` (`VOXINDICA_CALLBACK_PORT`). A local worker can call it
directly. A Kaggle/Colab worker cannot: set `VOXINDICA_PUBLIC_URL` in
`<app-config>/.env` to a user-opened tunnel pointing at the callback listener.
The desktop shell does not open a public tunnel automatically, and remote batch
creation returns `503` until that URL exists.

## Verification status

Verified on this Linux host:

- `npm run lint` and `npm run build` pass.
- `npm run desktop:sidecar` builds a 125 MB Linux x86_64 SEA binary.
- The binary runs with production env vars and answers:
  - `GET /healthz` → `200 {"ok":true,...}`
  - `GET /` → the built SPA
  - `GET /api/creator/health` → real storage root and provider configuration
  - `GET /docs/creator/avatar-spike.md` → the bundled guide
  - `GET /desktop-error.html` → the startup-failure page, which points at `<app-data>/desktop.log`

Not verified locally:

- `cargo build` / `tauri build`, including the Rust shell's window creation and
  `<app-data>/desktop.log` logging. This machine has no `webkit2gtk-4.1-dev` or
  `librsvg2-dev`, and `sudo` is unavailable, so the Tauri crates cannot link.
  `npx tauri info` reports both packages as missing.
- Windows and macOS installers.

`.github/workflows/desktop.yml` builds Linux (deb/AppImage), Windows
(NSIS/MSI) and Apple Silicon macOS (DMG) artifacts on GitHub runners. The
artifacts still need a manual install/launch check. Intel macOS is not claimed
because Node's single-executable support is only tested on Apple Silicon.

## Known limitations

- `ffmpeg`/`ffprobe` remain local dependencies; they are not bundled.
- The Node SEA binary is roughly the size of the Node runtime (~125 MB before
  compression). Installer compression reduces the download size.
- No auto-updater or code signing yet.
- Remote batch callbacks require an externally opened tunnel and
  `VOXINDICA_PUBLIC_URL`; the desktop app never exposes itself automatically.
- Linux users still need the WebKitGTK 4.1 runtime provided by their
  distribution.
