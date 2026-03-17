import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, Download, Loader2, Mic } from 'lucide-react'
import { listen } from '@tauri-apps/api/event'
import { Button } from '@/components/ui/button'
import { SettingsSection } from '../shared/SettingsComponents'
import { commands } from '@/lib/tauri-bindings'
import type { WhisperModelInfo } from '@/lib/tauri-bindings'

function formatSize(bytes: number): string {
  return Math.round(bytes / 1_000_000).toLocaleString()
}

function ModelCard({
  model,
  downloading,
  downloadPercent,
  onDownload,
}: {
  model: WhisperModelInfo
  downloading: boolean
  downloadPercent: number
  onDownload: () => void
}) {
  const { t } = useTranslation()
  const languageLabel =
    model.languages.length === 0
      ? t('preferences.transcription.multilingual')
      : model.languages.join(', ').toUpperCase()

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Mic className="size-4 shrink-0 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">
              {model.name}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <span>{languageLabel}</span>
            <span>·</span>
            <span>
              {t('preferences.transcription.sizeLabel', {
                size: formatSize(model.size_bytes),
              })}
            </span>
          </div>
        </div>

        <div className="shrink-0">
          {model.downloaded ? (
            <div className="flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400">
              <CheckCircle2 className="size-4" />
              <span>{t('preferences.transcription.downloaded')}</span>
            </div>
          ) : downloading ? (
            <div className="flex min-w-[120px] items-center gap-2">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                {t('preferences.transcription.downloading', {
                  percent: downloadPercent,
                })}
              </span>
            </div>
          ) : (
            <Button size="sm" variant="outline" onClick={onDownload}>
              <Download className="me-1.5 size-3.5" />
              {t('preferences.transcription.download')}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

async function fetchModels(): Promise<WhisperModelInfo[]> {
  const result = await commands.listWhisperModels()
  return result.status === 'ok' ? result.data : []
}

export function TranscriptionPane() {
  const { t } = useTranslation()
  const [models, setModels] = useState<WhisperModelInfo[]>([])
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [downloadPercent, setDownloadPercent] = useState(0)

  useEffect(() => {
    let cancelled = false
    fetchModels().then(data => {
      if (!cancelled) setModels(data)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const unlisten = listen<{ model_id: string; percent: number }>(
      'whisper-model-download-progress',
      e => {
        setDownloadPercent(e.payload.percent)
        if (e.payload.percent >= 100) {
          setDownloadingId(null)
          setDownloadPercent(0)
          // Refresh model list to update downloaded status
          fetchModels().then(setModels)
        }
      }
    )
    return () => {
      void unlisten.then(fn => fn())
    }
  }, [])

  const handleDownload = async (modelId: string) => {
    setDownloadingId(modelId)
    setDownloadPercent(0)
    const result = await commands.downloadWhisperModel(modelId)
    if (result.status === 'error') {
      setDownloadingId(null)
    }
  }

  return (
    <div className="space-y-6">
      <SettingsSection title={t('preferences.transcription.models')}>
        <p className="text-sm text-muted-foreground">
          {t('preferences.transcription.modelsDescription')}
        </p>
        <div className="space-y-3">
          {models.map(model => (
            <ModelCard
              key={model.id}
              model={model}
              downloading={downloadingId === model.id}
              downloadPercent={downloadPercent}
              onDownload={() => void handleDownload(model.id)}
            />
          ))}
        </div>
      </SettingsSection>
    </div>
  )
}
