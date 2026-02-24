import { useEffect, useRef, useState } from 'react'
import { Mic, Square, Loader2 } from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { Button } from '@/components/ui/button'
import { notifications } from '@/lib/notifications'
import { useTranslation } from 'react-i18next'

type RecorderState = 'idle' | 'recording' | 'transcribing'

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

export function AudioRecorder({ onTranscriptionReady }: AudioRecorderProps) {
  const { t } = useTranslation()

  const [state, setState] = useState<RecorderState>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [downloadPercent, setDownloadPercent] = useState<number | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

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

        const text = await invoke<string>('transcribe_and_delete', {
          filePath,
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
    <div className="flex items-center gap-3">
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
  )
}
