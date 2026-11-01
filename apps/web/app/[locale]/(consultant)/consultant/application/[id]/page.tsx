import { getTranslations } from 'next-intl/server'
import { getConsultantReview } from '@/lib/api/consultant'
import { serverApi } from '@/lib/api/server'
import type { Me } from '@/lib/api/me'
import { CountryFlag } from '@/components/ui/country-flag'
import { DecisionActions } from './decision-actions'
import PreflightPanel from './preflight-panel'
import ExtractedFieldsTable from './extracted-fields-table'
import ReviewItemsPanel from './review-items-panel'
import { AssignmentTimelineViewer } from '@/components/assignment/assignment-timeline-viewer'
import { createClient } from '@/lib/supabase/server'
import { ConversationThread } from '@/components/messaging/conversation-thread'

interface Props {
  params: Promise<{ id: string }>
}

/**
 * Consultant review screen. Renders the application's reviewable content
 * (summary + field values joined to approval state + documents) so the
 * consultant can decide, then the live approve/reject actions + timeline.
 * RBAC-gated by the (consultant) layout; data is re-authorized server-side
 * (active assignee or admin).
 */
export default async function ConsultantReviewPage({ params }: Props) {
  const { id } = await params
  const t = await getTranslations('consultant')

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Only an ACTIVE assignee (primary or backup) may approve, reject or decide
  // a field; the API answers 403 to anyone else, admins included. Checked for
  // every viewer: role is not the rule, and app_metadata.role misses most
  // admins. The viewer can always read their own assignment rows (RLS).
  // Unreadable → leave the buttons on; the API still decides.
  let canDecide = true
  if (user) {
    const { data, error } = await supabase
      .from('consultant_assignments')
      .select('id')
      .eq('application_id', id)
      .eq('consultant_id', user.id)
      .eq('status', 'active')
      .limit(1)
    if (!error) canDecide = (data?.length ?? 0) > 0
  }

  // The API lets an admin run the pre-submission review even when they are
  // not the assignee (assertReviewer); the role comes from GET /me, the
  // source of truth. Unreadable → treated as not admin.
  let viewerIsAdmin = false
  try {
    viewerIsAdmin = (await serverApi<Me>('/me')).appRole === 'admin'
  } catch {
    viewerIsAdmin = false
  }

  let review
  try {
    review = await getConsultantReview(id)
  } catch {
    review = null
  }

  return (
    <div>
      <h2 className="type-h3" style={{ marginBottom: 8 }}>{t('reviewHeading', { id: id.slice(0, 8) })}</h2>

      {review ? (
        <p className="mono text-muted inline-flex items-center gap-2" style={{ fontSize: '0.8rem', marginBottom: 16 }}>
          {/* Decorative: the country code is the visible text. */}
          {review.summary.destination_country && (
            <CountryFlag code={review.summary.destination_country} size="sm" />
          )}
          <span>
            {review.summary.destination_country ?? '—'} · {review.summary.status ?? '—'} ·{' '}
            {t('applicantPrefix', { email: review.summary.applicant_email ?? '—' })}
          </span>
        </p>
      ) : (
        <p className="mono text-muted" style={{ fontSize: '0.8rem', marginBottom: 16 }}>
          {t('reviewUnavailable')}
        </p>
      )}

      <DecisionActions applicationId={id} canDecide={canDecide} />

      {/* Pre-submission review. Locking this is what unblocks portal auto-fill
          for the applicant — without a completed lock the execution request has
          no trust anchor and the fill cannot start. */}
      <section style={{ marginTop: 28 }}>
        <PreflightPanel applicationId={id} canReview={canDecide || viewerIsAdmin} viewerIsAdmin={viewerIsAdmin && !canDecide} />
      </section>

      {review && (
        <>
          <section style={{ marginTop: 28 }}>
            <h3 className="type-h3" style={{ marginBottom: 12, fontSize: '1rem' }}>
              {t('fieldsHeading', { count: review.fields.length })}
            </h3>
            {review.fields.length === 0 ? (
              <p className="mono text-muted" style={{ fontSize: '0.8rem' }}>
                {t('noFields')}
              </p>
            ) : (
              <ExtractedFieldsTable applicationId={id} fields={review.fields} canDecide={canDecide} />
            )}
          </section>

        </>
      )}

      {/* Everything the applicant uploaded or the app generated: open, read,
          edit, decide. The API requires the ACTIVE assignment (or admin). */}
      <section style={{ marginTop: 28 }}>
        <h3 className="type-h3" style={{ marginBottom: 12, fontSize: '1rem' }}>Documents &amp; forms</h3>
        <ReviewItemsPanel applicationId={id} />
      </section>

      <section style={{ marginTop: 28 }}>
        <h3 className="type-h3" style={{ marginBottom: 12, fontSize: '1rem' }}>{t('assignmentTimeline')}</h3>
        <AssignmentTimelineViewer applicationId={id} />
      </section>

      <section style={{ marginTop: 28 }}>
        <h3 className="type-h3" style={{ marginBottom: 12, fontSize: '1rem' }}>Conversation</h3>
        <ConversationThread applicationId={id} currentUserId={user?.id ?? ''} viewerRole="consultant" />
      </section>
    </div>
  )
}
