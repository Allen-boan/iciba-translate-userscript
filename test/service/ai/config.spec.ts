import { normalizeAiConfig, validateAiCredentials } from '~/service/ai/config'
import { AiClientError } from '~/service/ai/errors'
import { AiConfig } from '~/service/ai/types'

const makeKey = () => `test-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`

describe('AI configuration validation', () => {
  test('normalizes a HTTPS prefix while preserving proxy and version paths', () => {
    const original = { baseUrl: '  https://API.example.com:443/proxy/v1///  ', model: '  chosen-model  ' }
    expect(normalizeAiConfig(original)).toEqual({
      baseUrl: 'https://api.example.com/proxy/v1',
      model: 'chosen-model',
    })
    expect(original.baseUrl).toBe('  https://API.example.com:443/proxy/v1///  ')
  })

  test.each([
    'http://api.example.com/v1',
    'https:api.example.com/v1',
    'file:///private/config',
    'https://account:password@example.com/v1',
    'https://api.example.com/v1?token=value',
    'https://api.example.com/v1?',
    'https://api.example.com/v1#fragment',
    'https://api.example.com/v1#',
    'https://api.example.com\\v1',
    'https://api.example.com/with space',
    'https://api.example.com/\npath',
    'https://api.example.com/chat/completions/',
    '',
  ])('rejects unsafe or ambiguous Base URL case %#', (baseUrl) => {
    expect(() => normalizeAiConfig({ baseUrl, model: 'chosen-model' })).toThrow(AiClientError)
  })

  test.each(['', '   ', 'chosen\nmodel', 'chosen\u0000model', 'm'.repeat(257)])(
    'rejects invalid model case %#',
    (model) => {
      expect(() => normalizeAiConfig({ baseUrl: 'https://api.example.com', model })).toThrow(AiClientError)
    },
  )

  test('rejects malformed runtime values using safe errors', () => {
    expect(() => normalizeAiConfig(null as unknown as AiConfig)).toThrow(AiClientError)
    expect(() => normalizeAiConfig({ baseUrl: 42 as unknown as string, model: 'chosen-model' })).toThrow(AiClientError)
  })

  test('validates a runtime-generated key without imposing provider-specific prefixes', () => {
    const apiKey = makeKey()
    expect(validateAiCredentials({
      baseUrl: 'https://api.example.com/v1/',
      model: 'chosen-model',
      apiKey: ` ${apiKey} `,
    })).toEqual({ baseUrl: 'https://api.example.com/v1', model: 'chosen-model', apiKey })
  })

  test('rejects empty, whitespace-containing and control-character keys without echoing them', () => {
    for (const apiKey of ['', `${makeKey()} ${makeKey()}`, `${makeKey()}\n`, `${makeKey()}\u0000`]) {
      let caught: unknown
      try {
        validateAiCredentials({ baseUrl: 'https://api.example.com', model: 'chosen-model', apiKey })
      } catch (error) {
        caught = error
      }
      expect(caught).toBeInstanceOf(AiClientError)
      if (apiKey) {
        expect((caught as Error).message).not.toContain(apiKey)
      }
    }
  })
})
