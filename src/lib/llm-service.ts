import { listen } from '@tauri-apps/api/event'
import { commands } from '@/lib/tauri-bindings'
import { buildLLMPrompt } from '@/lib/llm-prompt'
import type { LLMNoteOutput } from '@/types/llm'
import type { Note } from '@/store/notes-store'
import type { Template } from '@/types/templates'

/**
 * Generate a structured clinical note using the local LLM.
 *
 * Streams tokens via Tauri events and returns the parsed JSON output
 * once generation is complete. All listeners are properly cleaned up.
 *
 * @throws Error with 'MODEL_NOT_FOUND' if the model hasn't been downloaded
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

  // 3. Set up event listeners before starting generation
  const tokenBuffer: string[] = []

  const unlistenChunk = await listen<string>('llm-chunk', e => {
    tokenBuffer.push(e.payload)
    onToken?.(e.payload)
  })

  let unlistenDone: (() => void) | undefined
  let unlistenError: (() => void) | undefined

  try {
    const output = await new Promise<LLMNoteOutput>((resolve, reject) => {
      // Listen for completion
      listen<undefined>('llm-done', () => {
        try {
          const json = tokenBuffer.join('')
          const parsed: unknown = JSON.parse(json)

          // Validate shape matches LLMNoteOutput
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
      }).then(fn => {
        unlistenDone = fn
      })

      // Listen for errors
      listen<string>('llm-error', e => {
        reject(new Error(e.payload))
      }).then(fn => {
        unlistenError = fn
      })

      // Start generation — the Rust side will emit events
      commands.generateNoteStream(system, user).then(result => {
        if (result.status === 'error') {
          reject(new Error(result.error))
        }
      })
    })

    return output
  } finally {
    // Always clean up all listeners to prevent leaks
    unlistenChunk()
    unlistenDone?.()
    unlistenError?.()
  }
}
