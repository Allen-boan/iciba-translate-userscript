import { AiClientError } from './errors'
import { normalizeSourceLanguage } from './languages'

export interface ParsedTranslation {
  text: string
  sourceLanguage: string | null
}

export const parseBasicTranslation = (value: string): ParsedTranslation => {
  let text = value.trim()
  if (!text || text.length > 1000000) throw new AiClientError('TRANSLATION_FORMAT')
  const fenced = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i.exec(text)
  if (fenced) text = fenced[1].trim()
  if (text.startsWith('{')) {
    let data: unknown
    try { data = JSON.parse(text) as unknown } catch { throw new AiClientError('TRANSLATION_FORMAT') }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new AiClientError('TRANSLATION_FORMAT')
    const record = data as Record<string, unknown>
    if (typeof record.translation !== 'string' || !record.translation.trim()) throw new AiClientError('TRANSLATION_FORMAT')
    return { text: record.translation.trim(), sourceLanguage: normalizeSourceLanguage(record.sourceLanguage) }
  }
  // Legacy/plain-text compatible endpoints may ignore the JSON instruction.
  // Do not show an envelope, a partial envelope or metadata as a translation.
  if (fenced || text.startsWith('[') || text.startsWith('}')
    || /```|<\/?(?:translation|source[_-]?language|language)\b|["']?(?:sourceLanguage|source_language|detectedLanguage|language|lang|translation)["']?\s*[:=]|^(?:detected|source)\s+language\b|(?:源语言|原文语言|目标语言|译文)\s*[:：]/im.test(text)) {
    throw new AiClientError('TRANSLATION_FORMAT')
  }
  return { text, sourceLanguage: null }
}
