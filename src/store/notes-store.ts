import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

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

  selectNote: (id: string) => void
  createNote: () => void
  updateTitle: (id: string, title: string) => void
  updateSoap: (id: string, field: keyof SoapNote, value: string) => void
  updateTranscription: (id: string, value: string) => void
  deleteNote: (id: string) => void
  setActiveTab: (tab: NoteTab) => void
  setSearchQuery: (query: string) => void
}

const SAMPLE_NOTES: Note[] = [
  {
    id: '1',
    title: 'Lower Back Pain Follow-up',
    createdAt: new Date('2026-02-09T18:02:00'),
    updatedAt: new Date('2026-02-09T18:02:00'),
    transcription: '',
    soap: {
      subjective:
        'Patient reports persistent lower back pain for the past 3 weeks. Pain is 6/10, worse in the morning and after prolonged sitting. No radiation to legs. Denies bowel or bladder changes.',
      objective:
        'BP 128/82, HR 72 bpm, Temp 36.8°C. Lumbar spine: tenderness at L4–L5. ROM limited in flexion. Negative straight leg raise bilaterally. Neurological exam intact.',
      assessment:
        'Mechanical low back pain, likely musculoskeletal in origin. No red flags identified.',
      plan: 'NSAIDs for pain management. Physical therapy referral. Follow up in 4 weeks or sooner if symptoms worsen. Patient educated on ergonomics and activity modification.',
    },
  },
  {
    id: '2',
    title: '',
    createdAt: new Date('2026-01-21T10:04:00'),
    updatedAt: new Date('2026-01-21T10:04:00'),
    transcription: '',
    soap: {
      subjective: '',
      objective: '',
      assessment: '',
      plan: '',
    },
  },
  {
    id: '3',
    title: '',
    createdAt: new Date('2026-01-15T21:11:00'),
    updatedAt: new Date('2026-01-15T21:11:00'),
    transcription: '',
    soap: {
      subjective: '',
      objective: '',
      assessment: '',
      plan: '',
    },
  },
  {
    id: '4',
    title: '',
    createdAt: new Date('2026-01-13T20:31:00'),
    updatedAt: new Date('2026-01-13T20:31:00'),
    transcription: '',
    soap: {
      subjective: '',
      objective: '',
      assessment: '',
      plan: '',
    },
  },
]

export const useNotesStore = create<NotesState>()(
  devtools(
    set => ({
      notes: SAMPLE_NOTES,
      selectedNoteId: SAMPLE_NOTES[1]?.id ?? null,
      activeTab: 'note',
      searchQuery: '',

      selectNote: (id: string) =>
        set({ selectedNoteId: id }, undefined, 'selectNote'),

      createNote: () =>
        set(
          state => {
            const newNote: Note = {
              id: crypto.randomUUID(),
              title: '',
              createdAt: new Date(),
              updatedAt: new Date(),
              transcription: '',
              soap: { subjective: '', objective: '', assessment: '', plan: '' },
            }
            return {
              notes: [newNote, ...state.notes],
              selectedNoteId: newNote.id,
              activeTab: 'note',
            }
          },
          undefined,
          'createNote'
        ),

      updateTitle: (id: string, title: string) =>
        set(
          state => ({
            notes: state.notes.map(note =>
              note.id === id ? { ...note, updatedAt: new Date(), title } : note
            ),
          }),
          undefined,
          'updateTitle'
        ),

      deleteNote: (id: string) =>
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
        ),

      updateSoap: (id: string, field: keyof SoapNote, value: string) =>
        set(
          state => ({
            notes: state.notes.map(note =>
              note.id === id
                ? {
                    ...note,
                    updatedAt: new Date(),
                    soap: { ...note.soap, [field]: value },
                  }
                : note
            ),
          }),
          undefined,
          'updateSoap'
        ),

      updateTranscription: (id: string, value: string) =>
        set(
          state => ({
            notes: state.notes.map(note =>
              note.id === id
                ? { ...note, updatedAt: new Date(), transcription: value }
                : note
            ),
          }),
          undefined,
          'updateTranscription'
        ),

      setActiveTab: (tab: NoteTab) =>
        set({ activeTab: tab }, undefined, 'setActiveTab'),

      setSearchQuery: (query: string) =>
        set({ searchQuery: query }, undefined, 'setSearchQuery'),
    }),
    { name: 'notes-store' }
  )
)
