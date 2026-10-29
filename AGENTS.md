# Coding Agent Instructions — VoxIndica Studio

## Repository Conventions
- **Language**: TypeScript (`strict: true`). Standard enums and strong typing.
- **Styling**: Tailwind CSS v4 via `@import "tailwindcss";`. Zero-pill discipline for metadata; unboxed text with typographic separators (`·` or `/`).
- **Audio Standards**: 16-bit PCM WAV (RIFF header), standard sample rate 24,000 Hz or 22,050 Hz.
- **Provider Policy**: Never fabricate session duration countdowns for Kaggle or Colab. Use true heartbeat state (`Online` / `Disconnected`).
- **Security & Ethics**: Mandatory explicit consent gate before voice cloning is triggered. Strict validation of audio duration (3s–30s) and file sizes (<25MB).

## Testing Commands
```bash
# Type check and lint
npm run lint

# Production build check
npm run build
```
