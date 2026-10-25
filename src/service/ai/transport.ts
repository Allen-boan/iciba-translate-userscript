import { AiClientError } from './errors'

export interface AiGmResponse {
  status: number
  responseText?: string
  response?: unknown
  finalUrl?: string
}

export interface AiGmRequestOptions {
  method: 'POST'
  url: string
  headers: Record<string, string>
  data: string
  anonymous: true
  redirect: 'error'
  responseType: 'text'
  timeout: number
  onload: (response: AiGmResponse) => void
  onerror: (response?: unknown) => void
  ontimeout: (response?: unknown) => void
  onabort: (response?: unknown) => void
}

export interface AiGmGetRequestOptions extends Omit<AiGmRequestOptions, 'method' | 'data'> {
  method: 'GET'
}

type AiGmRequest = (options: AiGmRequestOptions | AiGmGetRequestOptions) => unknown

export const getAiGmRequest = (): AiGmRequest => {
  if (typeof GM !== 'undefined' && GM !== null && typeof GM.xmlHttpRequest === 'function') {
    return (GM.xmlHttpRequest as unknown as AiGmRequest).bind(GM)
  }
  if (typeof GM_xmlhttpRequest === 'function') {
    return GM_xmlhttpRequest as unknown as AiGmRequest
  }
  throw new AiClientError('UNAVAILABLE')
}
