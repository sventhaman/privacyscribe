import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { getDb, type TemplateRow } from '@/lib/db'
import { logger } from '@/lib/logger'
import type { Template, TemplateSection } from '@/types/templates'

interface TemplatesState {
  templates: Template[]
  selectedTemplateId: string | null
  isLoading: boolean

  loadTemplates: () => Promise<void>
  selectTemplate: (id: string) => void
  createTemplate: (from?: Template) => Promise<void>
  updateTemplate: (
    id: string,
    patch: Partial<
      Pick<
        Template,
        'title' | 'description' | 'generalInstructions' | 'sections'
      >
    >
  ) => void
  deleteTemplate: (id: string) => Promise<void>
}

function rowToTemplate(row: TemplateRow): Template {
  let sections: TemplateSection[] = []
  try {
    sections = JSON.parse(row.sections)
  } catch {
    logger.warn('Failed to parse template sections JSON', { id: row.id })
  }

  return {
    id: row.id,
    isSystem: row.is_system === 1,
    title: row.title,
    description: row.description,
    generalInstructions: row.general_instructions,
    sections,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  }
}

const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()

function scheduleSave(template: Template, delayMs = 500) {
  const existing = saveTimers.get(template.id)
  if (existing) clearTimeout(existing)

  saveTimers.set(
    template.id,
    setTimeout(async () => {
      saveTimers.delete(template.id)
      try {
        const db = await getDb()
        await db.execute(
          `UPDATE templates
              SET title                = $1,
                  description          = $2,
                  general_instructions = $3,
                  sections             = $4,
                  updated_at           = $5
            WHERE id = $6`,
          [
            template.title,
            template.description,
            template.generalInstructions,
            JSON.stringify(template.sections),
            template.updatedAt.getTime(),
            template.id,
          ]
        )
        logger.debug(`Template ${template.id} saved to DB`)
      } catch (err) {
        logger.error('Failed to save template', { id: template.id, err })
      }
    }, delayMs)
  )
}

export const useTemplatesStore = create<TemplatesState>()(
  devtools(
    set => ({
      templates: [],
      selectedTemplateId: null,
      isLoading: false,

      loadTemplates: async () => {
        set({ isLoading: true }, undefined, 'loadTemplates/start')
        try {
          const db = await getDb()
          const rows = await db.select<TemplateRow[]>(
            'SELECT * FROM templates ORDER BY is_system DESC, created_at ASC'
          )
          const templates = rows.map(rowToTemplate)
          set(
            {
              templates,
              selectedTemplateId: templates[0]?.id ?? null,
              isLoading: false,
            },
            undefined,
            'loadTemplates/done'
          )
        } catch (err) {
          logger.error('Failed to load templates', { err })
          set({ isLoading: false }, undefined, 'loadTemplates/error')
        }
      },

      selectTemplate: (id: string) =>
        set({ selectedTemplateId: id }, undefined, 'selectTemplate'),

      createTemplate: async (from?: Template) => {
        const id = crypto.randomUUID()
        const now = Date.now()

        const title = from ? `${from.title} (Copy)` : 'New Template'
        const description = from?.description ?? ''
        const generalInstructions = from?.generalInstructions ?? ''
        const sections: TemplateSection[] = from
          ? from.sections.map(s => ({ ...s, id: crypto.randomUUID() }))
          : []

        try {
          const db = await getDb()
          await db.execute(
            `INSERT INTO templates
               (id, is_system, title, description, general_instructions, sections, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              id,
              0,
              title,
              description,
              generalInstructions,
              JSON.stringify(sections),
              now,
              now,
            ]
          )
        } catch (err) {
          logger.error('Failed to create template in DB', { err })
          return
        }

        const newTemplate: Template = {
          id,
          isSystem: false,
          title,
          description,
          generalInstructions,
          sections,
          createdAt: new Date(now),
          updatedAt: new Date(now),
        }

        set(
          state => ({
            templates: [...state.templates, newTemplate],
            selectedTemplateId: newTemplate.id,
          }),
          undefined,
          'createTemplate'
        )
      },

      updateTemplate: (
        id: string,
        patch: Partial<
          Pick<
            Template,
            'title' | 'description' | 'generalInstructions' | 'sections'
          >
        >
      ) => {
        set(
          state => {
            const templates = state.templates.map(tmpl => {
              if (tmpl.id !== id || tmpl.isSystem) return tmpl
              return { ...tmpl, ...patch, updatedAt: new Date() }
            })
            const updated = templates.find(t => t.id === id)
            if (updated && !updated.isSystem) scheduleSave(updated)
            return { templates }
          },
          undefined,
          'updateTemplate'
        )
      },

      deleteTemplate: async (id: string) => {
        const state = useTemplatesStore.getState()
        const target = state.templates.find(t => t.id === id)
        if (!target || target.isSystem) return

        const timer = saveTimers.get(id)
        if (timer) {
          clearTimeout(timer)
          saveTimers.delete(id)
        }

        try {
          const db = await getDb()
          await db.execute('DELETE FROM templates WHERE id = $1', [id])
        } catch (err) {
          logger.error('Failed to delete template from DB', { id, err })
          return
        }

        set(
          state => {
            const remaining = state.templates.filter(t => t.id !== id)
            const nextId =
              state.selectedTemplateId === id
                ? (remaining[0]?.id ?? null)
                : state.selectedTemplateId
            return { templates: remaining, selectedTemplateId: nextId }
          },
          undefined,
          'deleteTemplate'
        )
      },
    }),
    { name: 'templates-store' }
  )
)
