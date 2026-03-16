//! Local LLM inference using llama-cpp-2 (llama.cpp bindings).
//!
//! Downloads the Llama 3.1 8B Instruct Q5_K_M model on first use,
//! and generates structured clinical notes with GBNF grammar-constrained
//! JSON output. Tokens are streamed to the frontend via events.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::LlamaModel;
use llama_cpp_2::sampling::LlamaSampler;
use tauri::{AppHandle, Emitter, Manager};

const MODEL_FILENAME: &str = "Meta-Llama-3.1-8B-Instruct-Q5_K_M.gguf";
const MODEL_URL: &str = "https://huggingface.co/bartowski/Meta-Llama-3.1-8B-Instruct-GGUF/resolve/main/Meta-Llama-3.1-8B-Instruct-Q5_K_M.gguf";
const MIN_MODEL_SIZE: u64 = 4_000_000_000; // ~4GB minimum for valid model
const CONTEXT_SIZE: u32 = 8192;
const MAX_PROMPT_TOKENS: usize = 6000;
const MAX_GENERATION_TOKENS: usize = 3000;
const BATCH_SIZE: usize = 512;

/// GBNF grammar to force the model to output valid JSON matching LLMNoteOutput.
const GBNF_GRAMMAR: &str = r#"
root          ::= "{" ws title-kv "," ws sections-kv ws "}"
title-kv      ::= "\"title\":" ws string
sections-kv   ::= "\"sections\":" ws "[" ws section ("," ws section)* ws "]"
section       ::= "{" ws "\"title\":" ws string "," ws "\"content\":" ws string ws "}"
string        ::= "\"" ([^"\\] | "\\" .)* "\""
ws            ::= [ \t\n\r]*
"#;

/// Prevents concurrent LLM generation calls.
static IS_GENERATING: AtomicBool = AtomicBool::new(false);

/// Check whether the LLM model file exists locally and is valid.
#[tauri::command]
#[specta::specta]
pub async fn check_llm_model(app: AppHandle) -> Result<bool, String> {
    let model_path = get_model_path(&app)?;

    if !model_path.exists() {
        return Ok(false);
    }

    let metadata = std::fs::metadata(&model_path)
        .map_err(|e| format!("Failed to read model metadata: {e}"))?;
    Ok(metadata.len() > MIN_MODEL_SIZE)
}

/// Download the LLM model from HuggingFace if it doesn't exist locally.
/// Emits `llm-model-download-progress` events with `{ percent: number }`.
#[tauri::command]
#[specta::specta]
pub async fn download_llm_model(app: AppHandle) -> Result<(), String> {
    let model_path = get_model_path(&app)?;

    if model_path.exists() {
        let metadata = std::fs::metadata(&model_path)
            .map_err(|e| format!("Failed to read model metadata: {e}"))?;
        if metadata.len() > MIN_MODEL_SIZE {
            log::info!("LLM model already exists: {}", model_path.display());
            return Ok(());
        }
        log::warn!("LLM model file appears corrupt, re-downloading");
        let _ = std::fs::remove_file(&model_path);
    }

    log::info!("Downloading LLM model from {MODEL_URL}");
    let _ = app.emit(
        "llm-model-download-progress",
        serde_json::json!({ "percent": 0 }),
    );

    let response = reqwest::get(MODEL_URL)
        .await
        .map_err(|e| format!("Failed to download LLM model: {e}"))?;

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
                "llm-model-download-progress",
                serde_json::json!({ "percent": percent }),
            );
        }
    }

    file.flush()
        .await
        .map_err(|e| format!("Failed to flush model file: {e}"))?;

    // Atomic rename prevents corrupt file on crash
    std::fs::rename(&tmp_path, &model_path)
        .map_err(|e| format!("Failed to finalize model file: {e}"))?;

    let _ = app.emit(
        "llm-model-download-progress",
        serde_json::json!({ "percent": 100 }),
    );
    log::info!("LLM model downloaded: {}", model_path.display());

    Ok(())
}

/// Generate a structured clinical note from a system prompt and user content.
///
/// Streams tokens via `llm-chunk` events. Emits `llm-done` on completion
/// or `llm-error` on failure. Uses GBNF grammar to force valid JSON output.
#[tauri::command]
#[specta::specta]
pub async fn generate_note_stream(
    app: AppHandle,
    system_prompt: String,
    user_content: String,
) -> Result<(), String> {
    // Prevent concurrent generation
    if IS_GENERATING.swap(true, Ordering::SeqCst) {
        return Err("already_generating".into());
    }

    let model_path = get_model_path(&app)?;
    if !model_path.exists() {
        IS_GENERATING.store(false, Ordering::SeqCst);
        return Err("LLM model not found — download it first".into());
    }

    let app_clone = app.clone();
    let result = tokio::task::spawn_blocking(move || {
        run_generation(&app_clone, &model_path, &system_prompt, &user_content)
    })
    .await
    .map_err(|e| {
        IS_GENERATING.store(false, Ordering::SeqCst);
        format!("LLM task panicked: {e}")
    })?;

    IS_GENERATING.store(false, Ordering::SeqCst);

    match result {
        Ok(()) => {
            let _ = app.emit("llm-done", ());
            Ok(())
        }
        Err(e) => {
            let _ = app.emit("llm-error", &e);
            Err(e)
        }
    }
}

