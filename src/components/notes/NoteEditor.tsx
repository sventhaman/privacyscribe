import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Trash2,
  Clipboard,
  ClipboardCheck,
  Pencil,
  Sparkles,
  Loader2,
} from 'lucide-react'
import TextareaAutosize from 'react-textarea-autosize'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useNotesStore, type SoapNote, type NoteTab } from '@/store/notes-store'
import { useTemplatesStore } from '@/store/templates-store'
import { notifications } from '@/lib/notifications'
import { AudioRecorder } from '@/components/notes/AudioRecorder'
import { generateNote } from '@/lib/llm-service'
import { commands } from '@/lib/tauri-bindings'
import { listen } from '@tauri-apps/api/event'

function formatHeaderDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatHeaderTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

interface SoapSectionProps {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

function SoapSection({
  label,
  value,
  onChange,
  placeholder,
}: SoapSectionProps) {
  return (
    <div className="border-b border-border/50 last:border-b-0">
      <div className="px-6 pb-3 pt-5">
        <h3 className="mb-2 text-sm font-semibold text-foreground">{label}</h3>
        <TextareaAutosize
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          minRows={3}
          className="w-full resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60 outline-none"
        />
      </div>
    </div>
  )
}

export function NoteEditor() {
  const { t } = useTranslation()
  const notes = useNotesStore(state => state.notes)
  const selectedNoteId = useNotesStore(state => state.selectedNoteId)
  const activeTab = useNotesStore(state => state.activeTab)
  const updateTitle = useNotesStore(state => state.updateTitle)
  const updateSoap = useNotesStore(state => state.updateSoap)
  const updateTranscription = useNotesStore(state => state.updateTranscription)
  const appendTranscription = (noteId: string, text: string) => {
    const note = useNotesStore.getState().notes.find(n => n.id === noteId)
    const existing = note?.transcription ?? ''
    const separator = existing.trim() ? '\n\n' : ''
    updateTranscription(noteId, existing + separator + text)
  }
  const deleteNote = useNotesStore(state => state.deleteNote)
  const setActiveTab = useNotesStore(state => state.setActiveTab)

  const templates = useTemplatesStore(state => state.templates)

  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle')
  const [isGenerating, setIsGenerating] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const [downloadPercent, setDownloadPercent] = useState(0)

  const selectedNote = notes.find(n => n.id === selectedNoteId)

  if (!selectedNote) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">{t('notes.selectNote')}</p>
      </div>
    )
  }

  const handleSoapChange = (field: keyof SoapNote, value: string) => {
    updateSoap(selectedNote.id, field, value)
  }

  const handleSectionChange = (title: string, content: string) => {
    const { updateSection } = useNotesStore.getState()
    updateSection(selectedNote.id, title, content)
  }

  const handleCopySoap = async () => {
    let text: string
    if (selectedNote.sections.length > 0) {
      text = selectedNote.sections
        .filter(s => s.content.trim())
        .map(s => `${s.title}:\n${s.content}`)
        .join('\n\n')
    } else {
      const { subjective, objective, assessment, plan } = selectedNote.soap
      text = [
        `Subjective:\n${subjective}`,
        `Objective:\n${objective}`,
        `Assessment:\n${assessment}`,
        `Plan:\n${plan}`,
      ]
        .filter(section => section.split('\n')[1]?.trim())
        .join('\n\n')
    }
    await navigator.clipboard.writeText(text)
    setCopyState('copied')
    setTimeout(() => setCopyState('idle'), 2000)
    notifications.success(t('notes.header.copiedLabel'))
  }

  const handleTemplateChange = (templateId: string) => {
    const { setNoteTemplate } = useNotesStore.getState()
    setNoteTemplate(selectedNote.id, templateId)
  }

  const handleGenerate = async () => {
    if (isGenerating) return

    // Find the template for this note
    const template = templates.find(t => t.id === selectedNote.templateId)
    if (!template) {
      notifications.error(t('llm.templateLabel'))
      return
    }

    if (!selectedNote.transcription.trim()) {
      notifications.error(t('notes.transcription.placeholder'))
      return
    }

    // Check model exists first
    const checkResult = await commands.checkLlmModel()
    if (checkResult.status === 'error') {
      notifications.error(checkResult.error)
      return
    }
    if (!checkResult.data) {
      // Model not downloaded — start download
      setIsDownloading(true)
      setDownloadPercent(0)
      const unlisten = await listen<{ percent: number }>(
        'llm-model-download-progress',
        e => {
          setDownloadPercent(e.payload.percent)
        }
      )
      try {
        const downloadResult = await commands.downloadLlmModel()
        if (downloadResult.status === 'error') {
          notifications.error(downloadResult.error)
          return
        }
      } finally {
        unlisten()
        setIsDownloading(false)
      }
    }

    // Generate the note
    setIsGenerating(true)
    try {
      const output = await generateNote(selectedNote, template)

      // Write output sections to the note
      const { setSections, updateTitle: setTitle } = useNotesStore.getState()
      setSections(
        selectedNote.id,
        output.sections.map(s => ({
          title: s.title,
          content: s.content,
        }))
      )

      // Auto-set title if empty
      if (!selectedNote.title.trim() && output.title) {
        setTitle(selectedNote.id, output.title)
      }

      // Switch to note tab to show the result
      const { setActiveTab: switchTab } = useNotesStore.getState()
      switchTab('note')
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t('llm.errorGenerating')
      notifications.error(message)
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header: two rows */}
      <div className="shrink-0 border-b px-6 pb-2 pt-3">
        {/* Row 1: title + action buttons */}
        <div className="flex items-center gap-2">
          <div className="group flex min-w-0 flex-1 items-center gap-2 rounded-md border border-transparent py-1.5 pl-2 pr-2 transition-colors hover:border-border hover:bg-muted/40 focus-within:border-border focus-within:bg-muted/30 focus-within:ring-[1px] focus-within:ring-ring/50">
            <Pencil className="size-4 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-muted-foreground group-focus-within:text-muted-foreground" />
            <input
              type="text"
              value={selectedNote.title}
              onChange={e => updateTitle(selectedNote.id, e.target.value)}
              placeholder={t('notes.untitledNote')}
              className="min-w-0 flex-1 bg-transparent text-base font-semibold text-foreground outline-none placeholder:text-muted-foreground/50"
            />
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => deleteNote(selectedNote.id)}
            title={t('notes.header.deleteLabel')}
            className="shrink-0 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleCopySoap}
            title={t('notes.header.copyLabel')}
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            {copyState === 'copied' ? (
              <ClipboardCheck className="size-4 text-green-600 dark:text-green-400" />
            ) : (
              <Clipboard className="size-4" />
            )}
          </Button>
        </div>

        {/* Row 2: template + generate + date/time + tabs */}
        <div className="mt-1 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Select
              value={selectedNote.templateId ?? ''}
              onValueChange={handleTemplateChange}
            >
              <SelectTrigger className="h-7 w-40 text-xs">
                <SelectValue placeholder={t('llm.templateLabel')} />
              </SelectTrigger>
              <SelectContent>
                {templates.map(tmpl => (
                  <SelectItem key={tmpl.id} value={tmpl.id}>
                    {tmpl.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              onClick={handleGenerate}
              disabled={
                isGenerating ||
                isDownloading ||
                !selectedNote.templateId ||
                !selectedNote.transcription.trim()
              }
            >
              {isDownloading ? (
                <>
                  <Loader2 className="size-3 animate-spin" />
                  {downloadPercent}%
                </>
              ) : isGenerating ? (
                <>
                  <Loader2 className="size-3 animate-spin" />
                  {t('llm.generating')}
                </>
              ) : (
                <>
                  <Sparkles className="size-3" />
                  {t('llm.generateNote')}
                </>
              )}
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {formatHeaderDate(selectedNote.createdAt)},{' '}
              {formatHeaderTime(selectedNote.createdAt)}
            </span>

            <Tabs
              value={activeTab}
              onValueChange={val => setActiveTab(val as NoteTab)}
            >
              <TabsList className="h-7">
                <TabsTrigger value="transcription" className="h-5 px-3 text-xs">
                  {t('notes.tab.transcription')}
                </TabsTrigger>
                <TabsTrigger value="note" className="h-5 px-3 text-xs">
                  {t('notes.tab.note')}
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>
      </div>

      {/* Content area — single scroll context, textareas grow with content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'transcription' ? (
          <div className="flex flex-col gap-4 px-6 pb-24 pt-5">
            <AudioRecorder
              onTranscriptionReady={text =>
                appendTranscription(selectedNote.id, text)
              }
            />
            <TextareaAutosize
              value={selectedNote.transcription}
              onChange={e =>
                updateTranscription(selectedNote.id, e.target.value)
              }
              placeholder={t('notes.transcription.placeholder')}
              minRows={8}
              className="w-full resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60 outline-none"
            />
          </div>
        ) : (
          <div className="pb-24">
            {selectedNote.sections.length > 0
              ? selectedNote.sections.map(s => (
                  <SoapSection
                    key={s.title}
                    label={s.title}
                    value={s.content}
                    onChange={val => handleSectionChange(s.title, val)}
                  />
                ))
              : (
                  ['Subjective', 'Objective', 'Assessment', 'Plan'] as const
                ).map(field => (
                  <SoapSection
                    key={field}
                    label={t(
                      `notes.soap.${field.toLowerCase() as 'subjective' | 'objective' | 'assessment' | 'plan'}`
                    )}
                    value={
                      selectedNote.soap[field.toLowerCase() as keyof SoapNote]
                    }
                    onChange={val =>
                      handleSoapChange(
                        field.toLowerCase() as keyof SoapNote,
                        val
                      )
                    }
                    placeholder={t(
                      `notes.soap.${field.toLowerCase() as 'subjective' | 'objective' | 'assessment' | 'plan'}Placeholder`
                    )}
                  />
                ))}
          </div>
        )}
      </div>
    </div>
  )
}
