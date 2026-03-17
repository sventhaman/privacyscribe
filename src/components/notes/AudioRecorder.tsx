import { useEffect, useRef, useState } from 'react'
import { Mic, Square, Loader2, AlertTriangle } from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { notifications } from '@/lib/notifications'
import { WHISPER_LANGUAGES } from '@/lib/whisper-languages'
import { commands } from '@/lib/tauri-bindings'
import type { WhisperModelInfo } from '@/lib/tauri-bindings'
import { useTranslation } from 'react-i18next'

type RecorderState = 'idle' | 'recording' | 'transcribing'

const LANGUAGE_STORAGE_KEY = 'privacyscribe-whisper-language'
const MODEL_STORAGE_KEY = 'privacyscribe-whisper-model'
const DEFAULT_MODEL_ID = 'whisper-large-v3-turbo'

// 'auto' means pass null to Whisper → auto-detect from audio
type WhisperLanguage = 'auto' | string

function getStoredLanguage(): WhisperLanguage {
  return localStorage.getItem(LANGUAGE_STORAGE_KEY) ?? 'auto'
}

function saveLanguage(lang: WhisperLanguage) {
  localStorage.setItem(LANGUAGE_STORAGE_KEY, lang)
}

function getStoredModel(): string {
  return localStorage.getItem(MODEL_STORAGE_KEY) ?? DEFAULT_MODEL_ID
}

function saveModel(id: string) {
  localStorage.setItem(MODEL_STORAGE_KEY, id)
}

interface AudioRecorderProps {
  onTranscriptionReady: (text: string) => void
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0')
  const s = (seconds % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

/** Filter models compatible with a given language selection. */
function compatibleModels(
  models: WhisperModelInfo[],
  language: WhisperLanguage
): WhisperModelInfo[] {
  return models.filter(
    m => m.languages.length === 0 || m.languages.includes(language)
  )
}

export function AudioRecorder({ onTranscriptionReady }: AudioRecorderProps) {
  const { t } = useTranslation()

  const [state, setState] = useState<RecorderState>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [downloadPercent, setDownloadPercent] = useState<number | null>(null)
  const [language, setLanguage] = useState<WhisperLanguage>(getStoredLanguage)
  const [selectedModelId, setSelectedModelId] = useState(getStoredModel)
  const [allModels, setAllModels] = useState<WhisperModelInfo[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Load model catalogue on mount
  useEffect(() => {
    void commands.listWhisperModels().then(result => {
      if (result.status === 'ok') setAllModels(result.data)
    })
  }, [])

  useEffect(() => {
    const unlisten = listen<{ percent: number }>(
      'model-download-progress',
      event => {
        setDownloadPercent(event.payload.percent)
      }
    )
    return () => {
      unlisten.then(fn => fn())
    }
  }, [])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  const compatible = compatibleModels(allModels, language)
  const selectedModel = allModels.find(m => m.id === selectedModelId)
  const showModelSelector = compatible.length > 1

  // When language changes, auto-select the best model for that language
  function handleLanguageChange(value: WhisperLanguage) {
    setLanguage(value)
    saveLanguage(value)

    const newCompatible = compatibleModels(allModels, value)
    // Pick the language-specific model if available, otherwise keep default
    const languageSpecific = newCompatible.find(m => m.languages.length > 0)
    if (languageSpecific) {
      setSelectedModelId(languageSpecific.id)
      saveModel(languageSpecific.id)
    } else {
      setSelectedModelId(DEFAULT_MODEL_ID)
      saveModel(DEFAULT_MODEL_ID)
    }
  }

  function handleModelChange(value: string) {
    setSelectedModelId(value)
    saveModel(value)
  }

  async function handleRecord() {
    if (state === 'recording') {
      // Stop recording
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      setState('transcribing')
      setElapsed(0)
      setDownloadPercent(null)

      try {
        const filePath = await invoke<string>('stop_recording')

        // Use selected model if downloaded, fall back to default
        const effectiveModelId = selectedModel?.downloaded
          ? selectedModelId
          : DEFAULT_MODEL_ID

        const text = await invoke<string>('transcribe_and_delete', {
          filePath,
          language: language === 'auto' ? null : language,
          modelId: effectiveModelId,
        })

        if (text.trim()) {
          onTranscriptionReady(text.trim())
          notifications.success(t('notes.recording.savedToast'))
        }
      } catch (err) {
        notifications.error(
          t('notes.recording.errorToast', { error: String(err) })
        )
      } finally {
        setState('idle')
        setDownloadPercent(null)
      }
    } else {
      // Start recording
      try {
        await invoke('start_recording')
        setState('recording')
        setElapsed(0)
        timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000)
      } catch (err) {
        notifications.error(
          t('notes.recording.noMicError') + '\n' + String(err)
        )
      }
    }
  }

  if (state === 'transcribing') {
    return (
      <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-4 py-3">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        <span className="text-sm text-muted-foreground">
          {downloadPercent !== null && downloadPercent < 100
            ? t('notes.recording.downloadingModel', {
                percent: downloadPercent,
              })
            : t('notes.recording.transcribing')}
        </span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Button
          variant={state === 'recording' ? 'destructive' : 'outline'}
          size="sm"
          className="gap-1.5"
          onClick={handleRecord}
        >
          {state === 'recording' ? (
            <>
              <Square className="h-3 w-3 fill-current" />
              {t('notes.recording.stop')}
            </>
          ) : (
            <>
              <Mic className="h-3.5 w-3.5" />
              {t('notes.recording.start')}
            </>
          )}
        </Button>

        {state === 'idle' && (
          <>
            <Select value={language} onValueChange={handleLanguageChange}>
              <SelectTrigger size="sm" className="w-32 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-64">
                <SelectItem value="auto" className="text-xs font-medium">
                  {t('notes.recording.languageAuto')} (Auto)
                </SelectItem>
                {WHISPER_LANGUAGES.map(lang => (
                  <SelectItem
                    key={lang.code}
                    value={lang.code}
                    className="text-xs"
                  >
                    {lang.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {showModelSelector && (
              <Select value={selectedModelId} onValueChange={handleModelChange}>
                <SelectTrigger size="sm" className="w-48 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {compatible.map(m => (
                    <SelectItem key={m.id} value={m.id} className="text-xs">
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </>
        )}

        {state === 'recording' && (
          <>
            <span className="text-destructive font-mono text-sm tabular-nums">
              {formatTime(elapsed)}
            </span>
            <span className="relative flex h-2.5 w-2.5">
              <span className="bg-destructive absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" />
              <span className="bg-destructive relative inline-flex h-2.5 w-2.5 rounded-full" />
            </span>
          </>
        )}
      </div>

      {state === 'idle' &&
        showModelSelector &&
        selectedModel &&
        !selectedModel.downloaded && (
          <div className="flex items-center gap-1.5 ps-1 text-xs text-amber-600 dark:text-amber-400">
            <AlertTriangle className="size-3 shrink-0" />
            <span>{t('transcription.modelNotDownloaded')}</span>
          </div>
        )}
    </div>
  )
}
