export interface LLMNoteSection {
  title: string
  content: string
}

export interface LLMNoteOutput {
  title: string
  sections: LLMNoteSection[]
}
