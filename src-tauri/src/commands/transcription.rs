//! Local Whisper transcription using whisper-rs (whisper.cpp bindings).
//!
//! Downloads the quantized whisper-large-v3-turbo model on first use,
//! transcribes audio from a 16kHz mono WAV file, and **deletes the
//! audio file immediately** after processing for HIPAA compliance.

use std::path::PathBuf;

use tauri::{AppHandle, Emitter, Manager};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

const MODEL_FILENAME: &str = "ggml-large-v3-turbo-q5_0.bin";
const MODEL_URL: &str =
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin";

/// Transcribe a 16kHz mono WAV file and delete it immediately after.
/// `language` is an optional ISO 639-1 code (e.g. "en", "no", "de").
/// Pass `None` to auto-detect the language from the audio.
/// Returns the transcribed text.
#[tauri::command]
#[specta::specta]
pub async fn transcribe_and_delete(
    app: AppHandle,
    file_path: String,
    language: Option<String>,
) -> Result<String, String> {
    let wav_path = PathBuf::from(&file_path);

    if !wav_path.exists() {
        return Err(format!("Audio file not found: {file_path}"));
    }

    log::info!(
        "Transcription request — language: {}",
        language.as_deref().unwrap_or("auto")
    );

    let model_path = ensure_model(&app).await?;

    // Run transcription on a blocking thread so we don't block the async runtime
    let result =
        tokio::task::spawn_blocking(move || run_transcription(&model_path, &wav_path, language))
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

/// Ensure the Whisper model is downloaded to the app data directory.
/// Emits progress events so the frontend can show a download bar.
async fn ensure_model(app: &AppHandle) -> Result<PathBuf, String> {
    let models_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))?
        .join("models");

    std::fs::create_dir_all(&models_dir)
        .map_err(|e| format!("Failed to create models dir: {e}"))?;

    let model_path = models_dir.join(MODEL_FILENAME);

    if model_path.exists() {
        let metadata = std::fs::metadata(&model_path)
            .map_err(|e| format!("Failed to read model metadata: {e}"))?;
        if metadata.len() > 10_000_000 {
            log::info!("Model already exists: {}", model_path.display());
            return Ok(model_path);
        }
        log::warn!("Model file appears corrupt, re-downloading");
        let _ = std::fs::remove_file(&model_path);
    }

    log::info!("Downloading Whisper model from {MODEL_URL}");
    let _ = app.emit(
        "model-download-progress",
        serde_json::json!({ "percent": 0 }),
    );

    let response = reqwest::get(MODEL_URL)
        .await
        .map_err(|e| format!("Failed to download model: {e}"))?;

    let total_size = response.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;

    let tmp_path = model_path.with_extension("tmp");
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
                "model-download-progress",
                serde_json::json!({ "percent": percent }),
            );
        }
    }

    file.flush()
        .await
        .map_err(|e| format!("Failed to flush model file: {e}"))?;

    // Atomic rename so a crash during download doesn't leave a corrupt file
    std::fs::rename(&tmp_path, &model_path)
        .map_err(|e| format!("Failed to finalize model file: {e}"))?;

    let _ = app.emit(
        "model-download-progress",
        serde_json::json!({ "percent": 100 }),
    );
    log::info!("Model downloaded: {}", model_path.display());

    Ok(model_path)
}

/// Run whisper.cpp transcription on a 16kHz mono WAV file.
/// `language` is an ISO 639-1 code or `None` for auto-detect.
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

    // full_n_segments returns c_int directly
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
