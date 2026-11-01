import type {
  ConsultantReviewItems,
  ReviewGeneratedItem,
  ReviewItemDecision,
  ReviewItemDecisionRecord,
  ReviewItemKind,
} from '@visaai/types'
import { apiFetch } from './client'

/**
 * Consultant review of uploaded documents and generated items. Client-safe
 * (apiFetch only). The API enforces consultant role + ACTIVE assignment on
 * every route, so nothing here is a security boundary.
 *
 *   GET  /applications/:id/review-items
 *   GET  /applications/:id/review-items/documents/:docId/url   (5-min signed URL, logged)
 *   POST /applications/:id/review-items/decisions              { itemKind, itemId, decision, note? }
 *   PUT  /applications/:id/review-items/generated/:genId       { contentMd, note? }
 */
const base = (applicationId: string) => `/applications/${applicationId}/review-items`

export const getReviewItems = (token: string, applicationId: string) =>
  apiFetch<ConsultantReviewItems>(base(applicationId), token)

export const getDocumentUrl = (token: string, applicationId: string, documentId: string) =>
  apiFetch<{ url: string; expiresIn: number }>(
    `${base(applicationId)}/documents/${documentId}/url`,
    token,
  )

export const decideReviewItem = (
  token: string,
  applicationId: string,
  input: { itemKind: ReviewItemKind; itemId: string; decision: ReviewItemDecision; note?: string },
) =>
  apiFetch<{ decision: ReviewItemDecisionRecord; notified: boolean }>(
    `${base(applicationId)}/decisions`,
    token,
    { method: 'POST', body: JSON.stringify(input) },
  )

export const editGeneratedItem = (
  token: string,
  applicationId: string,
  generatedId: string,
  contentMd: string,
  note?: string,
) =>
  apiFetch<ReviewGeneratedItem>(`${base(applicationId)}/generated/${generatedId}`, token, {
    method: 'PUT',
    body: JSON.stringify(note ? { contentMd, note } : { contentMd }),
  })
