/**
 * SQLite database connection and schema management.
 *
 * All note data is stored locally on the device — never transmitted.
 * The database file lives in the platform app-data directory managed by Tauri.
 */
import Database from '@tauri-apps/plugin-sql'
import { logger } from './logger'
import type { TemplateSection } from '@/types/templates'

let _db: Database | null = null

/**
 * Returns a shared, lazily-initialised database connection.
 * Subsequent calls return the same instance.
 */
export async function getDb(): Promise<Database> {
  if (_db) return _db
  _db = await Database.load('sqlite:privacyscribe.db')
  return _db
}

/**
 * Creates all tables and runs migrations.
 * Safe to call on every app start — uses IF NOT EXISTS and try/catch guards.
 */
export async function initDb(): Promise<void> {
  const db = await getDb()

  await db.execute(`
    CREATE TABLE IF NOT EXISTS notes (
      id            TEXT PRIMARY KEY NOT NULL,
      title         TEXT NOT NULL DEFAULT '',
      subjective    TEXT NOT NULL DEFAULT '',
      objective     TEXT NOT NULL DEFAULT '',
      assessment    TEXT NOT NULL DEFAULT '',
      plan          TEXT NOT NULL DEFAULT '',
      transcription TEXT NOT NULL DEFAULT '',
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL
    )
  `)

  // Migration: add template_id FK column to notes (for LLM integration)
  try {
    await db.execute(`ALTER TABLE notes ADD COLUMN template_id TEXT`)
  } catch {
    // Column already exists — safe to ignore on subsequent starts
  }

  await db.execute(`
    CREATE TABLE IF NOT EXISTS templates (
      id                   TEXT PRIMARY KEY NOT NULL,
      is_system            INTEGER NOT NULL DEFAULT 0,
      title                TEXT NOT NULL DEFAULT '',
      description          TEXT NOT NULL DEFAULT '',
      general_instructions TEXT NOT NULL DEFAULT '',
      sections             TEXT NOT NULL DEFAULT '[]',
      created_at           INTEGER NOT NULL,
      updated_at           INTEGER NOT NULL
    )
  `)

  await seedSystemTemplates(db)

  logger.info('Database initialised')
}

// ---------------------------------------------------------------------------
// System template seeding
// ---------------------------------------------------------------------------

/**
 * Parses a prompt string that uses `## SectionTitle` headers into
 * an array of TemplateSection objects. Everything between two `## ` lines
 * (or between the last `## ` and end-of-string) becomes that section's
 * instructions.
 */
function parsePromptToSections(prompt: string): TemplateSection[] {
  const sectionRegex = /^## (.+)$/gm
  const matches: { title: string; start: number }[] = []

  let m: RegExpExecArray | null
  while ((m = sectionRegex.exec(prompt)) !== null) {
    matches.push({ title: (m[1] ?? '').trim(), start: m.index + m[0].length })
  }

  return matches.map((match, i) => {
    const next = matches[i + 1]
    const end = next ? next.start - next.title.length - 4 : prompt.length
    const instructions = prompt.slice(match.start, end).trim()

    const isBulletHeavy = (instructions.match(/^- /gm) ?? []).length > 3
    const style: TemplateSection['style'] = isBulletHeavy
      ? 'Bullet List'
      : 'Paragraph'

    return {
      id: crypto.randomUUID(),
      title: match.title,
      style,
      detail_level: 'Normal' as const,
      instructions,
    }
  })
}

interface SystemTemplateDefinition {
  id: string
  title: string
  description: string
  prompt: string
}

