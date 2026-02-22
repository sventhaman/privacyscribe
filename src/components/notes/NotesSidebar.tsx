import { useTranslation } from 'react-i18next'
import { Plus, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useNotesStore, type Note } from '@/store/notes-store'
import { cn } from '@/lib/utils'

function formatNoteDate(date: Date): string {
  const now = new Date()
  const isToday = date.toDateString() === now.toDateString()
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const isYesterday = date.toDateString() === yesterday.toDateString()

  if (isToday) return 'Today'
  if (isYesterday) return 'Yesterday'

  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatNoteTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

function groupNotesByDate(notes: Note[]) {
  const groups: Record<string, Note[]> = {}
  for (const note of notes) {
    const key = formatNoteDate(note.createdAt)
    if (!groups[key]) groups[key] = []
    groups[key].push(note)
  }
  return groups
}

export function NotesSidebar() {
  const { t } = useTranslation()
  const notes = useNotesStore(state => state.notes)
  const selectedNoteId = useNotesStore(state => state.selectedNoteId)
  const searchQuery = useNotesStore(state => state.searchQuery)
  const selectNote = useNotesStore(state => state.selectNote)
  const createNote = useNotesStore(state => state.createNote)
  const setSearchQuery = useNotesStore(state => state.setSearchQuery)

  const filteredNotes = searchQuery
    ? notes.filter(note => {
        const query = searchQuery.toLowerCase()
        return (
          note.title.toLowerCase().includes(query) ||
          note.soap.subjective.toLowerCase().includes(query) ||
          note.soap.objective.toLowerCase().includes(query) ||
          note.soap.assessment.toLowerCase().includes(query) ||
          note.soap.plan.toLowerCase().includes(query) ||
          note.transcription.toLowerCase().includes(query)
        )
      })
    : notes

  const groups = groupNotesByDate(filteredNotes)

  return (
    <div className="flex h-full flex-col">
      {/* Section header */}
      <div className="px-4 pb-2 pt-3">
        <h1 className="text-base font-semibold tracking-tight text-foreground">
          {t('notes.sidebarTitle')}
        </h1>
      </div>

      {/* New Note button */}
      <div className="px-3 pb-2">
        <Button
          onClick={createNote}
          variant="outline"
          className="w-full justify-start gap-2 font-medium"
          size="sm"
        >
          <Plus className="size-4" />
          {t('notes.newNote')}
        </Button>
      </div>

      {/* Search */}
      <div className="px-3 pb-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder={t('notes.searchPlaceholder')}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="h-8 pl-8 text-sm"
          />
        </div>
      </div>

      {/* Note list */}
      <ScrollArea className="flex-1">
        <div className="pb-2">
          {Object.entries(groups).map(([dateLabel, groupNotes]) => (
            <div key={dateLabel}>
              <div className="px-4 pb-1 pt-2">
                <span className="text-xs font-medium text-muted-foreground">
                  {dateLabel}
                </span>
              </div>
              {groupNotes.map(note => (
                <button
                  key={note.id}
                  onClick={() => selectNote(note.id)}
                  className={cn(
                    'w-full px-4 py-2 text-start transition-colors hover:bg-accent/60',
                    selectedNoteId === note.id && 'bg-accent'
                  )}
                >
                  <div className="text-sm font-medium text-foreground">
                    {note.title || t('notes.untitledNote')}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatNoteTime(note.createdAt)}
                  </div>
                </button>
              ))}
            </div>
          ))}

          {filteredNotes.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
              {searchQuery ? t('notes.noSearchResults') : t('notes.noNotes')}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
