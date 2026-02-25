export type SectionStyle = 'Auto' | 'Bullet List' | 'Paragraph'
export type DetailLevel = 'Normal' | 'High'

export interface TemplateSection {
  id: string
  title: string
  style: SectionStyle
  detail_level: DetailLevel
  instructions: string
}

export interface Template {
  id: string
  isSystem: boolean
  title: string
  description: string
  generalInstructions: string
  sections: TemplateSection[]
  createdAt: Date
  updatedAt: Date
}

export const SECTION_STYLES: SectionStyle[] = [
  'Auto',
  'Bullet List',
  'Paragraph',
]
export const DETAIL_LEVELS: DetailLevel[] = ['Normal', 'High']
