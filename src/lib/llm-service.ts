import { listen } from '@tauri-apps/api/event'
import { commands } from '@/lib/tauri-bindings'
import { buildLLMPrompt } from '@/lib/llm-prompt'
import type { LLMNoteOutput } from '@/types/llm'
import type { Note } from '@/store/notes-store'
import type { Template } from '@/types/templates'

// 2 minutes — conservative for 8B on consumer hardware
const GENERATION_TIMEOUT_MS = 120_000

/**
 * Generate a structured clinical note using the local LLM.
 *
 * Streams tokens via Tauri events and returns the parsed JSON output
 * once generation is complete. All three listeners are registered before
 * generation starts (via Promise.all) to eliminate the race window where
 * early events could arrive before listeners are active.
 *
 * @throws Error with 'MODEL_NOT_FOUND' if the model hasn't been downloaded
 * @throws Error with 'llm_timeout' if generation exceeds 2 minutes
 * @throws Error if generation fails or JSON output is invalid
 */
export async function generateNote(
  note: Note,
  template: Template,
  onToken?: (token: string) => void
): Promise<LLMNoteOutput> {
  // 1. Verify model exists
  const checkResult = await commands.checkLlmModel()
  if (checkResult.status === 'error') throw new Error(checkResult.error)
  if (!checkResult.data) throw new Error('MODEL_NOT_FOUND')

  // 2. Build system + user prompts from template and transcript
  const { system, user } = buildLLMPrompt(note.transcription, template)

  const tokenBuffer: string[] = []
  let unlistenFns: (() => void)[] = []
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  // Capture resolve/reject so listeners (registered outside the Promise) can
  // settle the promise. TypeScript non-null assertion is safe — the Promise
  // constructor runs synchronously, so both are assigned before Promise.all.
  let resolve!: (value: LLMNoteOutput) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<LLMNoteOutput>((res, rej) => {
    resolve = res
    reject = rej
  })

  const cleanup = () => {
    if (timeoutId) clearTimeout(timeoutId)
    unlistenFns.forEach(fn => fn())
    unlistenFns = []
  }

  // 3. Register ALL listeners before starting generation (eliminates race window)
  const [ul1, ul2, ul3] = await Promise.all([
    listen<string>('llm-chunk', e => {
      tokenBuffer.push(e.payload)
      onToken?.(e.payload)
    }),
    listen<undefined>('llm-done', () => {
      cleanup()
      try {
        const json = tokenBuffer.join('')
        const parsed: unknown = JSON.parse(json)
        if (
          !parsed ||
          typeof parsed !== 'object' ||
          !('title' in parsed) ||
          !('sections' in parsed) ||
          !Array.isArray((parsed as LLMNoteOutput).sections)
        ) {
          reject(new Error('Invalid LLM output shape'))
          return
        }
        resolve(parsed as LLMNoteOutput)
      } catch {
        reject(new Error('Failed to parse LLM JSON output'))
      }
    }),
    listen<string>('llm-error', e => {
      cleanup()
      reject(new Error(e.payload))
    }),
  ])
  unlistenFns = [ul1, ul2, ul3]

  // 4. Timeout starts after listeners are confirmed active
  timeoutId = setTimeout(() => {
    cleanup()
    reject(new Error('llm_timeout'))
  }, GENERATION_TIMEOUT_MS)

  // 5. Start generation — Rust side will emit events our listeners are ready for
  commands.generateNoteStream(system, user).then(result => {
    if (result.status === 'error') {
      cleanup()
      reject(new Error(result.error))
    }
  })

  return promise
}
