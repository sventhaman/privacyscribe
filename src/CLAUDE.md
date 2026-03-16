# Frontend — Claude Code Guide

## Directory Structure

```
src/
├── components/
│   ├── ui/              # shadcn/ui primitives (button, dialog, select, tabs, etc.)
│   ├── layout/          # MainWindow, LeftSideBar, RightSideBar, MainWindowContent
│   ├── notes/           # NoteEditor, NotesSidebar, AudioRecorder, NoteAssistant
│   ├── preferences/     # GeneralPane, AppearancePane, AdvancedPane
│   ├── titlebar/        # TitleBar, MacOSWindowControls
│   ├── command-palette/ # CommandPalette component
│   └── quick-pane/      # Floating quick-entry window
├── store/               # Zustand global state
│   ├── ui-store.ts      # Sidebar visibility, modal open/close
│   ├── notes-store.ts   # Notes CRUD, selection, active tab, search
│   └── templates-store.ts # SOAP template CRUD, system vs. custom
├── lib/
│   ├── tauri-bindings.ts  # Auto-generated type-safe Rust command wrappers
│   ├── db.ts              # SQLite init, schema, row types, migrations
│   ├── llm-service.ts     # LLM SOAP note generation (streams via events)
│   ├── commands/          # Frontend command registry (command palette)
│   ├── query-client.ts    # TanStack Query config
│   └── menu.ts            # App menu (built in JS for i18n)
├── services/
│   └── preferences.ts   # TanStack Query hooks: usePreferences, useSavePreferences
├── hooks/
│   ├── use-theme.ts
│   ├── use-platform.ts
│   ├── use-keyboard-shortcuts.ts
│   ├── useMainWindowEventListeners.ts
│   └── use-command-context.ts
├── i18n/
│   ├── config.ts          # i18next setup, RTL detection
│   └── language-init.ts   # Reads saved language pref on startup
├── types/
│   ├── templates.ts       # Template, TemplateSection, SectionStyle, DetailLevel
│   └── llm.ts             # LLMNoteResponse, LLMNoteSection
└── App.tsx                # Root: ErrorBoundary + ThemeProvider + app init
```

## State Management

Follow the **State Onion** — always use the lowest appropriate layer:

```
useState (local) → Zustand (shared UI) → TanStack Query (persisted/server)
```

### Zustand Stores

| Store               | What it holds                                                              |
| ------------------- | -------------------------------------------------------------------------- |
| `useUIStore`        | Left/right sidebar visibility, command palette open, preferences open      |
| `useNotesStore`     | Notes list, selected note ID, active tab, search query, debounced DB saves |
| `useTemplatesStore` | Templates list, selected template, debounced DB saves                      |

**CRITICAL — selector pattern:**

```typescript
// ✅ Selector — re-renders only when this value changes
const visible = useUIStore(state => state.leftSidebarVisible)

// ❌ Destructuring — causes render cascades, caught by ast-grep
const { leftSidebarVisible } = useUIStore()
```

**In callbacks, always use `getState()`** to avoid stale closures:

```typescript
const handleSave = () => {
  const { selectedNote } = useNotesStore.getState()
}
```

### TanStack Query (Preferences)

```typescript
import { usePreferences, useSavePreferences } from '@/services/preferences'

const { data: prefs } = usePreferences() // loads from Rust backend
const { mutate: save } = useSavePreferences() // persists via Rust backend
```

Desktop-specific query config: `refetchOnWindowFocus: false`, 1 retry, 5 min stale.

## Calling Rust Commands

Always use the generated bindings — never raw `invoke()`:

```typescript
import { commands } from '@/lib/tauri-bindings'

const result = await commands.startRecording()
if (result.status === 'error') console.error(result.error)
```

Listening to Rust events:

```typescript
import { listen } from '@tauri-apps/api/event'

const unlisten = await listen<string>('llm-chunk', event => {
  appendToken(event.payload)
})
```

## Styling

- **Tailwind CSS v4** via `@tailwindcss/vite` — no config file needed
- **shadcn/ui v4** components in `src/components/ui/`
- **OKLCH color system** defined in `src/theme-variables.css`
- **No manual `useMemo`/`useCallback`** — React Compiler handles memoization
- **RTL support**: use CSS logical properties (`ms-2` not `ml-2`, `text-start` not `text-left`)

## i18n

All user-visible strings must use translations:

```typescript
// React components
const { t } = useTranslation()
return <h1>{t('notes.title')}</h1>

// Outside React
import i18n from '@/i18n/config'
i18n.t('notes.title')
```

Translation files: `/locales/en.json`, `/locales/ar.json`, `/locales/fr.json`

## Key Types

```typescript
// src/store/notes-store.ts
interface Note {
  id: string
  title: string
  templateId: string | null
  createdAt: Date
  updatedAt: Date
  transcription: string
  soap: {
    subjective: string
    objective: string
    assessment: string
    plan: string
  }
}

// src/types/templates.ts
interface Template {
  id: string
  isSystem: boolean // system templates are read-only
  title: string
  description: string
  generalInstructions: string
  sections: TemplateSection[]
  createdAt: Date
  updatedAt: Date
}
```

## Layout

Three-column resizable layout (`MainWindow`):

```
TitleBar
ResizablePanelGroup
  ├── Left panel (20%)  → NotesSidebar
  ├── Center panel (60%) → NoteEditor
  └── Right panel (20%) → NoteAssistant
```

Panels collapse via `className={cn(!visible && 'hidden')}` driven by `useUIStore`.

## Multi-Window

- **Main window**: `index.html` entry, full app
- **Quick pane**: `quick-pane.html` entry, 500×72px floating input
- Theme changes emit `'theme-changed'` Tauri event so both windows stay in sync
