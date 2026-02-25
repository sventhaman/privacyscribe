import type { Template } from '@/types/templates'

/**
 * Compiles a template's general instructions and per-section instructions
 * with a raw transcript into a single system prompt for the LLM.
 */
export function buildLLMPrompt(transcript: string, template: Template): string {
  const sectionInstructions = template.sections
    .map(s => {
      const lines = [`## ${s.title}`]
      if (s.style !== 'Auto') lines.push(`Style: ${s.style}`)
      if (s.detail_level !== 'Normal')
        lines.push(`Detail Level: ${s.detail_level}`)
      if (s.instructions.trim()) lines.push(s.instructions.trim())
      return lines.join('\n')
    })
    .join('\n\n')

  const parts: string[] = []

  if (template.generalInstructions.trim()) {
    parts.push(template.generalInstructions.trim())
  }

  parts.push(
    'Below is a raw medical visit transcript. Generate a structured clinical note with the following sections:'
  )
  parts.push(sectionInstructions)
  parts.push('---\nTRANSCRIPT:')
  parts.push(transcript.trim())

  return parts.join('\n\n')
}
