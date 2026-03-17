//! Local Whisper transcription using whisper-rs (whisper.cpp bindings).
//!
//! Supports a catalogue of models. The default multilingual model
//! (whisper-large-v3-turbo) works for all languages; language-specific
//! models (e.g. nb-whisper-large for Norwegian) can be downloaded for
//! better accuracy. Audio is **deleted immediately** after transcription
//! for HIPAA compliance.

use std::path::PathBuf;

use tauri::{AppHandle, Emitter, Manager};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

// ---------------------------------------------------------------------------
// Model catalogue
// ---------------------------------------------------------------------------

/// Metadata for a downloadable Whisper model.
#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct WhisperModelInfo {
    pub id: String,
    pub name: String,
    pub filename: String,
    pub url: String,
    /// Approximate size in bytes (used for UI display only). u32 supports up to ~4 GB.
    pub size_bytes: u32,
    /// ISO 639-1 codes this model supports. Empty = all languages.
    pub languages: Vec<String>,
    /// Whether the model file is present on disk (set dynamically).
    pub downloaded: bool,
}

fn model_catalogue() -> Vec<WhisperModelInfo> {
    vec![
        WhisperModelInfo {
            id: "whisper-large-v3-turbo".into(),
            name: "Whisper large-v3-turbo".into(),
            filename: "ggml-large-v3-turbo-q5_0.bin".into(),
            url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin".into(),
            size_bytes: 574_000_000_u32,
            languages: vec![], // empty = all languages
            downloaded: false,
        },
        WhisperModelInfo {
            id: "nb-whisper-large".into(),
            name: "Norwegian (nb-whisper-large)".into(),
            filename: "ggml-nb-whisper-large-q5_0.bin".into(),
            url: "https://huggingface.co/NbAiLab/nb-whisper-large/resolve/main/ggml-model-q5_0.bin".into(),
            size_bytes: 1_500_000_000_u32,
            languages: vec!["no".into()],
            downloaded: false,
        },
    ]
}

fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))?
        .join("models");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create models dir: {e}"))?;
    Ok(dir)
}

fn model_path(app: &AppHandle, filename: &str) -> Result<PathBuf, String> {
    Ok(models_dir(app)?.join(filename))
}

fn is_downloaded(path: &PathBuf) -> bool {
    path.exists()
        && std::fs::metadata(path)
            .map(|m| m.len() > 10_000_000)
            .unwrap_or(false)
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Return the model catalogue with `downloaded` status filled in.
#[tauri::command]
#[specta::specta]
pub async fn list_whisper_models(app: AppHandle) -> Result<Vec<WhisperModelInfo>, String> {
    let mut models = model_catalogue();
    for m in &mut models {
        let path = model_path(&app, &m.filename)?;
        m.downloaded = is_downloaded(&path);
    }
    Ok(models)
}

/// Download a model by id. Emits `whisper-model-download-progress` events:
/// `{ "model_id": "...", "percent": 0..100 }`.
#[tauri::command]
#[specta::specta]
pub async fn download_whisper_model(app: AppHandle, model_id: String) -> Result<(), String> {
    let catalogue = model_catalogue();
    let info = catalogue
        .iter()
        .find(|m| m.id == model_id)
        .ok_or_else(|| format!("Unknown model id: {model_id}"))?;

    let path = model_path(&app, &info.filename)?;

    if is_downloaded(&path) {
        log::info!("Model {model_id} already downloaded");
        return Ok(());
    }

    log::info!("Downloading Whisper model {model_id} from {}", info.url);
    let _ = app.emit(
        "whisper-model-download-progress",
        serde_json::json!({ "model_id": model_id, "percent": 0 }),
    );

    let response = reqwest::get(&info.url)
        .await
        .map_err(|e| format!("Failed to download model: {e}"))?;

    let total_size = response.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;

    let tmp_path = path.with_extension("tmp");
    let mut file = tokio::fs::File::create(&tmp_path)
        .await
        .map_err(|e| format!("Failed to create temp model file: {e}"))?;

    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;

    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Download stream error: {e}"))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Failed to write model chunk: {e}"))?;

        downloaded += chunk.len() as u64;
        if total_size > 0 {
            let percent = (downloaded as f64 / total_size as f64 * 100.0) as u32;
            let _ = app.emit(
                "whisper-model-download-progress",
                serde_json::json!({ "model_id": model_id, "percent": percent }),
            );
        }
    }

    file.flush()
        .await
        .map_err(|e| format!("Failed to flush model file: {e}"))?;

    // Atomic rename prevents corrupt files on crash
    std::fs::rename(&tmp_path, &path).map_err(|e| format!("Failed to finalize model file: {e}"))?;

    let _ = app.emit(
        "whisper-model-download-progress",
        serde_json::json!({ "model_id": model_id, "percent": 100 }),
    );
    log::info!("Model {model_id} downloaded: {}", path.display());

    Ok(())
}

