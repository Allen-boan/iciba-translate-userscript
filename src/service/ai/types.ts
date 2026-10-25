export interface AiConfig {
  baseUrl: string
  model: string
}

export interface AiCredentials extends AiConfig {
  apiKey: string
}

export type AiStage = 'basic' | 'detail'
export type AiTextKind = 'word' | 'phrase' | 'sentence' | 'unknown'

export interface AiMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface AiRequest {
  config: AiCredentials
  messages: ReadonlyArray<AiMessage>
  maxTokens?: number
  timeoutMs?: number
}

export interface AiCompletion {
  text: string
  finishReason: string
}

export interface AiTask {
  promise: Promise<AiCompletion>
  cancel: () => void
}
