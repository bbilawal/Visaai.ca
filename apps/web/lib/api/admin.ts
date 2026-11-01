import { serverApi } from './server'
import type { AppRole } from './me'
import type {
  AdminDashboard,
  DashboardRange,
  AdminUserListResult,
  AdminUserDetail,
} from '@visaai/types'

export interface AdminUser {
  id: string
  email: string
  appRole: AppRole
}

export interface AdminUsersQuery {
  q?: string
  status?: string
  role?: string
  page?: number
  pageSize?: number
  sort?: string
}

// ── server-side only (pages) — pulls next/headers via serverApi ──
/** Paginated admin user list ({ rows, total }). */
export const getUsers = (params: AdminUsersQuery = {}) => {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') qs.set(k, String(v))
  }
  const suffix = qs.toString() ? `?${qs.toString()}` : ''
  return serverApi<AdminUserListResult>(`/admin/users${suffix}`)
}
export const getUserDetail = (id: string) =>
  serverApi<AdminUserDetail>(`/admin/users/${encodeURIComponent(id)}`)
/** All consultant users (admin assignment pickers) — unbounded, role-filtered server-side. */
export const getConsultants = () => serverApi<AdminUser[]>('/admin/consultants')
export const getAuditLogs = (applicationId?: string) =>
  serverApi<unknown[]>(`/admin/audit-logs${applicationId ? `?applicationId=${encodeURIComponent(applicationId)}` : ''}`)

/** Admin executive dashboard aggregate. */
export const getAdminDashboard = (range: DashboardRange = '30d') =>
  serverApi<AdminDashboard>(`/admin/dashboard?range=${range}`)

export interface RoleCatalogEntry {
  id: string
  key: string
  name: string
  scope: string
}

/** IAM role catalog — readable by any authenticated user. */
export const getRoleCatalog = () =>
  serverApi<RoleCatalogEntry[]>('/iam/roles')

/**
 * §74 registry operations: what is waiting for a reviewer, what failed, what is
 * stale. Read-only — promotion still goes through the migration path.
 */
export interface RegistryOpsPendingChange {
  id: string
  sourceUrl: string
  authority: string | null
  country: string | null
  classification: string
  escalationReasons: string[]
  summary: string
  addedTotal: number
  removedTotal: number
  unattributable: boolean
  detectedAt: string
}
export interface RegistryOps {
  generatedAt: string
  registry: {
    countriesTotal: number
    countriesPublishable: number
    countriesBaselineOnly: number
    visaTypesActive: number
    requirementsActive: number
    publishablePages: number
  }
  provenance: {
    requirementsWithoutProvenance: number
    activeSourceVersions: number
    versionsRetainingText: number
  }
  sources: { total: number; blocked: number; staleBeyondSla: number }
  lastRun: {
    startedAt: string | null
    sourcesChecked: number
    ok: number
    changed: number
    blocked: number
    unavailable: number
    parseErrors: number
    clientRendered: number
  } | null
  reviews: { awaiting: number; unattributable: number; items: RegistryOpsPendingChange[] }
}
export const getRegistryOps = () => serverApi<RegistryOps>('/admin/registry-ops')

// ─── Visa knowledge system (RAG) ────────────────────────────────────────────

export interface KnowledgeStatus {
  storage: {
    blob_count?: number
    blob_logical_bytes?: number
    blob_stored_bytes?: number
    chunk_count?: number
    distinct_chunk_texts?: number
    embedding_count?: number
    embedding_models?: number
    distinct_chunk_chars?: number
    naive_chunk_chars?: number
    chunkTextDeduplicationRatio: number
    blobCompressionRatio: number
  }
  jobs: Record<string, number>
  quarantine: { open: number; byReason: Record<string, number> }
  review: {
    open: number
    bySeverity: Record<string, number>
    byKind: Record<string, number>
  }
  recentSyncRuns: Array<{
    id: string
    started_at: string | null
    finished_at: string | null
    status: string
    sources_checked: number
    changed_count: number
    blocked_count: number
  }>
}

export interface KnowledgeCoverageRow {
  countryCode: string
  countryName: string
  visaTypeName: string | null
  visaTypeSlug: string | null
  sourceCount: number
  indexedSourceCount: number
  chunkCount: number
  embeddedChunkCount: number
  lastCheckedAt: string | null
  staleSourceCount: number
}

export interface KnowledgeCoverage {
  generatedAt: string
  supportedCountries: number
  supportedVisaTypes: number
  visaTypesWithSources: number
  visaTypesWithChunks: number
  visaTypesWithoutAnySource: Array<{ country: string; visaType: string; slug: string }>
  visaTypesWithSourcesButNoChunks: Array<{ country: string; visaType: string; slug: string }>
  countriesWithoutAnySource: string[]
  rows: KnowledgeCoverageRow[]
  totals: {
    sources: number
    indexedSources: number
    chunks: number
    embeddedChunks: number
    staleSources: number
  }
}

export interface KnowledgeReviewItem {
  id: string
  kind: string
  severity: string
  title: string
  detail: string | null
  state: string
  occurrences: number
  last_seen_at: string
}

/**
 * Knowledge-system operations. Read-only in the UI for the same reason the
 * registry screen is: re-ingestion and gap resolution both go through paths
 * that assert their own preconditions, and a one-click button here would turn
 * the review queue back into decoration.
 */
export const getKnowledgeStatus = () => serverApi<KnowledgeStatus>('/admin/knowledge/status')
export const getKnowledgeCoverage = () => serverApi<KnowledgeCoverage>('/admin/knowledge/coverage')
export const getKnowledgeReview = () =>
  serverApi<{ total: number; items: KnowledgeReviewItem[] }>('/admin/knowledge/review?limit=25')
