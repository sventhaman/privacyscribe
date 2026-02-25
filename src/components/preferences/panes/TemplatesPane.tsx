import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Plus,
  Trash2,
  Copy,
  ChevronUp,
  ChevronDown,
  X,
  FileText,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useTemplatesStore } from '@/store/templates-store'
import {
  SECTION_STYLES,
  DETAIL_LEVELS,
  type Template,
  type TemplateSection,
  type SectionStyle,
  type DetailLevel,
} from '@/types/templates'

export function TemplatesPane() {
  const { t } = useTranslation()

  const templates = useTemplatesStore(state => state.templates)
  const selectedTemplateId = useTemplatesStore(
    state => state.selectedTemplateId
  )
  const isLoading = useTemplatesStore(state => state.isLoading)
  const loadTemplates = useTemplatesStore(state => state.loadTemplates)
  const selectTemplate = useTemplatesStore(state => state.selectTemplate)
  const createTemplate = useTemplatesStore(state => state.createTemplate)
  const updateTemplate = useTemplatesStore(state => state.updateTemplate)
  const deleteTemplate = useTemplatesStore(state => state.deleteTemplate)

  useEffect(() => {
    if (templates.length === 0 && !isLoading) {
      loadTemplates()
    }
  }, [templates.length, isLoading, loadTemplates])

  const selected = templates.find(t => t.id === selectedTemplateId)

  return (
    <div className="flex h-full gap-4">
      {/* Left column: template list */}
      <div className="flex w-48 shrink-0 flex-col gap-2">
        <Button
          variant="outline"
          size="sm"
          className="w-full gap-1.5"
          onClick={() => createTemplate()}
        >
          <Plus className="size-3.5" />
          {t('preferences.templates.newTemplate')}
        </Button>

        <ScrollArea className="flex-1">
          <div className="flex flex-col gap-1 pr-2">
            {templates.map(tmpl => (
              <button
                key={tmpl.id}
                onClick={() => selectTemplate(tmpl.id)}
                className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-start text-sm transition-colors ${
                  tmpl.id === selectedTemplateId
                    ? 'bg-accent text-accent-foreground'
                    : 'hover:bg-muted/60'
                }`}
              >
                <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">
                  {tmpl.title || t('preferences.templates.titlePlaceholder')}
                </span>
                {tmpl.isSystem && (
                  <Badge
                    variant="secondary"
                    className="shrink-0 px-1 py-0 text-[10px]"
                  >
                    {t('preferences.templates.builtIn')}
                  </Badge>
                )}
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>

      <Separator orientation="vertical" />

      {/* Right column: template editor */}
      <div className="flex min-w-0 flex-1 flex-col">
        {selected ? (
          <TemplateEditor
            template={selected}
            onUpdate={patch => updateTemplate(selected.id, patch)}
            onDuplicate={() => createTemplate(selected)}
            onDelete={() => deleteTemplate(selected.id)}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-sm text-muted-foreground">
              {t('preferences.templates.noSelection')}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

interface TemplateEditorProps {
  template: Template
  onUpdate: (
    patch: Partial<
      Pick<
        Template,
        'title' | 'description' | 'generalInstructions' | 'sections'
      >
    >
  ) => void
  onDuplicate: () => void
  onDelete: () => void
}

function TemplateEditor({
  template,
  onUpdate,
  onDuplicate,
  onDelete,
}: TemplateEditorProps) {
  const { t } = useTranslation()
  const readOnly = template.isSystem

  const handleSectionChange = (
    sectionId: string,
    patch: Partial<TemplateSection>
  ) => {
    const sections = template.sections.map(s =>
      s.id === sectionId ? { ...s, ...patch } : s
    )
    onUpdate({ sections })
  }

  const handleAddSection = () => {
    const section: TemplateSection = {
      id: crypto.randomUUID(),
      title: '',
      style: 'Auto',
      detail_level: 'Normal',
      instructions: '',
    }
    onUpdate({ sections: [...template.sections, section] })
  }

  const handleRemoveSection = (sectionId: string) => {
    onUpdate({
      sections: template.sections.filter(s => s.id !== sectionId),
    })
  }

  const handleMoveSection = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= template.sections.length) return
    const sections = [...template.sections]
    const a = sections[index]
    const b = sections[target]
    if (!a || !b) return
    sections[index] = b
    sections[target] = a
    onUpdate({ sections })
  }

  return (
    <ScrollArea className="flex-1">
      <div className="flex flex-col gap-4 pr-3">
        {/* Header: action buttons */}
        <div className="flex items-center gap-2">
          {readOnly && (
            <p className="flex-1 text-xs text-muted-foreground">
              {t('preferences.templates.readOnlyNotice')}
            </p>
          )}
          {!readOnly && <div className="flex-1" />}
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={onDuplicate}
          >
            <Copy className="size-3.5" />
            {t('preferences.templates.duplicateToEdit')}
          </Button>
          {!readOnly && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-destructive"
              onClick={onDelete}
            >
              <Trash2 className="size-4" />
            </Button>
          )}
        </div>

        {/* Title */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            {t('preferences.templates.titleLabel')}
          </label>
          <Input
            value={template.title}
            onChange={e => onUpdate({ title: e.target.value })}
            placeholder={t('preferences.templates.titlePlaceholder')}
            disabled={readOnly}
          />
        </div>

        {/* Description */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            {t('preferences.templates.descriptionLabel')}
          </label>
          <Textarea
            value={template.description}
            onChange={e => onUpdate({ description: e.target.value })}
            placeholder={t('preferences.templates.descriptionPlaceholder')}
            disabled={readOnly}
            className="min-h-12 resize-none"
          />
        </div>

        {/* General Instructions */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            {t('preferences.templates.generalInstructionsLabel')}
          </label>
          <Textarea
            value={template.generalInstructions}
            onChange={e => onUpdate({ generalInstructions: e.target.value })}
            placeholder={t(
              'preferences.templates.generalInstructionsPlaceholder'
            )}
            disabled={readOnly}
            className="min-h-16 resize-none"
          />
        </div>

        <Separator />

        {/* Sections */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-muted-foreground">
              {t('preferences.templates.sectionsLabel')} (
              {template.sections.length})
            </label>
            {!readOnly && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={handleAddSection}
              >
                <Plus className="size-3" />
                {t('preferences.templates.addSection')}
              </Button>
            )}
          </div>

          <div className="flex flex-col gap-3">
            {template.sections.map((section, index) => (
              <SectionCard
                key={section.id}
                section={section}
                index={index}
                total={template.sections.length}
                readOnly={readOnly}
                onChange={patch => handleSectionChange(section.id, patch)}
                onMove={dir => handleMoveSection(index, dir)}
                onRemove={() => handleRemoveSection(section.id)}
              />
            ))}
          </div>
        </div>
      </div>
    </ScrollArea>
  )
}

// ---------------------------------------------------------------------------

interface SectionCardProps {
  section: TemplateSection
  index: number
  total: number
  readOnly: boolean
  onChange: (patch: Partial<TemplateSection>) => void
  onMove: (direction: -1 | 1) => void
  onRemove: () => void
}

function SectionCard({
  section,
  index,
  total,
  readOnly,
  onChange,
  onMove,
  onRemove,
}: SectionCardProps) {
  const { t } = useTranslation()

  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      {/* Section header */}
      <div className="mb-2.5 flex items-center gap-2">
        <Input
          value={section.title}
          onChange={e => onChange({ title: e.target.value })}
          placeholder={t('preferences.templates.sectionTitlePlaceholder')}
          disabled={readOnly}
          className="h-7 flex-1 text-sm font-medium"
        />

        {!readOnly && (
          <div className="flex shrink-0 items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={index === 0}
              onClick={() => onMove(-1)}
              title={t('preferences.templates.moveUp')}
            >
              <ChevronUp className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={index === total - 1}
              onClick={() => onMove(1)}
              title={t('preferences.templates.moveDown')}
            >
              <ChevronDown className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-destructive"
              onClick={onRemove}
              title={t('preferences.templates.removeSection')}
            >
              <X className="size-3.5" />
            </Button>
          </div>
        )}
      </div>

      {/* Style + Detail Level selectors */}
      <div className="mb-2.5 flex gap-3">
        <div className="flex-1 space-y-1">
          <label className="text-[11px] font-medium text-muted-foreground">
            {t('preferences.templates.styleLabel')}
          </label>
          <Select
            value={section.style}
            onValueChange={(val: SectionStyle) => onChange({ style: val })}
            disabled={readOnly}
          >
            <SelectTrigger className="h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SECTION_STYLES.map(s => (
                <SelectItem key={s} value={s} className="text-xs">
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex-1 space-y-1">
          <label className="text-[11px] font-medium text-muted-foreground">
            {t('preferences.templates.detailLevelLabel')}
          </label>
          <Select
            value={section.detail_level}
            onValueChange={(val: DetailLevel) =>
              onChange({ detail_level: val })
            }
            disabled={readOnly}
          >
            <SelectTrigger className="h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DETAIL_LEVELS.map(d => (
                <SelectItem key={d} value={d} className="text-xs">
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Instructions */}
      <div className="space-y-1">
        <label className="text-[11px] font-medium text-muted-foreground">
          {t('preferences.templates.instructionsLabel')}
        </label>
        <Textarea
          value={section.instructions}
          onChange={e => onChange({ instructions: e.target.value })}
          placeholder={t('preferences.templates.instructionsPlaceholder')}
          disabled={readOnly}
          className="min-h-20 resize-none text-xs"
        />
      </div>
    </div>
  )
}