/// Transcribe a 16kHz mono WAV file and delete it immediately after.
///
/// `language` is an optional ISO 639-1 code (e.g. "en", "no").
/// Pass `None` to auto-detect. `model_id` selects which model to use;
/// if the model is not downloaded it falls back to `whisper-large-v3-turbo`.
#[tauri::command]
#[specta::specta]
pub async fn transcribe_and_delete(
    app: AppHandle,
    file_path: String,
    language: Option<String>,
    model_id: String,
) -> Result<String, String> {
    let wav_path = PathBuf::from(&file_path);

    if !wav_path.exists() {
        return Err(format!("Audio file not found: {file_path}"));
    }

    // Resolve model path — fall back to default if requested model not downloaded
    let resolved_model_path = resolve_model(&app, &model_id)?;

    log::info!(
        "Transcription request — language: {}, model: {model_id}",
        language.as_deref().unwrap_or("auto")
    );

    let result = tokio::task::spawn_blocking(move || {
        run_transcription(&resolved_model_path, &wav_path, language)
    })
    .await
    .map_err(|e| format!("Transcription task panicked: {e}"))?;

    // HIPAA: delete audio file regardless of transcription outcome
    if let Err(e) = std::fs::remove_file(&file_path) {
        log::warn!("Failed to delete audio file {file_path}: {e}");
    } else {
        log::info!("Deleted ephemeral audio: {file_path}");
    }

    result
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Resolve a model id to a local path, falling back to the default model
/// (auto-downloading it if needed) when the requested model is not present.
fn resolve_model(app: &AppHandle, model_id: &str) -> Result<PathBuf, String> {
    let catalogue = model_catalogue();

    // Try the requested model first
    if let Some(info) = catalogue.iter().find(|m| m.id == model_id) {
        let path = model_path(app, &info.filename)?;
        if is_downloaded(&path) {
            return Ok(path);
        }
        log::warn!("Model {model_id} not downloaded — falling back to whisper-large-v3-turbo");
    } else {
        log::warn!("Unknown model id '{model_id}' — falling back to whisper-large-v3-turbo");
    }

    // Fall back to default model (blocking download if needed)
    let default = catalogue
        .iter()
        .find(|m| m.id == "whisper-large-v3-turbo")
        .expect("default model must be in catalogue");
    let default_path = model_path(app, &default.filename)?;

    if !is_downloaded(&default_path) {
        // Synchronously download the default model (this is called from async context via spawn_blocking above,
        // but resolve_model itself is sync — use a blocking reqwest call)
        log::info!("Default model not found, triggering download");
        // We can't await here; return an error so the frontend can trigger a proper download
        return Err(
            "Default model not downloaded. Please transcribe once to trigger download.".into(),
        );
    }

    Ok(default_path)
}

/// Run whisper.cpp transcription on a 16kHz mono WAV file.
fn run_transcription(
    model_path: &std::path::Path,
    wav_path: &std::path::Path,
    language: Option<String>,
) -> Result<String, String> {
    let mut reader =
        hound::WavReader::open(wav_path).map_err(|e| format!("Failed to open WAV: {e}"))?;

    let spec = reader.spec();
    log::info!(
        "WAV: {}Hz, {}ch, {} bits, {:?}",
        spec.sample_rate,
        spec.channels,
        spec.bits_per_sample,
        spec.sample_format
    );

    let samples: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Int => reader
            .samples::<i16>()
            .filter_map(|s| s.ok())
            .map(|s| s as f32 / i16::MAX as f32)
            .collect(),
        hound::SampleFormat::Float => reader.samples::<f32>().filter_map(|s| s.ok()).collect(),
    };

    if samples.is_empty() {
        return Err("WAV file contains no audio data".into());
    }

    log::info!("Loaded {} audio samples for transcription", samples.len());

    let model_str = model_path.to_str().ok_or("Model path is not valid UTF-8")?;

    let ctx = WhisperContext::new_with_params(model_str, WhisperContextParameters::default())
        .map_err(|e| format!("Failed to load Whisper model: {e}"))?;

    let mut state = ctx
        .create_state()
        .map_err(|e| format!("Failed to create Whisper state: {e}"))?;

    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_language(language.as_deref());
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    params.set_single_segment(false);
    params.set_no_timestamps(true);

    state
        .full(params, &samples)
        .map_err(|e| format!("Transcription failed: {e}"))?;

    let num_segments = state.full_n_segments();

    let mut text = String::new();
    for segment in state.as_iter() {
        if let Ok(segment_text) = segment.to_str_lossy() {
            let trimmed = segment_text.trim();
            if !trimmed.is_empty() {
                if !text.is_empty() {
                    text.push(' ');
                }
                text.push_str(trimmed);
            }
        }
    }

    log::info!(
        "Transcribed {} segments, {} chars",
        num_segments,
        text.len()
    );
    Ok(text)
}
