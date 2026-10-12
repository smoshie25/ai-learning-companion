import type { z } from 'zod'
import { AppError } from '../ai/errors.cjs'
export function assertTrustedSender(sender: { id: number; frameId: number; mainFrameId: number; url: string }, expected: { id: number; url: string }) {
  const normalize = (value: string) => { try { const url = new URL(value); url.hash = ''; return url.href } catch { return '' } }
  if (sender.id !== expected.id || sender.frameId !== sender.mainFrameId || !normalize(sender.url) || normalize(sender.url) !== normalize(expected.url)) throw new AppError('FORBIDDEN', 'This operation is only available to the application window.')
}
export function validatePayload<T>(schema: z.ZodType<T>, payload: unknown): T {
  try {
    const serialized = JSON.stringify(payload)
    if (serialized === undefined || serialized.length > 2 * 1024 * 1024) throw new Error('Payload too large')
    const parsed = schema.safeParse(payload)
    if (!parsed.success) throw new Error('Invalid shape')
    return parsed.data
  } catch { throw new AppError('VALIDATION', 'The request is invalid or exceeds the application limits.') }
}
