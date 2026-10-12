import type { z } from 'zod'
import { AppError } from './errors.cjs'

type ResponseShape = { status?: string; output_text?: string; output?: { type?: string; content?: { type?: string; text?: string; refusal?: string }[] }[] }
export function parseText(response: ResponseShape): string {
  if (response.output?.some(item => item.content?.some(content => content.type === 'refusal'))) throw new AppError('REFUSED', 'The AI could not help with this request. Try another learning question.')
  if (response.status !== 'completed') throw new AppError('INCOMPLETE_RESPONSE', 'The AI response was incomplete. Please try a shorter request.')
  const text = response.output_text || response.output?.flatMap(item => item.type === 'message' ? item.content?.filter(content => content.type === 'output_text').map(content => content.text ?? '') ?? [] : []).join('')
  if (!text?.trim() || text.length > 12000) throw new AppError('INVALID_RESPONSE', 'The AI response was empty or too large.')
  return text
}
export function parseStructured<T>(response: ResponseShape, schema: z.ZodType<T>): T {
  const text = parseText(response)
  try { return schema.parse(JSON.parse(text)) } catch { throw new AppError('INVALID_RESPONSE', 'The AI returned an unexpected response format. Please try again.') }
}
