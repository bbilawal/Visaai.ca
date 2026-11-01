import { getTranslations } from 'next-intl/server'
import type { AssignmentTimelineEvent } from '@visaai/types'
import { getAssignmentTimeline } from '@/lib/api/assignment-timeline'
import { eventDisplay, toneColor } from '@/lib/timeline-format'

const muted = 'var(--color-pale-stone, #4e4d4d)'
const ink = 'var(--color-rich-black, #242424)'
const line = 'var(--color-hairline-2, rgba(0,0,0,.15))'

/** Who performed the action (display string). */
function actorText(e: AssignmentTimelineEvent): string {
  const who = e.actor_name ?? (e.actor_id ? e.actor_id.slice(0, 8) : null)
  return who ? `${who} (${e.actor_role})` : e.actor_role
}

/** prev → new consultant transition, when present. */
function transitionText(e: AssignmentTimelineEvent): string | null {
  const prev = e.previous_consultant_name ?? e.previous_consultant_id?.slice(0, 8) ?? null
  const next = e.new_consultant_name ?? e.new_consultant_id?.slice(0, 8) ?? null
  if (prev && next) return `${prev} → ${next}`
  if (next) return `→ ${next}`
  if (prev) return `${prev} → (unassigned)`
  return null
}

/**
 * Read-only assignment lifecycle timeline. Renders the API response verbatim
 * (already filtered, ordered, and name-joined server-side). No logic here
 * beyond presentation. `limited` trims actor detail for the applicant view.
 */
export async function AssignmentTimelineViewer({
  applicationId,
  limited = false,
}: {
  applicationId: string
  limited?: boolean
}) {
  const t = await getTranslations('timeline')
  let events: AssignmentTimelineEvent[]
  try {
    events = await getAssignmentTimeline(applicationId)
  } catch {
    return (
      <p className="mono" style={{ fontSize: '0.78rem', color: muted }}>
        {t('unavailable')}
      </p>
    )
  }

  if (events.length === 0) {
    return (
      <p className="mono" style={{ fontSize: '0.78rem', color: muted }}>
        {t('noActivity')}
      </p>
    )
  }

  return (
    <ol
      aria-label={t('ariaTimeline')}
      style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 0 }}
    >
      {events.map((e, i) => {
        const d = eventDisplay(e.event_type)
        const transition = transitionText(e)
        const last = i === events.length - 1
        return (
          <li key={`${e.timestamp}-${i}`} style={{ display: 'flex', gap: 12 }}>
            {/* rail: dot + connecting line */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <span aria-hidden style={{ color: toneColor(d.tone), fontSize: 14, lineHeight: '18px' }}>
                {d.icon}
              </span>
              {!last && <span aria-hidden style={{ flex: 1, width: 1, background: line, minHeight: 18 }} />}
            </div>
            {/* content */}
            <div style={{ paddingBottom: last ? 0 : 16, minWidth: 0 }}>
              <span
                className="mono"
                style={{
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  color: toneColor(d.tone),
                  textTransform: 'uppercase',
                  letterSpacing: '0.02em',
                }}
              >
                {t(d.labelKey)}
              </span>
              {transition && (
                <div className="sans" style={{ fontSize: '0.85rem', color: ink, marginTop: 2 }}>
                  {transition}
                </div>
              )}
              {!limited && (
                <div className="mono" style={{ fontSize: '0.72rem', color: muted, marginTop: 2 }}>
                  {t('by', { actor: actorText(e) })}
                </div>
              )}
              <time
                className="mono"
                dateTime={e.timestamp}
                style={{ fontSize: '0.7rem', color: muted, display: 'block', marginTop: 2 }}
              >
                {new Date(e.timestamp).toLocaleString()}
              </time>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
