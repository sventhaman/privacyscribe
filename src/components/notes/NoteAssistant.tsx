import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'

interface Capability {
  titleKey: string
  descriptionKey: string
}

const CAPABILITIES: Capability[] = [
  {
    titleKey: 'notes.assistant.cap.askTitle',
    descriptionKey: 'notes.assistant.cap.askDesc',
  },
  {
    titleKey: 'notes.assistant.cap.editTitle',
    descriptionKey: 'notes.assistant.cap.editDesc',
  },
  {
    titleKey: 'notes.assistant.cap.createTitle',
    descriptionKey: 'notes.assistant.cap.createDesc',
  },
  {
    titleKey: 'notes.assistant.cap.reorderTitle',
    descriptionKey: 'notes.assistant.cap.reorderDesc',
  },
  {
    titleKey: 'notes.assistant.cap.deleteTitle',
    descriptionKey: 'notes.assistant.cap.deleteDesc',
  },
]

export function NoteAssistant() {
  const { t } = useTranslation()
  const [message, setMessage] = useState('')

  const handleSend = () => {
    if (!message.trim()) return
    // Placeholder for future AI integration
    setMessage('')
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="shrink-0 border-b px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">
          {t('notes.assistant.title')}
        </h2>
      </div>

      {/* Welcome content */}
      <ScrollArea className="flex-1">
        <div className="px-4 py-4">
          <p className="mb-1 text-sm font-semibold text-foreground">
            {t('notes.assistant.welcome')}
          </p>
          <p className="mb-4 text-sm text-muted-foreground">
            {t('notes.assistant.welcomeSubtitle')}
          </p>

          <ul className="space-y-2.5">
            {CAPABILITIES.map(cap => (
              <li key={cap.titleKey} className="flex gap-2 text-sm">
                <span className="mt-0.5 shrink-0 text-muted-foreground">•</span>
                <span>
                  <span className="font-medium text-foreground">
                    {t(cap.titleKey)}
                  </span>
                  <span className="text-muted-foreground">
                    {' '}
                    – {t(cap.descriptionKey)}
                  </span>
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-5 rounded-md bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">
              ⚠️ {t('notes.assistant.importantLabel')}
            </span>{' '}
            {t('notes.assistant.importantText')}
          </div>
        </div>
      </ScrollArea>

      {/* Chat input pinned to bottom */}
      <div className="shrink-0 border-t p-3">
        <div className="flex items-end gap-2 rounded-lg border bg-background px-3 py-2 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 transition-[color,box-shadow]">
          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('notes.assistant.inputPlaceholder')}
            rows={1}
            className="flex-1 resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
            style={
              {
                fieldSizing: 'content',
                maxHeight: '120px',
              } as React.CSSProperties
            }
          />
          <Button
            onClick={handleSend}
            disabled={!message.trim()}
            size="icon"
            className="size-6 shrink-0"
          >
            <Send className="size-3" />
          </Button>
        </div>
      </div>
    </div>
  )
}
