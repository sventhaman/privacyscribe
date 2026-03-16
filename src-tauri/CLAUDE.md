# Backend (Rust/Tauri) — Claude Code Guide

## Directory Structure

```
src-tauri/src/
├── main.rs               # Entry point → tauri_app_lib::run()
├── lib.rs                # Plugin registration, app setup, global shortcuts
├── bindings.rs           # tauri-specta: collect_commands!, TypeScript export
├── types.rs              # AppPreferences, RecoveryError, input validation
├── commands/
│   ├── mod.rs            # Module declarations
│   ├── preferences.rs    # greet, load_preferences, save_preferences
│   ├── audio.rs          # start_recording, stop_recording
│   ├── transcription.rs  # transcribe_and_delete (Whisper)
│   ├── llm.rs            # check_llm_model, download_llm_model, generate_note_stream
│   ├── quick_pane.rs     # show/dismiss/toggle_quick_pane, shortcut management
│   ├── notifications.rs  # send_native_notification
│   └── recovery.rs       # save/load/cleanup_old_recovery_files
└── utils/
    ├── mod.rs
    └── platform.rs       # Cross-platform helpers
```

## All 17 Commands

| Command | Module | Purpose |
|---------|--------|---------|
| `greet` | preferences | Demo |
| `load_preferences` | preferences | Load AppPreferences from disk |
| `save_preferences` | preferences | Atomic write to disk |
| `start_recording` | audio | Start mic capture (cpal, dedicated thread) |
| `stop_recording` | audio | Stop, resample to 16kHz mono WAV, return path |
| `transcribe_and_delete` | transcription | Whisper local transcription; **deletes audio immediately (HIPAA)** |
| `check_llm_model` | llm | Check if Llama 3.1 8B model exists locally |
| `download_llm_model` | llm | Download from HuggingFace, emits `llm-model-download-progress` |
| `generate_note_stream` | llm | Run inference, stream tokens via `llm-chunk`, emit `llm-done` |
| `show_quick_pane` | quick_pane | Show floating panel (NSPanel on macOS) |
| `dismiss_quick_pane` | quick_pane | Hide panel (resignates key window on macOS first) |
| `toggle_quick_pane` | quick_pane | Toggle visibility |
| `get_default_quick_pane_shortcut` | quick_pane | Returns `CommandOrControl+Shift+.` |
| `update_quick_pane_shortcut` | quick_pane | Unregister old, register new global shortcut |
| `send_native_notification` | notifications | Cross-platform system notification |
| `save_emergency_data` | recovery | Atomic JSON write to recovery dir (10MB limit) |
| `load_emergency_data` | recovery | Read JSON from recovery dir |
| `cleanup_old_recovery_files` | recovery | Delete files older than 7 days |

## Adding a New Command

1. **Write the function** in the appropriate `commands/*.rs` file:
   ```rust
   #[tauri::command]
   #[specta::specta]
   pub async fn my_command(app: AppHandle, param: String) -> Result<String, String> {
       Ok(format!("result: {param}"))
   }
   ```

2. **Export from `commands/mod.rs`**:
   ```rust
   pub use my_module::my_command;
   ```

3. **Register in `bindings.rs`** (`collect_commands!` macro):
   ```rust
   collect_commands![
       // ...existing...
       commands::my_command,
   ]
   ```

4. **Regenerate TypeScript bindings**:
   ```bash
   npm run rust:bindings
   ```
   This updates `src/lib/tauri-bindings.ts` automatically (also auto-runs in debug builds).

## Key Crates

| Crate | Purpose |
|-------|---------|
| `tauri` v2 | App framework, window management |
| `tauri-specta` + `specta` | Auto-generate TypeScript bindings for commands |
| `tauri-plugin-sql` (SQLite) | Frontend-accessible SQLite database |
| `tauri-plugin-store` | Key-value persistence |
| `cpal` | Cross-platform audio capture |
| `hound` | WAV file read/write |
| `rubato` | FFT audio resampling (native → 16kHz) |
| `whisper-rs` | Whisper.cpp bindings (Metal GPU on macOS) |
| `llama-cpp-2` | Llama.cpp bindings (Metal/CUDA/CPU fallback) |
| `reqwest` | HTTP streaming for model downloads |
| `tauri-nspanel` (macOS) | Native NSPanel for floating quick pane |

## Important Patterns

### Atomic File Writes (Prevent Corruption)
All file writes use temp-file + rename:
```rust
let tmp = path.with_extension("tmp")
tokio::fs::write(&tmp, &data).await?;
tokio::fs::rename(&tmp, &path).await?;
```

### Blocking Threads for Sync Inference
Whisper and Llama are synchronous — run on a blocking thread:
```rust
tauri::async_runtime::spawn_blocking(move || {
    // whisper / llama inference here
}).await??;
```

### Streaming Tokens via Events
```rust
app.emit("llm-chunk", token_string)?;
// ...
app.emit("llm-done", ())?;
```

### Error Returns
Simple commands: `Result<T, String>`
Typed errors: `Result<T, RecoveryError>` (defined in `types.rs`)

### GGML Symbol Collision
Both `whisper-rs` and `llama-cpp-2` bundle GGML. Flash attention is **disabled** to prevent collisions:
```rust
model_params.set_use_mmap(true);
// flash_attention_policy disabled via env/config
```
Do not re-enable flash attention without testing both simultaneously.

## HIPAA Compliance Notes

- Audio files are **deleted immediately** after transcription (`transcribe_and_delete`)
- No data is transmitted off-device; all AI runs locally
- Recovery files are auto-purged after 7 days
- Model files stored in `app_data_dir/models/` (never in temp)

## Plugin Registration Order (lib.rs)

Plugins must be registered in this order (dependencies matter):
1. Store
2. Single Instance (desktop)
3. Window State (desktop)
4. Updater (desktop)
5. Process, Notification, Log
6. NSPanel (macOS)
7. SQL, FS, Dialog, Clipboard, Opener, OS
8. Global Shortcut (initialized without pre-registered shortcuts)

## Rust Toolchain

- Channel: **stable**
- MSRV: **1.82**
- Edition: **2021**
- Always use modern string formatting: `format!("{variable}")` not `format!("{}", variable)`

## Quality Gates

```bash
npm run rust:fmt      # Format
npm run rust:clippy   # Lint (zero warnings — -D warnings)
npm run rust:test     # Tests
npm run check:all     # Full gate including frontend
```
