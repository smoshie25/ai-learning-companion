export class AppError extends Error {
  constructor(readonly code: string, message: string) { super(message) }
}
export function safeError(error: unknown): AppError {
  if (error instanceof AppError) return error
  const name = typeof error === 'object' && error !== null && 'name' in error ? error.name : ''
  if (name === 'APIConnectionTimeoutError') return new AppError('TIMEOUT', 'OpenAI did not respond in time. Please try again.')
  if (name === 'APIConnectionError') return new AppError('NETWORK', 'OpenAI could not be reached. Check your connection and retry.')
  const status = typeof error === 'object' && error !== null && 'status' in error ? Number(error.status) : 0
  if (status === 401 || status === 403) return new AppError('AUTHENTICATION', 'OpenAI rejected the configured credentials or model access. Check the local configuration.')
  if (status === 429) return new AppError('RATE_LIMIT', 'OpenAI usage is limited. Check your API quota or try again later.')
  if (status === 404) return new AppError('MODEL_UNAVAILABLE', 'The configured model is unavailable for this API account.')
  if (status >= 500) return new AppError('SERVICE_UNAVAILABLE', 'OpenAI is temporarily unavailable. Please try again later.')
  return new AppError('REQUEST_FAILED', 'The operation could not complete. Check connectivity and try again.')
}
