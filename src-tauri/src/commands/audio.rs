//! Native audio recording using cpal + hound.
//!
//! Records microphone input as 16kHz mono WAV — the format Whisper requires.
//! Audio is captured at the device's native rate into memory, then resampled
//! to 16kHz and written to a WAV file on stop.
//!
//! Because cpal::Stream is !Send, all stream operations happen on a dedicated
//! recording thread. The async commands signal this thread via atomics.

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex, OnceLock,
};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use tauri::{AppHandle, Manager};

const TARGET_SAMPLE_RATE: u32 = 16_000;

struct RawAudio {
    samples: Vec<f32>,
    native_sample_rate: u32,
    native_channels: u16,
}

static RAW_AUDIO: OnceLock<Arc<Mutex<RawAudio>>> = OnceLock::new();
static IS_RECORDING: AtomicBool = AtomicBool::new(false);
static STOP_SIGNAL: AtomicBool = AtomicBool::new(false);

fn get_raw_audio() -> &'static Arc<Mutex<RawAudio>> {
    RAW_AUDIO.get_or_init(|| {
        Arc::new(Mutex::new(RawAudio {
            samples: Vec::new(),
            native_sample_rate: 0,
            native_channels: 0,
        }))
    })
}

/// Start recording from the default microphone.
/// Spawns a dedicated thread that creates and owns the cpal::Stream.
#[tauri::command]
#[specta::specta]
pub async fn start_recording() -> Result<(), String> {
    if IS_RECORDING.load(Ordering::SeqCst) {
        return Err("Already recording".into());
    }

    // Pre-check that we have an input device
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or("No input device available")?;
    let config = device
        .default_input_config()
        .map_err(|e| format!("Failed to get input config: {e}"))?;

    let native_rate = config.sample_rate().0;
    let native_channels = config.channels();

    log::info!(
        "Native config: {}Hz, {}ch, {:?}",
        native_rate,
        native_channels,
        config.sample_format()
    );

    // Reset the shared buffer
    {
        let mut raw = get_raw_audio()
            .lock()
            .map_err(|e| format!("Lock poisoned: {e}"))?;
        raw.samples.clear();
        raw.samples.reserve(native_rate as usize * 60);
        raw.native_sample_rate = native_rate;
        raw.native_channels = native_channels;
    }

    let sample_format = config.sample_format();
    STOP_SIGNAL.store(false, Ordering::SeqCst);
    IS_RECORDING.store(true, Ordering::SeqCst);

    // The stream must be created and kept alive on the same thread (it's !Send).
    // We spawn a dedicated thread that creates the stream, records, and waits
    // for the stop signal.
    std::thread::spawn(move || {
        let host = cpal::default_host();
        let device = match host.default_input_device() {
            Some(d) => d,
            None => {
                log::error!("No input device on recording thread");
                IS_RECORDING.store(false, Ordering::SeqCst);
                return;
            }
        };
        let config = match device.default_input_config() {
            Ok(c) => c,
            Err(e) => {
                log::error!("Failed to get input config on recording thread: {e}");
                IS_RECORDING.store(false, Ordering::SeqCst);
                return;
            }
        };

        let buf = get_raw_audio().clone();
        let err_fn = |err: cpal::StreamError| {
            log::error!("Audio stream error: {err}");
        };

        let stream = match sample_format {
            cpal::SampleFormat::F32 => {
                let buf = buf.clone();
                device.build_input_stream(
                    &config.into(),
                    move |data: &[f32], _: &_| {
                        if let Ok(mut raw) = buf.try_lock() {
                            raw.samples.extend_from_slice(data);
                        }
                    },
                    err_fn,
                    None,
                )
            }
            cpal::SampleFormat::I16 => {
                let buf = buf.clone();
                device.build_input_stream(
                    &config.into(),
                    move |data: &[i16], _: &_| {
                        if let Ok(mut raw) = buf.try_lock() {
                            for &s in data {
                                raw.samples.push(s as f32 / i16::MAX as f32);
                            }
                        }
                    },
                    err_fn,
                    None,
                )
            }
            fmt => {
                log::error!("Unsupported sample format: {fmt:?}");
                IS_RECORDING.store(false, Ordering::SeqCst);
                return;
            }
        };

        let stream = match stream {
            Ok(s) => s,
            Err(e) => {
                log::error!("Failed to build input stream: {e}");
                IS_RECORDING.store(false, Ordering::SeqCst);
                return;
            }
        };

        if let Err(e) = stream.play() {
            log::error!("Failed to start stream: {e}");
            IS_RECORDING.store(false, Ordering::SeqCst);
            return;
        }

        log::info!("Recording stream active");

        // Keep stream alive until stop signal
        while !STOP_SIGNAL.load(Ordering::SeqCst) {
            std::thread::sleep(std::time::Duration::from_millis(50));
        }

        drop(stream);
        IS_RECORDING.store(false, Ordering::SeqCst);
        log::info!("Recording stream dropped");
    });

    log::info!("Recording started");
    Ok(())
}

