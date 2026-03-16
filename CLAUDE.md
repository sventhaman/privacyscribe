# Claude Code Instructions

Read @AGENTS.md for all project instructions.

## Project: PrivacyScribe

**PrivacyScribe** is a HIPAA-compliant desktop app for medical professionals to record patient encounters, transcribe audio locally using Whisper, and auto-generate SOAP notes using a local Llama LLM. All AI processing happens on-device — no data leaves the machine.

- **App identifier:** `org.privacyscribe.app`
- **Stack:** Tauri v2 + React 19 + TypeScript + SQLite
- **Platform:** macOS primary (Windows/Linux supported)
- **Domain:** Clinical documentation / medical transcription

## How to Run

```bash
npm install          # Install dependencies
npm run tauri:dev    # Launch dev app with HMR
npm run check:all    # Full quality gate (run before committing)
```

**Never start a dev server yourself** — ask the user to run it and report back.

## Architecture at a Glance

```
src/                    # React frontend
  components/           # UI (64 components — ui/, layout/, notes/, preferences/)
  store/                # Zustand stores (ui, notes, templates)
  lib/                  # tauri-bindings, db, llm-service, commands
  services/             # TanStack Query hooks (preferences)
  i18n/                 # i18next config, en/ar/fr locales

src-tauri/src/          # Rust backend
  commands/             # 17 Tauri commands (audio, transcription, llm, prefs, etc.)
  lib.rs                # Plugin registration, app setup
  bindings.rs           # tauri-specta TypeScript binding export
```

**Key data flow:**

1. User records audio → `start_recording` / `stop_recording` commands
2. Audio transcribed locally → `transcribe_and_delete` (Whisper, deletes audio file immediately)
3. Transcription + template → `generate_note_stream` (Llama 3.1 8B, streams tokens via events)
4. SOAP note saved to SQLite via `useNotesStore`

## Key Files

| File                                      | Purpose                                          |
| ----------------------------------------- | ------------------------------------------------ |
| `src/lib/tauri-bindings.ts`               | Type-safe Rust command wrappers (auto-generated) |
| `src/lib/db.ts`                           | SQLite init, schema, migrations, row types       |
| `src/store/notes-store.ts`                | Notes CRUD + debounced SQLite saves              |
| `src/store/templates-store.ts`            | SOAP template management                         |
| `src/store/ui-store.ts`                   | Sidebar/modal visibility                         |
| `src-tauri/src/commands/llm.rs`           | Local Llama inference with token streaming       |
| `src-tauri/src/commands/transcription.rs` | Whisper transcription + HIPAA audio deletion     |
| `src-tauri/src/commands/audio.rs`         | cpal audio recording → 16kHz WAV                 |
| `src-tauri/src/commands/quick_pane.rs`    | Floating NSPanel window                          |

## Domain-Specific Guides

- [src/CLAUDE.md](src/CLAUDE.md) — Frontend: components, state, styling, i18n
- [src-tauri/CLAUDE.md](src-tauri/CLAUDE.md) — Backend: commands, crates, patterns

## Local Status

@CLAUDE.local.md
