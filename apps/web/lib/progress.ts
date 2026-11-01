import { computeProgress, isIntakeAnswered, requiredGenTypesForRoute, type AppProgress, type ProgressInput } from '@visaai/types'
import { createClient } from '@/lib/supabase/server'

export async function loadProgress(applicationId: string): Promise<AppProgress | null> {
  const db = await createClient()

  // `visa_type_id` is the intake's terminal output — see the intakeDone note
  // below. Without it the Intake stage reported complete on arrival.
  const { data: app } = await db
    .from('applications')
    // destination + registry visa type pick the route's required intake answers.
    .select('id, status, visa_type_id, destination_country, visa_types(visaai_id)')
    .eq('id', applicationId)
    .maybeSingle()
  if (!app) return null

  const [profile, checklist, gens, vri, prefill, session, activity] = await Promise.all([
    db.from('application_profiles').select('application_id, profile_json').eq('application_id', applicationId).maybeSingle(),
    // `meta` matters: documentsCompletion excludes items of kind 'form', and it
    // cannot do that if the column never arrives — the stage would read
    // incomplete for every application that needs a government form.
    db.from('checklist_items').select('status, required, meta').eq('application_id', applicationId),
    db.from('generated_documents').select('doc_type, approved_by_user').eq('application_id', applicationId),
    db.from('vri_scores').select('id').eq('application_id', applicationId).maybeSingle(),
    db.from('generated_documents').select('id').eq('application_id', applicationId).eq('doc_type', 'prefilled_form_json').maybeSingle(),
    db.from('submission_sessions').select('status').eq('application_id', applicationId).order('started_at', { ascending: false, nullsFirst: false }).limit(1).maybeSingle(),
    db.from('application_activity').select('last_active_at').eq('application_id', applicationId).maybeSingle(),
  ])

  const required = (checklist.data ?? []).filter((c: { required: boolean }) => c.required)
  const approvedGenTypes = (gens.data ?? [])
    .filter((g: { approved_by_user: boolean }) => g.approved_by_user)
    .map((g: { doc_type: string }) => g.doc_type)

  const appRow = app as unknown as {
    id: string
    status: ProgressInput['status']
    visa_type_id: string | null
    destination_country: string | null
    visa_types: { visaai_id: string | null } | { visaai_id: string | null }[] | null
  }
  const visaType = Array.isArray(appRow.visa_types) ? appRow.visa_types[0] : appRow.visa_types
  const pj = (profile.data as { profile_json?: unknown } | null)?.profile_json
  const profileJson =
    pj && typeof pj === 'object' && !Array.isArray(pj) ? (pj as Record<string, unknown>) : {}

  const input: ProgressInput = {
    applicationId,
    status: appRow.status,
    hasProfile: !!profile.data,
    // PROG-001: this was `!!profile.data` — the same expression as hasProfile.
    // `isComplete.intake` is `hasProfile && intakeDone`, so it collapsed to "an
    // application_profiles row exists", and that row is written as soon as the
    // interview starts. Every application therefore reported Intake COMPLETE on
    // arrival: the stage nav showed a ✓ over an unanswered interview,
    // `currentStage` skipped to documents so the next-action banner read "Upload
    // your required documents", and the documents surface then contradicted both
    // by saying "Complete the AI intake first" (it gates on the checklist, which
    // does not exist until a visa type is chosen). Every draft also sat at
    // exactly 17% — 100/6 stages — for the same reason. The intake's terminal
    // output is the chosen visa type: it is what IntakeService.rebuildChecklist
    // keys off, so it is what "done" means. Keep this in sync with the API copy
    // in apps/api/src/modules/progress/progress.service.ts.
    //
    // #2: a chosen visa type is not enough either — the dropdown sets it on
    // turn two. Done also means the route's required answers are on the
    // profile (@visaai/types intake-requirements), the same list the interview
    // completes on.
    intakeDone:
      !!profile.data &&
      !!appRow.visa_type_id &&
      isIntakeAnswered(profileJson, {
        country: appRow.destination_country,
        visaaiId: visaType?.visaai_id ?? null,
      }),
    requiredChecklist: required.map(
      (c: {
        status: ProgressInput['requiredChecklist'][number]['status']
        meta?: { kind?: string | null } | null
      }) => ({ status: c.status, meta: c.meta ?? null }),
    ),
    // The route's letters — none for Canada's eTA (@visaai/types route-letters).
    requiredGenTypes: requiredGenTypesForRoute({
      country: appRow.destination_country,
      visaaiId: visaType?.visaai_id ?? null,
    }),
    approvedGenTypes,
    hasVriScore: !!vri.data,
    hasPrefill: !!prefill.data,
    submissionStatus: session.data?.status ?? null,
    lastActiveAt: activity.data?.last_active_at ?? new Date().toISOString(),
    now: new Date().toISOString(),
  }

  return computeProgress(input)
}

export async function loadAllProgress(applicationIds: string[]): Promise<Map<string, AppProgress>> {
  const entries = await Promise.all(
    applicationIds.map(async id => [id, await loadProgress(id)] as const),
  )
  const map = new Map<string, AppProgress>()
  for (const [id, p] of entries) if (p) map.set(id, p)
  return map
}
