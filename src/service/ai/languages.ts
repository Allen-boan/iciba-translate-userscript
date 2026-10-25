export const TARGET_LANGUAGES = [
  { code: 'zh-CN', label: '简体中文', speech: 'zh-CN' },
  { code: 'en', label: '英语', speech: 'en-US' },
  { code: 'id', label: '印尼语', speech: 'id-ID' },
  { code: 'ja', label: '日语', speech: 'ja-JP' },
  { code: 'ko', label: '韩语', speech: 'ko-KR' },
  { code: 'es', label: '西班牙语', speech: 'es-ES' },
  { code: 'fr', label: '法语', speech: 'fr-FR' },
  { code: 'de', label: '德语', speech: 'de-DE' },
  { code: 'pt', label: '葡萄牙语', speech: 'pt-PT' },
  { code: 'ru', label: '俄语', speech: 'ru-RU' },
  { code: 'ar', label: '阿拉伯语', speech: 'ar-SA' },
  { code: 'th', label: '泰语', speech: 'th-TH' },
  { code: 'vi', label: '越南语', speech: 'vi-VN' },
] as const

export const DEFAULT_TARGET_LANGUAGE = 'zh-CN'

export const targetLanguage = (code?: string) => TARGET_LANGUAGES.find((language) => language.code === code) ?? TARGET_LANGUAGES[0]

// A missing/invalid model marker is unknown, never implicitly English.
export const normalizeSourceLanguage = (value: unknown): string | null => {
  if (typeof value !== 'string' || !/^[a-z]{2,3}(?:[-_][a-z0-9]{2,8})*$/i.test(value) || value.length > 48) return null
  const code = value.replace(/_/g, '-').toLowerCase()
  if (['und', 'mul', 'zxx', 'unk'].includes(code)) return null
  const aliases: Record<string, string> = { eng: 'en', ind: 'id', jpn: 'ja', kor: 'ko', spa: 'es', fra: 'fr', deu: 'de', por: 'pt', rus: 'ru', ara: 'ar', tha: 'th', vie: 'vi', zho: 'zh' }
  const parts = code.split('-')
  parts[0] = aliases[parts[0]] ?? parts[0]
  return parts.join('-')
}

export const sourceSpeechLanguage = (source: string | null): string | null => {
  const code = normalizeSourceLanguage(source)
  if (!code) return null
  const base = code.split('-')[0]
  if (base === 'en') return 'en'
  return TARGET_LANGUAGES.find((language) => language.code.split('-')[0] === base)?.speech ?? code
}
