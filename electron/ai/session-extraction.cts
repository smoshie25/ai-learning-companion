import { intelligenceSummarySchema, liveInsightsSchema, type Segment } from '../../shared/session-contracts.cjs'
import { AppError } from './errors.cjs'
/** Evidence must quote received, finalized transcript text; never accept invented or partial evidence. */
export function validateEvidence<T extends { evidence: { segmentId: string; quote: string }[] }>(items: T[], segments: Segment[]) {
  for (const item of items) for (const evidence of item.evidence) {
    const segment = segments.find(segment => segment.id === evidence.segmentId)
    if (!segment || segment.status !== 'final' || !segment.text.includes(evidence.quote)) throw new AppError('INVALID_EVIDENCE', 'The AI summary contained an unverified transcript excerpt. Your transcript is saved; retry the summary.')
  }
  return items
}
export function validateSessionSummary(input: unknown, segments: Segment[]) {
  const value = intelligenceSummarySchema.parse(input)
  validateEvidence(value.actions, segments)
  return value
}
export function validateLiveInsights(input: unknown, segments: Segment[]) {
  const value = liveInsightsSchema.parse(input)
  validateEvidence(value.highlights, segments)
  return value
}
