// Client-safe feedback API. MUST NOT import ./server (next/headers):
// this module is imported by 'use client' components.
import { apiFetch } from './client'

export type FeedbackKind =
  | 'bug'
  | 'feature_request'
  | 'satisfaction'
  | 'ai_response'
  | 'consultant'
  | 'other'

export interface SubmitFeedbackBody {
  kind: FeedbackKind
  rating?: number | null
  message?: string
  surface: 'web' | 'ios' | 'android' | 'extension'
  appVersion?: string
  applicationId?: string | null
  diagnosticsConsent?: boolean
  screenshotPath?: string | null
  device?: Record<string, string | number | boolean>
}

export interface SubmittedFeedback {
  id: string
  kind: FeedbackKind
  status: string
  created_at: string
}

/**
 * Non-identifying browser metadata for a bug report.
 *
 * Deliberately excludes anything that would make this a tracking surface: no
 * user agent (the server takes that from the request header, where it is at
 * least honest), no timezone, no fingerprinting-grade signals. Screen size and
 * locale are what actually help reproduce a layout or formatting bug; the
 * server drops anything not on its own allowlist regardless.
 */
export function collectDeviceMetadata(): Record<string, string | number | boolean> {
  if (typeof window === 'undefined') return {}
  return {
    platform: 'web',
    screen_width: window.innerWidth,
    screen_height: window.innerHeight,
    locale: navigator.language,
  }
}

export function submitFeedback(
  token: string,
  body: SubmitFeedbackBody,
  route?: string,
): Promise<SubmittedFeedback> {
  return apiFetch<SubmittedFeedback>('/feedback', token, {
    method: 'POST',
    // Server-trusted context: the API reads the route from this header rather
    // than the body, so it cannot be forged into another user's context.
    headers: route ? { 'x-visaai-route': route } : undefined,
    body: JSON.stringify(body),
  })
}

export interface MyFeedback {
  id: string
  kind: FeedbackKind
  rating: number | null
  message: string
  surface: string
  status: string
  resolution: string | null
  created_at: string
  resolved_at: string | null
}

export function fetchMyFeedback(token: string): Promise<MyFeedback[]> {
  return apiFetch<MyFeedback[]>('/feedback/mine', token)
}