/// Stop recording, resample to 16kHz mono WAV, and return the file path.
#[tauri::command]
#[specta::specta]
pub async fn stop_recording(app: AppHandle) -> Result<String, String> {
    if !IS_RECORDING.load(Ordering::SeqCst) {
        return Err("Not recording".into());
    }

    STOP_SIGNAL.store(true, Ordering::SeqCst);

    // Wait for the stream thread to finish
    for _ in 0..100 {
        if !IS_RECORDING.load(Ordering::SeqCst) {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }

    let (raw_samples, native_rate, native_channels) = {
        let raw = get_raw_audio()
            .lock()
            .map_err(|e| format!("Lock poisoned: {e}"))?;
        (
            raw.samples.clone(),
            raw.native_sample_rate,
            raw.native_channels,
        )
    };

    if raw_samples.is_empty() {
        return Err("No audio data captured".into());
    }

    log::info!(
        "Captured {} samples at {}Hz {}ch",
        raw_samples.len(),
        native_rate,
        native_channels
    );

    // Downmix to mono
    let mono: Vec<f32> = raw_samples
        .chunks(native_channels as usize)
        .map(|frame: &[f32]| frame.iter().sum::<f32>() / frame.len() as f32)
        .collect();

    // Resample to 16kHz if needed
    let resampled = if native_rate == TARGET_SAMPLE_RATE {
        mono
    } else {
        resample_to_16k(&mono, native_rate)?
    };

    // Write WAV to cache directory
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("Failed to get cache dir: {e}"))?;
    std::fs::create_dir_all(&cache_dir).map_err(|e| format!("Failed to create cache dir: {e}"))?;

    let wav_path = cache_dir.join(format!("rec_{}.wav", timestamp_hex()));

    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: TARGET_SAMPLE_RATE,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };

    let mut writer = hound::WavWriter::create(&wav_path, spec)
        .map_err(|e| format!("Failed to create WAV: {e}"))?;

    for &sample in &resampled {
        let clamped: f32 = sample.clamp(-1.0, 1.0);
        let as_i16 = (clamped * i16::MAX as f32) as i16;
        writer
            .write_sample(as_i16)
            .map_err(|e| format!("Failed to write sample: {e}"))?;
    }

    writer
        .finalize()
        .map_err(|e| format!("Failed to finalize WAV: {e}"))?;

    let path_str = wav_path
        .to_str()
        .ok_or("Path is not valid UTF-8")?
        .to_string();

    log::info!(
        "Recording saved: {path_str} ({} samples at 16kHz)",
        resampled.len()
    );
    Ok(path_str)
}

/// Resample audio from `source_rate` to 16kHz using an FFT-based resampler.
fn resample_to_16k(mono: &[f32], source_rate: u32) -> Result<Vec<f32>, String> {
    use rubato::{FftFixedIn, Resampler};

    let ratio = TARGET_SAMPLE_RATE as f64 / source_rate as f64;
    let chunk_size = 1024;
    let sub_chunks = 2;

    let mut resampler = FftFixedIn::<f64>::new(
        source_rate as usize,
        TARGET_SAMPLE_RATE as usize,
        chunk_size,
        sub_chunks,
        1, // mono
    )
    .map_err(|e| format!("Failed to create resampler: {e}"))?;

    let mono_f64: Vec<f64> = mono.iter().map(|&s| s as f64).collect();
    let mut output = Vec::with_capacity((mono.len() as f64 * ratio * 1.1) as usize);

    let frames_needed = resampler.input_frames_next();
    let mut pos = 0;

    while pos + frames_needed <= mono_f64.len() {
        let chunk = &mono_f64[pos..pos + frames_needed];
        let result = resampler
            .process(&[chunk], None)
            .map_err(|e| format!("Resample error: {e}"))?;
        if let Some(channel) = result.first() {
            output.extend(channel.iter().map(|&s| s as f32));
        }
        pos += frames_needed;
    }

    // Process remaining samples with zero-padding
    if pos < mono_f64.len() {
        let remaining = &mono_f64[pos..];
        let mut padded = remaining.to_vec();
        padded.resize(frames_needed, 0.0);
        let result = resampler
            .process(&[&padded], None)
            .map_err(|e| format!("Resample error (tail): {e}"))?;
        if let Some(channel) = result.first() {
            let expected_tail = ((mono_f64.len() - pos) as f64 * ratio).ceil() as usize;
            let take = expected_tail.min(channel.len());
            output.extend(channel[..take].iter().map(|&s| s as f32));
        }
    }

    log::info!(
        "Resampled {} -> {} samples ({}Hz -> {}Hz)",
        mono.len(),
        output.len(),
        source_rate,
        TARGET_SAMPLE_RATE
    );
    Ok(output)
}

fn timestamp_hex() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("{nanos:x}")
}