/// Synchronous LLM generation — runs on a blocking thread.
fn run_generation(
    app: &AppHandle,
    model_path: &std::path::Path,
    system_prompt: &str,
    user_content: &str,
) -> Result<(), String> {
    let backend = LlamaBackend::init().map_err(|e| format!("Failed to init llama backend: {e}"))?;

    // Load model with GPU offload (all layers to Metal/CUDA)
    let model_params = LlamaModelParams::default().with_n_gpu_layers(99);

    let model_path_str = model_path.to_str().ok_or("Model path is not valid UTF-8")?;

    let model = LlamaModel::load_from_file(&backend, model_path_str, &model_params)
        .map_err(|e| format!("Failed to load LLM model: {e}"))?;

    // Create context
    // Flash attention MUST be disabled — whisper-rs and llama-cpp-2 both
    // statically link ggml, causing symbol collisions that crash on the
    // flash-attention mask assertion.
    let ctx_params = LlamaContextParams::default()
        .with_n_ctx(std::num::NonZeroU32::new(CONTEXT_SIZE))
        .with_n_batch(BATCH_SIZE as u32)
        // 0 = LLAMA_FLASH_ATTN_TYPE_DISABLED (llama.h enum value)
        // Must disable flash attention — GGML symbol collision with whisper-rs
        .with_flash_attention_policy(0);

    let mut ctx = model
        .new_context(&backend, ctx_params)
        .map_err(|e| format!("Failed to create LLM context: {e}"))?;

    // Build the Llama 3.1 chat prompt format
    let prompt = format!(
        "<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n\n{system_prompt}<|eot_id|><|start_header_id|>user<|end_header_id|>\n\n{user_content}<|eot_id|><|start_header_id|>assistant<|end_header_id|>\n\n"
    );

    // Tokenize prompt
    let tokens = model
        .str_to_token(&prompt, llama_cpp_2::model::AddBos::Always)
        .map_err(|e| format!("Failed to tokenize prompt: {e}"))?;

    if tokens.len() > MAX_PROMPT_TOKENS {
        return Err(format!(
            "Prompt too long: {} tokens (max {MAX_PROMPT_TOKENS}). Try a shorter transcript.",
            tokens.len()
        ));
    }

    log::info!(
        "LLM generation starting — {} prompt tokens, max {} generation tokens",
        tokens.len(),
        MAX_GENERATION_TOKENS
    );

    // Set up GBNF grammar for structured JSON output
    let grammar = LlamaSampler::grammar(&model, GBNF_GRAMMAR, "root")
        .map_err(|e| format!("Failed to create GBNF grammar: {e}"))?;

    // Build sampler chain: greedy (temp=0) + grammar
    let mut sampler = LlamaSampler::chain_simple([LlamaSampler::greedy(), grammar]);

    // Feed prompt tokens in batches
    let mut batch = LlamaBatch::new(BATCH_SIZE, 1);
    let n_tokens = tokens.len();

    for (i, chunk) in tokens.chunks(BATCH_SIZE).enumerate() {
        batch.clear();
        let offset = i * BATCH_SIZE;
        for (j, &token) in chunk.iter().enumerate() {
            let is_last = offset + j == n_tokens - 1;
            batch
                .add(token, (offset + j) as i32, &[0], is_last)
                .map_err(|e| format!("Failed to add token to batch: {e}"))?;
        }
        ctx.decode(&mut batch)
            .map_err(|e| format!("Failed to decode prompt batch: {e}"))?;
    }

    // Generate tokens one by one
    let mut generated = 0;
    let mut decoder = encoding_rs::UTF_8.new_decoder();

    let eot_id = model
        .str_to_token("<|eot_id|>", llama_cpp_2::model::AddBos::Never)
        .map_err(|e| format!("Failed to get eot token: {e}"))?;
    let eot_token = eot_id.first().copied();

    loop {
        if generated >= MAX_GENERATION_TOKENS {
            log::warn!("Hit max generation tokens ({MAX_GENERATION_TOKENS})");
            break;
        }

        let new_token = sampler.sample(&ctx, batch.n_tokens() - 1);

        // Check for end of generation
        if model.is_eog_token(new_token) {
            log::info!("LLM reached end-of-generation token");
            break;
        }
        if eot_token == Some(new_token) {
            log::info!("LLM reached eot_id token");
            break;
        }

        // Decode token to text using encoding_rs decoder for proper UTF-8 handling
        let token_str = model
            .token_to_piece(new_token, &mut decoder, true, None)
            .unwrap_or_default();

        if !token_str.is_empty() {
            let _ = app.emit("llm-chunk", &token_str);
        }

        // Prepare next batch with just the new token
        batch.clear();
        batch
            .add(new_token, (n_tokens + generated) as i32, &[0], true)
            .map_err(|e| format!("Failed to add generated token: {e}"))?;

        ctx.decode(&mut batch)
            .map_err(|e| format!("Failed to decode generated token: {e}"))?;

        generated += 1;
    }

    log::info!("LLM generation complete — {generated} tokens generated");
    Ok(())
}

/// Get the expected model file path in the app data directory.
fn get_model_path(app: &AppHandle) -> Result<PathBuf, String> {
    let models_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))?
        .join("models");

    std::fs::create_dir_all(&models_dir)
        .map_err(|e| format!("Failed to create models dir: {e}"))?;

    Ok(models_dir.join(MODEL_FILENAME))
}
