import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { parse } from 'dotenv'
import { z } from 'zod'
import type { Workspace } from '../../shared/contracts.cjs'

const environmentSchema = z.object({
  OPENAI_API_KEY: z.string().trim().max(1000).default(''),
  OPENAI_RESPONSE_MODEL: z.string().regex(/^[a-z][a-z0-9.-]{0,79}$/).default('gpt-4.1-mini'),
  OPENAI_FOCUSED_MODEL: z.string().regex(/^[a-z][a-z0-9.-]{0,79}$/).default('gpt-4.1'),
  OPENAI_REALTIME_MODEL: z.string().regex(/^[a-z][a-z0-9.-]{0,79}$/).default('gpt-realtime'),
  OPENAI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(20000),
  OPENAI_MAX_RETRIES: z.coerce.number().int().min(0).max(3).default(2),
})
export type AIConfig = { apiKey: string; responseModel: string; focusedModel: string; realtimeModel: string; timeoutMs: number; maxRetries: number }
/** Do not export environment objects or log validation errors; they may contain credentials. */
export function loadAIConfig(root: string, development: boolean, env: NodeJS.ProcessEnv = process.env): AIConfig {
  const filename = path.join(root, 'config', 'development.env')
  const file = development && existsSync(filename) ? parse(readFileSync(filename)) : {}
  const result = environmentSchema.safeParse({ ...file, ...Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined)) })
  if (!result.success) throw new Error('Invalid local AI configuration. Check config/development.env settings.')
  const config = result.data
  if ([config.OPENAI_RESPONSE_MODEL, config.OPENAI_FOCUSED_MODEL, config.OPENAI_REALTIME_MODEL].some(model => model.startsWith('sk-') || (config.OPENAI_API_KEY && model.includes(config.OPENAI_API_KEY)))) throw new Error('Model configuration must contain a model ID, never a credential.')
  return { apiKey: config.OPENAI_API_KEY, responseModel: config.OPENAI_RESPONSE_MODEL, focusedModel: config.OPENAI_FOCUSED_MODEL, realtimeModel: config.OPENAI_REALTIME_MODEL, timeoutMs: config.OPENAI_TIMEOUT_MS, maxRetries: config.OPENAI_MAX_RETRIES }
}
export function publicProfiles(config: AIConfig): { id: Workspace['aiProfile']; label: string; model: string | null }[] {
  return [{ id: 'offline', label: 'Offline practice', model: null }, { id: 'standard', label: 'Everyday learning', model: config.responseModel }, { id: 'focused', label: 'Focused reasoning', model: config.focusedModel }]
}
