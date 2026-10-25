import { AiClientError, getSafeAiErrorMessage } from '~/service/ai/errors'

describe('AI error privacy', () => {
  test('only exposes a known message and a valid HTTP status', () => {
    const error = new AiClientError('AUTH', 401)
    expect(error.code).toBe('AUTH')
    expect(error.status).toBe(401)
    expect(error.message).toContain('401')
    expect(new AiClientError('HTTP', 999).status).toBeUndefined()
    expect(new AiClientError('HTTP', Number.NaN).status).toBeUndefined()
  })

  test('unknown exceptions and plain objects cannot expose request data', () => {
    const privateValue = Array.from({ length: 32 }, () => Math.random().toString(36).slice(2)).join('')
    const errors = [new Error(privateValue), { message: privateValue, code: 'AUTH' }, privateValue]
    for (const error of errors) {
      expect(getSafeAiErrorMessage(error)).not.toContain(privateValue)
    }
  })

  test('does not trust a modified error message', () => {
    const error = new AiClientError('NETWORK')
    error.message = 'arbitrary remote response text'
    expect(getSafeAiErrorMessage(error)).not.toContain('arbitrary remote response text')
  })
})
