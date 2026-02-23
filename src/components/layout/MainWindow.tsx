import { useEffect } from 'react'
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable'
import { TitleBar } from '@/components/titlebar/TitleBar'
import { LeftSideBar } from './LeftSideBar'
import { RightSideBar } from './RightSideBar'
import { MainWindowContent } from './MainWindowContent'
import { CommandPalette } from '@/components/command-palette/CommandPalette'
import { PreferencesDialog } from '@/components/preferences/PreferencesDialog'
import { Toaster } from 'sonner'
import { useTheme } from '@/hooks/use-theme'
import { useUIStore } from '@/store/ui-store'
import { useMainWindowEventListeners } from '@/hooks/useMainWindowEventListeners'
import { cn } from '@/lib/utils'
import { NotesSidebar } from '@/components/notes/NotesSidebar'
import { NoteEditor } from '@/components/notes/NoteEditor'
import { NoteAssistant } from '@/components/notes/NoteAssistant'
import { initDb } from '@/lib/db'
import { useNotesStore } from '@/store/notes-store'
import { logger } from '@/lib/logger'

/**
 * Layout sizing configuration for resizable panels.
 * All values are percentages of total width.
 * Sidebar defaults + main default must equal 100.
 */
const LAYOUT = {
  leftSidebar: { default: 20, min: 15, max: 40 },
  rightSidebar: { default: 20, min: 15, max: 40 },
  main: { min: 30 },
} as const

// Main content default is calculated to ensure totals sum to 100%
const MAIN_CONTENT_DEFAULT =
  100 - LAYOUT.leftSidebar.default - LAYOUT.rightSidebar.default

export function MainWindow() {
  const { theme } = useTheme()
  const leftSidebarVisible = useUIStore(state => state.leftSidebarVisible)
  const rightSidebarVisible = useUIStore(state => state.rightSidebarVisible)
  const loadNotes = useNotesStore(state => state.loadNotes)

  // Initialise DB schema then load notes on first mount
  useEffect(() => {
    initDb()
      .then(() => loadNotes())
      .catch(err => logger.error('DB init failed', { err }))
  }, [loadNotes])

  // Set up global event listeners (keyboard shortcuts, etc.)
  useMainWindowEventListeners()

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden rounded-xl bg-background">
      <TitleBar />

      <div className="flex flex-1 overflow-hidden">
        <ResizablePanelGroup direction="horizontal">
          <ResizablePanel
            defaultSize={LAYOUT.leftSidebar.default}
            minSize={LAYOUT.leftSidebar.min}
            maxSize={LAYOUT.leftSidebar.max}
            className={cn(!leftSidebarVisible && 'hidden')}
          >
            <LeftSideBar>
              <NotesSidebar />
            </LeftSideBar>
          </ResizablePanel>

          <ResizableHandle className={cn(!leftSidebarVisible && 'hidden')} />

          <ResizablePanel
            defaultSize={MAIN_CONTENT_DEFAULT}
            minSize={LAYOUT.main.min}
          >
            <MainWindowContent>
              <NoteEditor />
            </MainWindowContent>
          </ResizablePanel>

          <ResizableHandle className={cn(!rightSidebarVisible && 'hidden')} />

          <ResizablePanel
            defaultSize={LAYOUT.rightSidebar.default}
            minSize={LAYOUT.rightSidebar.min}
            maxSize={LAYOUT.rightSidebar.max}
            className={cn(!rightSidebarVisible && 'hidden')}
          >
            <RightSideBar>
              <NoteAssistant />
            </RightSideBar>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      {/* Global UI Components (hidden until triggered) */}
      <CommandPalette />
      <PreferencesDialog />
      <Toaster
        position="bottom-right"
        theme={
          theme === 'dark' ? 'dark' : theme === 'light' ? 'light' : 'system'
        }
        className="toaster group"
        toastOptions={{
          classNames: {
            toast:
              'group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg',
            description: 'group-[.toast]:text-muted-foreground',
            actionButton:
              'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
            cancelButton:
              'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground',
          },
        }}
      />
    </div>
  )
}