const SYSTEM_TEMPLATES: SystemTemplateDefinition[] = [
  {
    id: 'system-soap',
    title: 'Standard SOAP',
    description: 'Core SOAP note for daily primary care use.',
    prompt: `## Subjective
- Include chief complaint, condensed history of present illness (documenting only clinically necessary information), and relevant positive and negative findings from the review of systems (ROS).
- Prioritize clinical essence over contextual details - omit unnecessary specifics about dates, locations, durations, circumstances, administrative/logistical details and other context unless directly relevant to diagnosis or treatment.
- Exclude explanatory statements about general medical facts, mechanisms, or treatment rationales that are directed at educating the patient.
- Grouping Logic:
    - Single/Related Problems: If there is only one complaint, or multiple complaints that are (or could be) related (e.g., affect the same body system, share a timeline), write all information in a single paragraph. Do not use numbering.
    - Separate/Unrelated Problems: If the consultation clearly addresses two or more entirely separate and unrelated medical problems, split this section into numbered paragraphs. Each paragraph must have a clear one-word header.
        - Example:
            1. Cough: [Content about cough]
            2. Knee_Pain: [Content about knee pain]
- Write ONE SINGLE whitespace with no quotes around as the only text if the section contains no relevant information.

## Objective
- Include ONLY the following objective findings during THE PRESENT consultation: vital signs (with units), physical examinations and paraclinical test results.
- Begin with all observed vital signs on one line and follow with other findings.
- Document the physical examination findings following the 'Look, Feel, Move' sequence.
- Use only medical terminology and professional terms.
- Include both positive and negative findings.
- List with new lines but not with bullets or hyphens.
- Keywords to use for physical examinations if made: BP:, SpO2:, Pupils:, Oral Cavity:, Neck:, Heart:, Lungs:, Spine:, Abdomen:, Rectal Exam:, External Genitalia (Men):, Pelvic Exam:, Extremities:, Orientational Neurology:, Otoscopy:
- Only document examination findings that are explicitly described in the transcript. Do NOT use standard phrases for examinations that were merely mentioned but not actually performed or described.
- The standard phrases below are ONLY to be used when the clinician has explicitly documented the examination findings in detail. If an examination is mentioned but no findings are described, omit it entirely from this section.
<standard_phrases_on_normal_findings>
General: Good, well-oriented, cooperative.
Vitals: BP xxx/xx mmHg, pulse xx/min regular, resp xx/min, temp xx.x°C, SpO2 xx%, height xx cm, weight xx kg
Pupils: Round and equal, normal reaction to light.
Oral Cavity: Own teeth. Pale, moist, and clean mucous membranes.
Neck: No swollen/tender lymph nodes. Thyroid gland not palpably enlarged.
Spine: No pain, stiffness, or asymmetry.
Heart: Pure tones, regular rate, no murmurs. Preserved 2nd heart sound.
Lungs: Normal breath sounds, no adventitious sounds. Normal lung borders.
Abdomen: Soft and non-tender. No rebound or palpation tenderness. Liver or spleen not palpable. No palpable masses. No costovertebral angle tenderness.
Rectal Exam: Normal sphincter tone. No masses. (Men: Prostate normal size, well-defined, smooth surface, and firm elastic consistency. Preserved median sulcus.) / (Women: Uterus palpated non-tender.)
External Genitalia (Men): Unremarkable scrotum and testes.
Pelvic Exam: Vulva, vagina, and cervix unremarkable. Free adnexa. Uterus non-tender to movement. Normal discharge/blood (if menstruating). No noticeable odor.
Extremities: No edema. Warm and dry skin. Good pulse in a. dorsalis pedis bilaterally. Normal capillary refill.
Orientational Neurology: Round, equal pupils with symmetrical reaction to light. No visible facial asymmetry. H-test without nystagmus or diplopia. Normal movement of all extremities. Equal grip strength in hands.
Otoscopy: Normal conditions in the ear canal, tympanic membrane is pale with distinct landmarks and good mobility.
</standard_phrases_on_normal_findings>
- Format:
    - Vitals (Strict Order): \`BP xxx/xx mmHg, pulse xx/min, resp xx/min, temp xx.x°C, SpO2 xx%, height xx cm, weight xx kg\`
    - Exams: \`System: Description\`
    - Paraclinical test results from the current visit: \`Test: Result\`
- Write ONE SINGLE whitespace with no quotes around if no examination/test results from THIS visit.

## Assessment
- Content: Document the clinician's clinically significant assessments, diagnoses, or differential diagnoses explicitly stated in the transcript as short as possible.
- Style: Use telegraphic style. Be extremely concise. Avoid repeating information already in \`Subjective\` or \`Objective\`.
- Do not add your own interpretations or assumptions beyond what's stated in the transcript.
- Minor implied assessments are omitted - document only explicit, clinically significant statements from the transcript.
- When "Subjective" section is grouped into numbered paragraph, keep this grouping in this section as well.
- Only create numbered entries for problems that actually have an assessment. Do not create an entry for a problem from \`Subjective\` if there is no assessment for it.
- Write ONE SINGLE whitespace with no quotes around if no relevant assessments.

## Plan
- Format as a bulleted list with hyphens.
- Use active, present-tense verbs instead of nominalized phrases (e.g., "- Recommends physical therapist" instead of "- Recommendation to physical therapist"). Note that current practice is to recommend rather than refer patients to a physical therapist. Also, one does not 'order' radiological examinations — one submits a referral.
- Always document in THIS order (even if mentioned in a different order during the consultation):
  Treatments (e.g., "- Performs wound care", "- Administers steroid injection", "- Discontinues antidepressants")
  -> Diagnostics (e.g., "- Draws blood tests", "- Orders xxx")
  -> Prescriptions (e.g., "- Prescribes/Renews [medication]", "- Prescribes antibiotics")
  -> Patient education (e.g., "- Informs about", "- Advises to")
  -> Referrals (e.g., "- Refers to orthopedist", "- Recommends physical therapist")
  -> Follow-up (e.g., "- Follow-up in 2 weeks", "- Recontact upon worsening")
- Combine ALL items within each category on ONE line, separated by commas.
- When "Subjective" section is grouped into numbered paragraph, keep this grouping in this section as well.
- When grouped, still format as bulleted list with hyphens within each group.
- Write ONE SINGLE whitespace with no quotes around if no relevant information.`,
  },
  {
    id: 'system-soap-short',
    title: 'SOAP (Short)',
    description: 'Aggressively compressed shorthand note.',
    prompt: `## Subjective
- State chief complaint and essential clinical facts only. Strip all narrative, context, and backstory that doesn't directly affect diagnosis or treatment.
- Compress aggressively: use comma-separated keywords and fragments rather than flowing prose. Prefer "Cough 3 weeks, productive, yellow sputum, no fever" over longer narrative forms.
- Exclude: explanatory statements, patient education content, administrative/logistical details, circumstances, general medical facts.
- Grouping Logic:
    - Single/Related Problems: One paragraph, no numbering.
    - Separate/Unrelated Problems: Numbered paragraphs with one-word header.
        - Example:
            1. Cough: [Content]
            2. Knee_Pain: [Content]
- Write ONE SINGLE whitespace with no quotes around as the only text if the section contains no relevant information.

## Objective
- Include ONLY objective findings from THE PRESENT consultation: vital signs (with units), physical examinations and paraclinical test results.
- Begin with all observed vital signs on one line and follow with other findings.
- Document the physical examination findings following the 'Look, Feel, Move' sequence.
- Use only medical terminology and professional terms.
- Include both positive and negative findings.
- List with new lines but not with bullets or hyphens.
- Keywords to use for physical examinations if made: BP:, SpO2:, Pupils:, Oral Cavity:, Neck:, Heart:, Lungs:, Spine:, Abdomen:, Rectal Exam:, External Genitalia (Men):, Pelvic Exam:, Extremities:, Orientational Neurology:, Otoscopy:
- Only document examination findings that are explicitly described in the transcript. Do NOT use standard phrases for examinations that were merely mentioned but not actually performed or described.
- The standard phrases below are ONLY to be used when the clinician has explicitly documented the examination findings in detail. If an examination is mentioned but no findings are described, omit it entirely from this section.
<standard_phrases_on_normal_findings>
General: Good, well-oriented, cooperative.
Vitals: BP xxx/xx mmHg, pulse xx/min regular, resp xx/min, temp xx.x°C, SpO2 xx%, height xx cm, weight xx kg
Pupils: Round and equal, normal reaction to light.
Oral Cavity: Own teeth. Pale, moist, and clean mucous membranes.
Neck: No swollen/tender lymph nodes. Thyroid gland not palpably enlarged.
Spine: No pain, stiffness, or asymmetry.
Heart: Pure tones, regular rate, no murmurs. Preserved 2nd heart sound.
Lungs: Normal breath sounds, no adventitious sounds. Normal lung borders.
Abdomen: Soft and non-tender. No rebound or palpation tenderness. Liver or spleen not palpable. No palpable masses. No costovertebral angle tenderness.
Rectal Exam: Normal sphincter tone. No masses. (Men: Prostate normal size, well-defined, smooth surface, and firm elastic consistency. Preserved median sulcus.) / (Women: Uterus palpated non-tender.)
External Genitalia (Men): Unremarkable scrotum and testes.
Pelvic Exam: Vulva, vagina, and cervix unremarkable. Free adnexa. Uterus non-tender to movement. Normal discharge/blood (if menstruating). No noticeable odor.
Extremities: No edema. Warm and dry skin. Good pulse in a. dorsalis pedis bilaterally. Normal capillary refill.
Orientational Neurology: Round, equal pupils with symmetrical reaction to light. No visible facial asymmetry. H-test without nystagmus or diplopia. Normal movement of all extremities. Equal grip strength in hands.
Otoscopy: Normal conditions in the ear canal, tympanic membrane is pale with distinct landmarks and good mobility.
</standard_phrases_on_normal_findings>
- Format:
    - Vitals (Strict Order): \`BP xxx/xx mmHg, pulse xx/min, resp xx/min, temp xx.x°C, SpO2 xx%, height xx cm, weight xx kg\`
    - Exams: \`System: Description\`
    - Paraclinical test results from the current visit: \`Test: Result\`
- Write ONE SINGLE whitespace with no quotes around if no examination/test results from THIS visit.

## Assessment
- Maximum 1-2 short lines per problem. State diagnosis/differential only — no reasoning, no repetition from earlier sections.
- Style: Extreme telegraphic. Comma-separated differentials where applicable (e.g., "Susp. pneumonia, dd. bronchitis").
- Do not add your own interpretations or assumptions beyond what's stated in the transcript.
- Minor implied assessments are omitted — document only explicit, clinically significant statements.
- When "Subjective" section is grouped into numbered paragraphs, keep this grouping. Only create numbered entries for problems that actually have an assessment.
- Write ONE SINGLE whitespace with no quotes around if no relevant assessments.

## Plan
- Format as a bulleted list with hyphens.
- Use active, present-tense verbs (e.g., "- Recommends physical therapist" not "- Recommendation to physical therapist"). One does not 'order' radiological examinations — one submits a referral.
- Always document in THIS order:
  Treatments -> Diagnostics -> Prescriptions -> Patient education -> Referrals -> Follow-up
- Combine ALL items within each category on ONE line, separated by commas.
- Keep each line as short as possible. Omit obvious/implied details.
- When "Subjective" section is grouped into numbered paragraphs, keep this grouping. Still format as bulleted list with hyphens within each group.
- Write ONE SINGLE whitespace with no quotes around if no relevant information.`,
  },
  {
    id: 'system-soap-background',
    title: 'SOAP (+ Background)',
    description: 'Comprehensive general note including past medical history.',
    prompt: `## Background
- Include chronic conditions diagnosed pre-current illness, past medical/surgical history unrelated to current episode, ongoing medications for other conditions, relevant allergies, significant family/social history.
- Exclude information related to the current problem or episode of care.
- Format as a single paragraph with brief statements, using proper medical terms and abbreviations.
- Write ONE SINGLE whitespace with no quotes around as the only text if the section contains no relevant background information.

## Subjective
- Include chief complaint, condensed history of present illness (documenting only clinically necessary information), and relevant positive and negative findings from the review of systems (ROS).
- Prioritize clinical essence over contextual details - omit unnecessary specifics about dates, locations, durations, circumstances, administrative/logistical details and other context unless directly relevant to diagnosis or treatment.
- Exclude explanatory statements about general medical facts, mechanisms, or treatment rationales that are directed at educating the patient.
- Grouping Logic:
    - Single/Related Problems: If there is only one complaint, or multiple complaints that are (or could be) related (e.g., affect the same body system, share a timeline), write all information in a single paragraph. Do not use numbering.
    - Separate/Unrelated Problems: If the consultation clearly addresses two or more entirely separate and unrelated medical problems, split this section into numbered paragraphs. Each paragraph must have a clear one-word header.
        - Example:
            1. Cough: [Content about cough]
            2. Knee_Pain: [Content about knee pain]
- NEVER use bold markdown (**...**) formatting.
- Write ONE SINGLE whitespace with no quotes around as the only text if the section contains no relevant information.

## Objective
- Include ONLY the following objective findings during THE PRESENT consultation: vital signs (with units), physical examinations and paraclinical test results.
- Begin with all observed vital signs on one line and follow with other findings.
- Document the physical examination findings following the 'Look, Feel, Move' sequence.
- Use only medical terminology and professional terms.
- Include both positive and negative findings.
- List with new lines but not with bullets or hyphens.
- Keywords to use for physical examinations if made: BP:, SpO2:, Pupils:, Oral Cavity:, Neck:, Heart:, Lungs:, Spine:, Abdomen:, Rectal Exam:, External Genitalia (Men):, Pelvic Exam:, Extremities:, Orientational Neurology:, Otoscopy:
- Only document examination findings that are explicitly described in the transcript. Do NOT use standard phrases for examinations that were merely mentioned but not actually performed or described.
- The standard phrases below are ONLY to be used when the clinician has explicitly documented the examination findings in detail. If an examination is mentioned but no findings are described, omit it entirely from this section.
<standard_phrases_on_normal_findings>
General: Good, well-oriented, cooperative.
Vitals: BP xxx/xx mmHg, pulse xx/min regular, resp xx/min, temp xx.x°C, SpO2 xx%, height xx cm, weight xx kg
Pupils: Round and equal, normal reaction to light.
Oral Cavity: Own teeth. Pale, moist, and clean mucous membranes.
Neck: No swollen/tender lymph nodes. Thyroid gland not palpably enlarged.
Spine: No pain, stiffness, or asymmetry.
Heart: Pure tones, regular rate, no murmurs. Preserved 2nd heart sound.
Lungs: Normal breath sounds, no adventitious sounds. Normal lung borders.
Abdomen: Soft and non-tender. No rebound or palpation tenderness. Liver or spleen not palpable. No palpable masses. No costovertebral angle tenderness.
Rectal Exam: Normal sphincter tone. No masses. (Men: Prostate normal size, well-defined, smooth surface, and firm elastic consistency. Preserved median sulcus.) / (Women: Uterus palpated non-tender.)
External Genitalia (Men): Unremarkable scrotum and testes.
Pelvic Exam: Vulva, vagina, and cervix unremarkable. Free adnexa. Uterus non-tender to movement. Normal discharge/blood (if menstruating). No noticeable odor.
Extremities: No edema. Warm and dry skin. Good pulse in a. dorsalis pedis bilaterally. Normal capillary refill.
Orientational Neurology: Round, equal pupils with symmetrical reaction to light. No visible facial asymmetry. H-test without nystagmus or diplopia. Normal movement of all extremities. Equal grip strength in hands.
Otoscopy: Normal conditions in the ear canal, tympanic membrane is pale with distinct landmarks and good mobility.
</standard_phrases_on_normal_findings>
- Format:
    - Vitals (Strict Order): \`BP xxx/xx mmHg, pulse xx/min, resp xx/min, temp xx.x°C, SpO2 xx%, height xx cm, weight xx kg\`
    - Exams: \`System: Description\`
    - Paraclinical test results from the current visit: \`Test: Result\`
- NEVER use bold markdown (**...**) formatting.
- Write ONE SINGLE whitespace with no quotes around if no examination/test results from THIS visit.

## Assessment
- Content: Document the clinician's clinically significant assessments, diagnoses, or differential diagnoses explicitly stated in the transcript as short as possible.
- Style: Use telegraphic style. Be extremely concise. Avoid repeating information already in \`Subjective\` or \`Objective\`.
- Do not add your own interpretations or assumptions beyond what's stated in the transcript.
- Minor implied assessments are omitted - document only explicit, clinically significant statements from the transcript.
- When "Subjective" section is grouped into numbered paragraph, keep this grouping in this section as well.
- Only create numbered entries for problems that actually have an assessment. Do not create an entry for a problem from \`Subjective\` if there is no assessment for it.
- NEVER use bold markdown (**...**) formatting.
- Write ONE SINGLE whitespace with no quotes around if no relevant assessments.

## Plan
- Format as a bulleted list with hyphens.
- Use active, present-tense verbs instead of nominalized phrases (e.g., "- Recommends physical therapist" instead of "- Recommendation to physical therapist"). Note that current practice is to recommend rather than refer patients to a physical therapist. Also, one does not 'order' radiological examinations — one submits a referral.
- Always document in THIS order (even if mentioned in a different order during the consultation):
  Treatments (e.g., "- Performs wound care", "- Administers steroid injection", "- Discontinues antidepressants")
  -> Diagnostics (e.g., "- Draws blood tests", "- Orders xxx")
  -> Prescriptions (e.g., "- Prescribes/Renews [medication]", "- Prescribes antibiotics")
  -> Patient education (e.g., "- Informs about", "- Advises to")
  -> Referrals (e.g., "- Refers to orthopedist", "- Recommends physical therapist")
  -> Follow-up (e.g., "- Follow-up in 2 weeks", "- Recontact upon worsening")
- Combine ALL items within each category on ONE line, separated by commas.
- When "Subjective" section is grouped into numbered paragraph, keep this grouping in this section as well.
- When grouped, still format as bulleted list with hyphens within each group.
- NEVER use bold markdown (**...**) formatting.
- Write ONE SINGLE whitespace with no quotes around if no relevant information.`,
  },
  {
    id: 'system-soap-psychiatry',
    title: 'SOAP (Psychiatry)',
    description:
      'Advanced psychiatric note with full risk assessment and mental status exam.',
    prompt: `## Background
- Include verified psychiatric history: prior diagnoses, treatments, hospitalizations, family psychiatric history, substance use history, self-harm/suicide history, relevant somatic conditions, current medications, and significant psychosocial factors.
- Exclude information related to the current problem or episode of care — that belongs in Subjective.
- Format as a single paragraph with brief telegraphic statements using proper medical terms and abbreviations.
- NEVER use bold markdown (**...**) formatting.
- Write ONE SINGLE whitespace with no quotes around as the only text if the section contains no relevant background information.

## Subjective
- Include chief complaint, symptom progression (onset, triggers, duration, severity, frequency), and impact on daily function (sleep, appetite, energy, relationships, work).
- Document specific psychiatric symptoms: mood, anxiety, thought process, perceptions, cognition, and behavior.
- Include risk assessment details (suicidality, self-harm, harm to others) and current coping strategies, substance use, treatment adherence and response — only when explicitly discussed.
- Use patient's own words for key subjective experiences where clinically relevant.
- Prioritize clinical essence over contextual details — omit unnecessary specifics about dates, locations, circumstances, and administrative/logistical details unless directly relevant to diagnosis or treatment.
- Exclude explanatory statements about general medical facts, mechanisms, or treatment rationales that are directed at educating the patient.
- Grouping Logic:
    - Single/Related Problems: If there is only one complaint, or multiple complaints that are (or could be) related (e.g., affect the same body system, share a timeline), write all information in a single paragraph. Do not use numbering.
    - Separate/Unrelated Problems: If the consultation clearly addresses two or more entirely separate and unrelated medical problems, split this section into numbered paragraphs. Each paragraph must have a clear one-word header.
        - Example:
            1. Anxiety: [Content about anxiety]
            2. Knee_Pain: [Content about knee pain]
- NEVER use bold markdown (**...**) formatting.
- Write ONE SINGLE whitespace with no quotes around as the only text if the section contains no relevant information.

## Objective
- Include ONLY the following objective findings during THE PRESENT consultation: vital signs (with units), physical examinations, paraclinical test results, and mental status examination.
- Begin with all observed vital signs on one line and follow with other findings.
- Document the physical examination findings following the 'Look, Feel, Move' sequence.
- Write a single flowing paragraph for mental status examination (if performed). Only include domains that were explicitly assessed or described in the transcript.
- List any psychiatric rating scales or screening tool results (e.g., PHQ-9, GAD-7, MADRS, AUDIT) as separate lines with score and interpretation if stated.
- Use only medical terminology and professional terms.
- Include both positive and negative findings.
- List with new lines but not with bullets or hyphens.
- Only document examination findings that are explicitly described in the transcript. Do NOT use standard phrases for examinations that were merely mentioned but not actually performed or described.
- The standard phrases below are ONLY to be used when the clinician has explicitly documented the examination findings in detail. If an examination is mentioned but no findings are described, omit it entirely from this section.
<standard_phrases_on_normal_findings>
General: Good, well-oriented, cooperative.
Vitals: BP xxx/xx mmHg, pulse xx/min regular, resp xx/min, temp xx.x°C, SpO2 xx%, height xx cm, weight xx kg
Mental Status: Adequately dressed and groomed. Awake, clear, and oriented to time, place, and situation. Adequate eye contact. Normal psychomotor tempo. Mood described as [X], with [congruent/incongruent] affect. Normal speech fluency and volume. Coherent and goal-directed thought process. No delusions or hallucinatory experiences. No suicidal or homicidal ideations. Satisfactory insight and judgment.
Pupils: Round and equal, normal reaction to light.
Oral Cavity: Own teeth. Pale, moist, and clean mucous membranes.
Neck: No swollen/tender lymph nodes. Thyroid gland not palpably enlarged.
Spine: No pain, stiffness, or asymmetry.
Heart: Pure tones, regular rate, no murmurs. Preserved 2nd heart sound.
Lungs: Normal breath sounds, no adventitious sounds. Normal lung borders.
Abdomen: Soft and non-tender. No rebound or palpation tenderness. Liver or spleen not palpable. No palpable masses. No costovertebral angle tenderness.
Rectal Exam: Normal sphincter tone. No masses. (Men: Prostate normal size, well-defined, smooth surface, and firm elastic consistency. Preserved median sulcus.) / (Women: Uterus palpated non-tender.)
External Genitalia (Men): Unremarkable scrotum and testes.
Pelvic Exam: Vulva, vagina, and cervix unremarkable. Free adnexa. Uterus non-tender to movement. Normal discharge/blood (if menstruating). No noticeable odor.
Extremities: No edema. Warm and dry skin. Good pulse in a. dorsalis pedis bilaterally. Normal capillary refill.
Orientational Neurology: Round, equal pupils with symmetrical reaction to light. No visible facial asymmetry. H-test without nystagmus or diplopia. Normal movement of all extremities. Equal grip strength in hands.
Otoscopy: Normal conditions in the ear canal, tympanic membrane is pale with distinct landmarks and good mobility.
</standard_phrases_on_normal_findings>
- Format:
    - Vitals (Strict Order): \`BP xxx/xx mmHg, pulse xx/min, resp xx/min, temp xx.x°C, SpO2 xx%, height xx cm, weight xx kg\`
    - Mental status: \`Mental Status: [flowing paragraph]\`
    - Screening tools: \`[Tool]: [Score] — [interpretation if stated]\`
    - Exams: \`System: Description\`
    - Paraclinical test results from the current visit: \`Test: Result\`
- NEVER use bold markdown (**...**) formatting.
- Write ONE SINGLE whitespace with no quotes around if no examination/test results from THIS visit.

## Assessment
- Content: Document the clinician's clinically significant assessments, diagnoses, or differential diagnoses explicitly stated in the transcript as short as possible.
- Include diagnostic certainty level, severity assessment, and functional impact when explicitly stated.
- Document risk assessment conclusions (suicide, self-harm, violence) if performed.
- Note treatment response and contributing factors when discussed.
- Style: Use telegraphic style. Be extremely concise. Avoid repeating information already in \`Subjective\` or \`Objective\`.
- Do not add your own interpretations or assumptions beyond what's stated in the transcript.
- Minor implied assessments are omitted — document only explicit, clinically significant statements from the transcript.
- When "Subjective" section is grouped into numbered paragraphs, keep this grouping in this section as well.
- Only create numbered entries for problems that actually have an assessment. Do not create an entry for a problem from \`Subjective\` if there is no assessment for it.
- NEVER use bold markdown (**...**) formatting.
- Write ONE SINGLE whitespace with no quotes around if no relevant assessments.

## Plan
- Format as a bulleted list with hyphens.
- Use active, present-tense verbs instead of nominalized phrases (e.g., "- Adjusts sertraline to 100 mg" instead of "- Dose adjustment of sertraline"). Note that current practice is to recommend rather than refer patients to a physical therapist. Also, one does not 'order' radiological examinations — one submits a referral.
- Always document in THIS order (even if mentioned in a different order during the consultation):
  Safety measures & crisis plans (e.g., "- Creates safety plan", "- Agrees on contact upon worsening")
  -> Treatments & psychiatric interventions (e.g., "- Starts cognitive therapy", "- Discontinues antidepressants", "- Provides sleep hygiene guidance")
  -> Diagnostics (e.g., "- Draws blood tests incl. thyroid panel", "- Orders xxx")
  -> Prescriptions (e.g., "- Prescribes/Renews [medication]", "- Prescribes anxiolytics")
  -> Patient/family education (e.g., "- Informs about diagnosis and treatment options", "- Advises regular activity")
  -> Referrals (e.g., "- Refers to outpatient psychiatric clinic", "- Recommends physical therapist", "- Refers to psychologist")
  -> Follow-up (e.g., "- Follow-up in 2 weeks", "- Recontact upon worsening or suicidal thoughts")
- Combine ALL items within each category on ONE line, separated by commas.
- When "Subjective" section is grouped into numbered paragraphs, keep this grouping in this section as well.
- When grouped, still format as bulleted list with hyphens within each group.
- NEVER use bold markdown (**...**) formatting.
- Write ONE SINGLE whitespace with no quotes around if no relevant information.`,
  },
]

async function seedSystemTemplates(db: Database): Promise<void> {
  const [result] = await db.select<[{ count: number }]>(
    'SELECT COUNT(*) as count FROM templates WHERE is_system = 1'
  )
  if (result.count > 0) return

  const now = Date.now()

  for (const tmpl of SYSTEM_TEMPLATES) {
    const sections = parsePromptToSections(tmpl.prompt)
    await db.execute(
      `INSERT INTO templates
         (id, is_system, title, description, general_instructions, sections, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        tmpl.id,
        1,
        tmpl.title,
        tmpl.description,
        '',
        JSON.stringify(sections),
        now,
        now,
      ]
    )
  }

  logger.info(`Seeded ${SYSTEM_TEMPLATES.length} system templates`)
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

/**
 * Row shape returned by SELECT queries on the notes table.
 * Column names match SQLite snake_case; the store maps them to camelCase.
 */
export interface NoteRow {
  id: string
  title: string
  subjective: string
  objective: string
  assessment: string
  plan: string
  transcription: string
  template_id: string | null
  created_at: number
  updated_at: number
}

export interface TemplateRow {
  id: string
  is_system: number
  title: string
  description: string
  general_instructions: string
  sections: string
  created_at: number
  updated_at: number
}
