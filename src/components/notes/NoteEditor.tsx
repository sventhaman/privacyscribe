import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Trash2, Clipboard, ClipboardCheck, Pencil } from 'lucide-react'
import TextareaAutosize from 'react-textarea-autosize'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useNotesStore, type SoapNote, type NoteTab } from '@/store/notes-store'
import { notifications } from '@/lib/notifications'

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
  const deleteNote = useNotesStore(state => state.deleteNote)
  const setActiveTab = useNotesStore(state => state.setActiveTab)

  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle')

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

  const handleCopySoap = async () => {
    const { subjective, objective, assessment, plan } = selectedNote.soap
    const text = [
      `Subjective:\n${subjective}`,
      `Objective:\n${objective}`,
      `Assessment:\n${assessment}`,
      `Plan:\n${plan}`,
    ]
      .filter(section => section.split('\n')[1]?.trim())
      .join('\n\n')
    await navigator.clipboard.writeText(text)
    setCopyState('copied')
    setTimeout(() => setCopyState('idle'), 2000)
    notifications.success(t('notes.header.copiedLabel'))
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

        {/* Row 2: date/time + tabs */}
        <div className="mt-1 flex items-center justify-between">
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

      {/* Content area — single scroll context, textareas grow with content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'transcription' ? (
          <div className="px-6 pb-24 pt-5">
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
            <SoapSection
              label={t('notes.soap.subjective')}
              value={selectedNote.soap.subjective}
              onChange={val => handleSoapChange('subjective', val)}
              placeholder={t('notes.soap.subjectivePlaceholder')}
            />
            <SoapSection
              label={t('notes.soap.objective')}
              value={selectedNote.soap.objective}
              onChange={val => handleSoapChange('objective', val)}
              placeholder={t('notes.soap.objectivePlaceholder')}
            />
            <SoapSection
              label={t('notes.soap.assessment')}
              value={selectedNote.soap.assessment}
              onChange={val => handleSoapChange('assessment', val)}
              placeholder={t('notes.soap.assessmentPlaceholder')}
            />
            <SoapSection
              label={t('notes.soap.plan')}
              value={selectedNote.soap.plan}
              onChange={val => handleSoapChange('plan', val)}
              placeholder={t('notes.soap.planPlaceholder')}
            />
          </div>
        )}
      </div>
    </div>
  )
}
