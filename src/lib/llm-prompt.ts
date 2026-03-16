import type { Template } from '@/types/templates'

export interface LLMPrompt {
  system: string
  user: string
}

/**
 * Compiles a template's instructions and a raw transcript into
 * separate system and user prompts for the LLM.
 *
 * The system prompt establishes the medical scribe role, output format
 * (JSON matching LLMNoteOutput), and section instructions.
 * The user prompt contains the transcript only.
 */
export function buildLLMPrompt(
  transcript: string,
  template: Template
): LLMPrompt {
  const sectionList = template.sections
    .map(s => {
      const lines = [`## ${s.title}`]
      if (s.style !== 'Auto') lines.push(`Style: ${s.style}`)
      if (s.detail_level !== 'Normal')
        lines.push(`Detail Level: ${s.detail_level}`)
      if (s.instructions.trim()) lines.push(s.instructions.trim())
      return lines.join('\n')
    })
    .join('\n\n')

  const systemParts = [
    'You are an expert medical scribe. Convert the transcript into a structured clinical note.',
    '',
    'RULES:',
    '- Be concise and clinically precise.',
    '- Use standard medical abbreviations (BP, HR, RX, PMHx, etc.).',
    '- Never invent information not present in the transcript.',
    '- If a section has no relevant information, write a single whitespace as its content.',
    '- Output ONLY valid JSON — no markdown, no preamble, no explanation.',
    '',
    'OUTPUT FORMAT (strict JSON):',
    '{"title":"<visit title, max 6 words>","sections":[{"title":"<section name>","content":"<clinical content>"}]}',
    '',
    'REQUIRED SECTIONS (generate exactly these, in this order):',
    sectionList,
  ]

  if (template.generalInstructions.trim()) {
    systemParts.push('')
    systemParts.push('ADDITIONAL INSTRUCTIONS:')
    systemParts.push(template.generalInstructions.trim())
  }

  // Final rule appended last — recency bias helps small models weight this heavily
  systemParts.push('')
  systemParts.push(
    '⛔ FINAL RULE: Every word you write must come directly from the transcript.'
  )
  systemParts.push(
    'If a section has no transcript evidence, its content MUST be exactly one space character " ".'
  )
  systemParts.push(
    'Do NOT use medical defaults, assumptions, or fill-in phrases. Transcribe only — never invent.'
  )

  return {
    system: systemParts.join('\n'),
    user: `TRANSCRIPT:\n${transcript.trim()}`,
  }
}
