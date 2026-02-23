import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { getDb, type NoteRow } from '@/lib/db'
import { logger } from '@/lib/logger'

export interface SoapNote {
  subjective: string
  objective: string
  assessment: string
  plan: string
}

export interface Note {
  id: string
  title: string
  createdAt: Date
  updatedAt: Date
  transcription: string
  soap: SoapNote
}

export type NoteTab = 'transcription' | 'note'

interface NotesState {
  notes: Note[]
  selectedNoteId: string | null
  activeTab: NoteTab
  searchQuery: string
  isLoading: boolean

  loadNotes: () => Promise<void>
  selectNote: (id: string) => void
  createNote: () => Promise<void>
  updateTitle: (id: string, title: string) => void
  updateSoap: (id: string, field: keyof SoapNote, value: string) => void
  updateTranscription: (id: string, value: string) => void
  deleteNote: (id: string) => Promise<void>
  setActiveTab: (tab: NoteTab) => void
  setSearchQuery: (query: string) => void
}

function rowToNote(row: NoteRow): Note {
  return {
    id: row.id,
    title: row.title,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    transcription: row.transcription,
    soap: {
      subjective: row.subjective,
      objective: row.objective,
      assessment: row.assessment,
      plan: row.plan,
    },
  }
}

/**
 * Per-note debounce timers for background saves.
 * Each note gets its own timer so rapid edits to one note
 * don't cancel saves for another.
 */
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()

function scheduleSave(note: Note, delayMs = 500) {
  const existing = saveTimers.get(note.id)
  if (existing) clearTimeout(existing)

  saveTimers.set(
    note.id,
    setTimeout(async () => {
      saveTimers.delete(note.id)
      try {
        const db = await getDb()
        await db.execute(
          `UPDATE notes
              SET title         = $1,
                  subjective    = $2,
                  objective     = $3,
                  assessment    = $4,
                  plan          = $5,
                  transcription = $6,
                  updated_at    = $7
            WHERE id = $8`,
          [
            note.title,
            note.soap.subjective,
            note.soap.objective,
            note.soap.assessment,
            note.soap.plan,
            note.transcription,
            note.updatedAt.getTime(),
            note.id,
          ]
        )
        logger.debug(`Note ${note.id} saved to DB`)
      } catch (err) {
        logger.error('Failed to save note', { id: note.id, err })
      }
    }, delayMs)
  )
}

export const useNotesStore = create<NotesState>()(
  devtools(
    set => ({
      notes: [],
      selectedNoteId: null,
      activeTab: 'note',
      searchQuery: '',
      isLoading: false,

      loadNotes: async () => {
        set({ isLoading: true }, undefined, 'loadNotes/start')
        try {
          const db = await getDb()
          const rows = await db.select<NoteRow[]>(
            'SELECT * FROM notes ORDER BY created_at DESC'
          )
          const notes = rows.map(rowToNote)
          set(
            {
              notes,
              selectedNoteId: notes[0]?.id ?? null,
              isLoading: false,
            },
            undefined,
            'loadNotes/done'
          )
        } catch (err) {
          logger.error('Failed to load notes', { err })
          set({ isLoading: false }, undefined, 'loadNotes/error')
        }
      },

      selectNote: (id: string) =>
        set({ selectedNoteId: id }, undefined, 'selectNote'),

      createNote: async () => {
        const id = crypto.randomUUID()
        const now = Date.now()

        try {
          const db = await getDb()
          await db.execute(
            `INSERT INTO notes
               (id, title, subjective, objective, assessment, plan, transcription, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [id, '', '', '', '', '', '', now, now]
          )
        } catch (err) {
          logger.error('Failed to create note in DB', { err })
          return
        }

        const newNote: Note = {
          id,
          title: '',
          createdAt: new Date(now),
          updatedAt: new Date(now),
          transcription: '',
          soap: { subjective: '', objective: '', assessment: '', plan: '' },
        }

        set(
          state => ({
            notes: [newNote, ...state.notes],
            selectedNoteId: newNote.id,
            activeTab: 'note',
          }),
          undefined,
          'createNote'
        )
      },

      updateTitle: (id: string, title: string) => {
        set(
          state => {
            const notes = state.notes.map(note =>
              note.id === id ? { ...note, updatedAt: new Date(), title } : note
            )
            const updated = notes.find(n => n.id === id)
            if (updated) scheduleSave(updated)
            return { notes }
          },
          undefined,
          'updateTitle'
        )
      },

      updateSoap: (id: string, field: keyof SoapNote, value: string) => {
        set(
          state => {
            const notes = state.notes.map(note =>
              note.id === id
                ? {
                    ...note,
                    updatedAt: new Date(),
                    soap: { ...note.soap, [field]: value },
                  }
                : note
            )
            const updated = notes.find(n => n.id === id)
            if (updated) scheduleSave(updated)
            return { notes }
          },
          undefined,
          'updateSoap'
        )
      },

      updateTranscription: (id: string, value: string) => {
        set(
          state => {
            const notes = state.notes.map(note =>
              note.id === id
                ? { ...note, updatedAt: new Date(), transcription: value }
                : note
            )
            const updated = notes.find(n => n.id === id)
            if (updated) scheduleSave(updated)
            return { notes }
          },
          undefined,
          'updateTranscription'
        )
      },

      deleteNote: async (id: string) => {
        // Cancel any pending save for this note
        const timer = saveTimers.get(id)
        if (timer) {
          clearTimeout(timer)
          saveTimers.delete(id)
        }

        try {
          const db = await getDb()
          await db.execute('DELETE FROM notes WHERE id = $1', [id])
        } catch (err) {
          logger.error('Failed to delete note from DB', { id, err })
          return
        }

        set(
          state => {
            const index = state.notes.findIndex(n => n.id === id)
            const remaining = state.notes.filter(n => n.id !== id)
            const nextNote = remaining[index] ?? remaining[index - 1] ?? null
            return {
              notes: remaining,
              selectedNoteId: nextNote?.id ?? null,
            }
          },
          undefined,
          'deleteNote'
        )
      },

      setActiveTab: (tab: NoteTab) =>
        set({ activeTab: tab }, undefined, 'setActiveTab'),

      setSearchQuery: (query: string) =>
        set({ searchQuery: query }, undefined, 'setSearchQuery'),
    }),
    { name: 'notes-store' }
  )
)
