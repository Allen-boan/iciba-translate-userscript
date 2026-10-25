const errorMessages = {
  INVALID_TARGET_LANGUAGE: '请选择支持的目标语言。',
  TRANSLATION_FORMAT: '翻译返回格式异常，请重试；未展示无法解析的语言元数据。',
  CONFIG_CHANGED: '目标语言已改变，请重新进行基础翻译后再解析。',
  INVALID_BASE_URL: '接口地址必须是有效的 HTTPS 地址，不能包含用户名、密码、查询参数或片段。',
  INVALID_MODEL: '请填写服务商支持的模型名称。',
  INVALID_API_KEY: '接口密钥格式无效，请重新输入。',
  MISSING_API_KEY: '请填写当前服务商的接口密钥。',
  MISSING_CONFIG: '请先在 AI 设置中填写接口密钥并保存。',
  KEY_ENDPOINT_CHANGED: '接口地址已改变，请重新输入对应服务商的密钥。',
  STORAGE_UNAVAILABLE: '当前脚本环境不支持 GM 存储，无法保存 AI 配置。',
  STORAGE: 'AI 配置读取或保存失败，请重试。',
  INVALID_REQUEST: 'AI 请求参数无效。',
  UNAVAILABLE: '当前脚本环境不支持 GM 跨域请求。',
  NETWORK: 'AI 请求连接失败，请检查网络以及脚本管理器的接口域名授权。',
  PERMISSION: '脚本运行环境明确拒绝了请求权限。',
  TIMEOUT: 'AI 请求超时，请稍后手动重试。',
  CANCELLED: 'AI 请求已取消。',
  AUTH: '接口密钥无效或已失效，请重新检查。',
  FORBIDDEN: '接口拒绝访问，请检查账户权限或域名授权。',
  NOT_FOUND: '接口或模型不存在，请检查服务商和模型设置。',
  QUOTA: '接口余额或配额不足，请检查账户。',
  RATE_LIMIT: '接口请求受到限制，请稍后手动重试。',
  BAD_REQUEST: '接口不接受这些请求参数，请检查模型及 Chat Completions 兼容性。',
  SERVER: 'AI 服务暂时不可用，请稍后手动重试。',
  HTTP: 'AI 接口返回了异常状态。',
  RESPONSE: '接口没有返回有效的 Chat Completions 文本回答。',
  MODELS_UNAVAILABLE: '此接口未提供可用的 /models 服务，请手动输入模型 ID。',
  MODELS_RESPONSE: '接口未返回有效的模型列表，请向服务商确认模型 ID 后手动输入。',
  REFUSED: 'AI 服务未能回答本次请求。',
  TRUNCATED: 'AI 回答达到输出上限，内容不完整。',
  REDIRECT: 'API 请求发生重定向，已拒绝使用该响应，请检查接口地址。',
}

export type AiErrorCode = keyof typeof errorMessages

export const isAiErrorCode = (value: unknown): value is AiErrorCode => typeof value === 'string' && Object.prototype.hasOwnProperty.call(errorMessages, value)


export class AiClientError extends Error {
  public readonly code: AiErrorCode

  public readonly status?: number

  public constructor(code: AiErrorCode, status?: number) {
    const safeStatus = typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599
      ? status
      : undefined
    super(`${errorMessages[code]}${safeStatus ? `（HTTP ${safeStatus}）` : ''}`)
    this.name = 'AiClientError'
    this.code = code
    this.status = safeStatus
  }
}

export const getSafeAiErrorMessage = (error: unknown) => (
  error instanceof AiClientError
    ? new AiClientError(error.code, error.status).message
    : 'AI 操作失败，请检查配置后重试。'
)
