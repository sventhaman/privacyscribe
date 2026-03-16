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
 * The user prompt wraps the transcript in XML tags for clear data boundaries.
 */
export function buildLLMPrompt(
  transcript: string,
  template: Template
): LLMPrompt {
  const sectionInstructions = template.sections
    .map(s => {
      const lines = [`## ${s.title}`]
      if (s.instructions.trim()) lines.push(s.instructions.trim())
      return lines.join('\n')
    })
    .join('\n\n')

  const systemParts = [
    'You are an expert medical scribe. Convert the transcript into a structured clinical note.',
    '',
    'OUTPUT FORMAT (strict JSON):',
    '{"title":"<max 6 words>","sections":[{"title":"<section name>","content":"<clinical content>"},...]}',
    '',
    'RULES:',
    '- Only include a section if the transcript contains relevant information for it. Omit sections with no content.',
    '- Every word must come from the transcript. Never invent, assume, or add defaults.',
    '- Output ONLY valid JSON — no markdown, no preamble.',
    '',
    'EXAMPLE 1 (visit with no physical exam — Objective omitted):',
    '{"title":"Migraine Follow-up","sections":[{"title":"Subjective","content":"Chronic migraines, 2x/week, responds to sumatriptan."},{"title":"Assessment","content":"Chronic migraine, controlled."},{"title":"Plan","content":"- Continue sumatriptan PRN\\n- Follow-up 3 months"}]}',
    '',
    'EXAMPLE 2 (visit with exam findings — Objective included):',
    '{"title":"HTN Follow-up","sections":[{"title":"Subjective","content":"Reports occasional headaches, compliant with lisinopril."},{"title":"Objective","content":"BP 148/92 mmHg, HR 78/min, SpO2 97%."},{"title":"Assessment","content":"Hypertension, suboptimally controlled."},{"title":"Plan","content":"- Increase lisinopril to 20mg daily\\n- Recheck BP in 4 weeks"}]}',
    '',
    'SECTION INSTRUCTIONS:',
    sectionInstructions,
  ]

  if (template.generalInstructions.trim()) {
    systemParts.push('')
    systemParts.push(template.generalInstructions.trim())
  }

  return {
    system: systemParts.join('\n'),
    user: `<transcript>\n${transcript.trim()}\n</transcript>`,
  }
}
