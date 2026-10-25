import { AiClientError, getSafeAiErrorMessage, isAiErrorCode } from './errors'

export type ModelQueryPhase = 'validation' | 'invoke' | 'onload' | 'onerror' | 'ontimeout'
| 'onabort' | 'promise-resolution' | 'promise-rejection' | 'watchdog' | 'cancel'

type Classification = 'HTTP' | 'NETWORK' | 'TIMEOUT' | 'PERMISSION' | 'CANCELLED'
| 'UNAVAILABLE' | 'VALIDATION' | 'RESPONSE' | 'REDIRECT'

export interface ModelQueryDiagnostic {
  readonly classification: Classification
  readonly httpStatus: number | null
  readonly phase: ModelQueryPhase
  readonly elapsedMs: number
}

// Inspect a few fields in memory; never retain the source object, message, body or headers.
const field = (value: unknown, name: string): unknown => {
  try {
    return value !== null && (typeof value === 'object' || typeof value === 'function')
      ? (value as Record<string, unknown>)[name] : undefined
  } catch {
    return undefined
  }
}

const statusOf = (value: unknown): number | undefined => {
  const status = field(value, 'status')
  return typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined
}

const httpError = (status: number): AiClientError => {
  if (status === 401) return new AiClientError('AUTH', status)
  if (status === 403) return new AiClientError('FORBIDDEN', status)
  if ([404, 405, 501].includes(status)) return new AiClientError('MODELS_UNAVAILABLE', status)
  if (status === 408) return new AiClientError('TIMEOUT', status)
  if (status === 429) return new AiClientError('RATE_LIMIT', status)
  if (status >= 500) return new AiClientError('SERVER', status)
  if (status >= 300 && status < 400) return new AiClientError('REDIRECT', status)
  return new AiClientError('HTTP', status)
}

const classify = (error: AiClientError, status: number | undefined): Classification => {
  if (error.code === 'PERMISSION') return 'PERMISSION'
  if (error.code === 'CANCELLED') return 'CANCELLED'
  if (error.code === 'REDIRECT') return 'REDIRECT'
  if (status !== undefined && status >= 300) return 'HTTP'
  if (error.code === 'TIMEOUT') return 'TIMEOUT'
  if (error.code === 'UNAVAILABLE') return 'UNAVAILABLE'
  if (error.code === 'MODELS_RESPONSE') return 'RESPONSE'
  if (error.code.startsWith('INVALID_') || error.code === 'MISSING_API_KEY') return 'VALIDATION'
  return 'NETWORK'
}

const phases: ReadonlyArray<ModelQueryPhase> = ['validation', 'invoke', 'onload', 'onerror', 'ontimeout',
  'onabort', 'promise-resolution', 'promise-rejection', 'watchdog', 'cancel']
const classifications: ReadonlyArray<Classification> = ['HTTP', 'NETWORK', 'TIMEOUT', 'PERMISSION', 'CANCELLED',
  'UNAVAILABLE', 'VALIDATION', 'RESPONSE', 'REDIRECT']
const boundedElapsed = (value: unknown) => (typeof value === 'number' && Number.isFinite(value)
  ? Math.min(3600000, Math.max(0, Math.round(value))) : 0)

const format = (diagnostic: ModelQueryDiagnostic): string => {
  const rawCategory = field(diagnostic, 'classification')
  const rawPhase = field(diagnostic, 'phase')
  const category = classifications.includes(rawCategory as Classification) ? rawCategory as Classification : 'NETWORK'
  const phase = phases.includes(rawPhase as ModelQueryPhase) ? rawPhase as ModelQueryPhase : 'invoke'
  const httpStatus = statusOf({ status: field(diagnostic, 'httpStatus') }) ?? '无状态'
  return `模型列表查询失败：分类=${category}；HTTP=${httpStatus}；阶段=${phase}；耗时=${boundedElapsed(field(diagnostic, 'elapsedMs'))}ms。`
}

export class ModelQueryError extends AiClientError {
  public readonly diagnostic: Readonly<ModelQueryDiagnostic>

  public constructor(error: AiClientError, status: number | undefined, phase: ModelQueryPhase, elapsedMs: number) {
    super(error.code, status)
    this.name = 'ModelQueryError'
    this.diagnostic = Object.freeze({
      classification: classify(error, status),
      httpStatus: status ?? null,
      phase: phases.includes(phase) ? phase : 'invoke',
      elapsedMs: boundedElapsed(elapsedMs),
    })
    this.message = format(this.diagnostic)
  }
}

export const modelQueryError = (
  value: unknown,
  phase: ModelQueryPhase,
  elapsedMs: number,
  response?: unknown,
): ModelQueryError => {
  const status = statusOf(response) ?? statusOf(value)
  const ownCode = value instanceof AiClientError ? field(value, 'code') : undefined
  let error: AiClientError
  if (status !== undefined && status >= 300 && ownCode !== 'REDIRECT') {
    // A server's 403 response is HTTP evidence, not evidence of GM permission denial.
    error = httpError(status)
  } else if (isAiErrorCode(ownCode)) {
    error = new AiClientError(ownCode, status)
  } else {
    const name = field(value, 'name')
    const code = field(value, 'code')
    const rawMessage = typeof value === 'string' ? value : field(value, 'message')
    const message = typeof rawMessage === 'string' ? rawMessage.slice(0, 512) : ''
    if (name === 'SecurityError' || name === 'NotAllowedError'
      || ['PERMISSION_DENIED', 'NOT_PERMITTED', 'ERR_ACCESS_DENIED', 'EACCES'].includes(code as string)
      || /(?:permission|access)\s+denied|not\s+permitted|未授权|拒绝授权|无权访问|权限(?:不足|被拒绝)/i.test(message)) {
      error = new AiClientError('PERMISSION')
    } else if (phase === 'ontimeout' || phase === 'watchdog' || name === 'TimeoutError'
      || ['ETIMEDOUT', 'ERR_TIMEOUT', 'TIMEOUT'].includes(code as string)) {
      error = new AiClientError('TIMEOUT')
    } else if (phase === 'onabort' || name === 'AbortError' || code === 'ABORT_ERR') {
      error = new AiClientError('CANCELLED')
    } else {
      error = new AiClientError('NETWORK')
    }
  }
  return new ModelQueryError(error, status, phase, elapsedMs)
}

export const formatModelQueryError = (error: unknown): string => (
  error instanceof ModelQueryError ? format(error.diagnostic) : getSafeAiErrorMessage(error)
)
