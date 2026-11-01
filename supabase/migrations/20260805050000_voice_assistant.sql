-- Task 10: AI voice assistant.
--
-- Three tables, all owner-scoped by RLS. The design point worth stating: raw
-- audio is NEVER persisted. Frames live in memory for the length of one
-- utterance and are discarded after transcription. Only text is stored, and
-- only with explicit consent — see voice_consents.

-- ── voice_consents ────────────────────────────────────────────────────
-- Consent is per (user, kind, policy_version). A new policy version does NOT
-- inherit an old grant: the user agreed to different words, so the app must ask
-- again. Revocation is a row update, not a delete, so the audit trail survives.
create table if not exists public.voice_consents (
  id             uuid primary key default uuid_generate_v4(),
  user_id        uuid not null references public.users on delete cascade,
  kind           text not null check (kind in (
                   'microphone', 'transcription', 'transcript_retention', 'transcript_sharing')),
  granted        boolean not null,
  policy_version text not null,
  granted_at     timestamptz,
  revoked_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (user_id, kind, policy_version)
);
create index if not exists voice_consents_user_idx on public.voice_consents (user_id);

alter table public.voice_consents enable row level security;
create policy voice_consents_owner_all on public.voice_consents
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── voice_sessions ────────────────────────────────────────────────────
-- One row per conversation. `application_id` is optional: a user may ask
-- general questions before starting an application.
create table if not exists public.voice_sessions (
  id               uuid primary key default uuid_generate_v4(),
  user_id          uuid not null references public.users on delete cascade,
  application_id   uuid references public.applications on delete set null,
  status           text not null default 'active'
                     check (status in ('active', 'paused', 'ended', 'expired', 'failed')),
  language         text not null default 'en',
  -- Usage accumulators. Kept on the row so a limit check is one read, not an
  -- aggregate over every turn.
  audio_ms         integer not null default 0 check (audio_ms >= 0),
  tokens_used      integer not null default 0 check (tokens_used >= 0),
  cost_usd         numeric(10, 4) not null default 0 check (cost_usd >= 0),
  turn_count       integer not null default 0 check (turn_count >= 0),
  -- Why the session ended: a cost limit, inactivity, the user, or a failure.
  end_reason       text,
  escalated_to_consultation_id uuid references public.consultations on delete set null,
  started_at       timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  ended_at         timestamptz
);
create index if not exists voice_sessions_user_idx
  on public.voice_sessions (user_id, started_at desc);
-- Concurrency check: "how many live sessions does this user have?"
create index if not exists voice_sessions_active_idx
  on public.voice_sessions (user_id) where status in ('active', 'paused');
-- Daily/monthly spend rollups.
create index if not exists voice_sessions_cost_idx
  on public.voice_sessions (user_id, started_at);

alter table public.voice_sessions enable row level security;
create policy voice_sessions_owner_all on public.voice_sessions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── voice_transcript_turns ────────────────────────────────────────────
-- Text only. `redacted_text` is what may be logged or sent to analytics;
-- `text` is what the user sees and what the model received.
create table if not exists public.voice_transcript_turns (
  id               uuid primary key default uuid_generate_v4(),
  session_id       uuid not null references public.voice_sessions on delete cascade,
  user_id          uuid not null references public.users on delete cascade,
  role             text not null check (role in ('user', 'assistant', 'system')),
  text             text not null,
  redacted_text    text,
  language         text,
  -- Absent means the provider did not report confidence. NOT the same as 0.
  confidence       numeric(4, 3),
  -- Set when safety flagged the turn: prompt injection or regulated advice.
  safety_flags     text[] not null default '{}',
  audio_ms         integer,
  created_at       timestamptz not null default now()
);
create index if not exists voice_turns_session_idx
  on public.voice_transcript_turns (session_id, created_at);

alter table public.voice_transcript_turns enable row level security;
create policy voice_turns_owner_all on public.voice_transcript_turns
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Consultants must be able to read a transcript that was explicitly shared with
-- them via an escalation. Scoped to the consultation they are assigned to —
-- never to transcripts at large.
create policy voice_turns_shared_consultant_read on public.voice_transcript_turns
  for select using (
    exists (
      select 1
      from public.voice_sessions vs
      join public.consultations c on c.id = vs.escalated_to_consultation_id
      join public.consultant_profiles cp on cp.id = c.consultant_id
      where vs.id = voice_transcript_turns.session_id
        and cp.user_id = auth.uid()
    )
  );

comment on table public.voice_sessions is
  'Voice assistant sessions. Raw audio is never stored; only derived text.';
comment on column public.voice_transcript_turns.redacted_text is
  'PII-redacted copy for logs/analytics/audit. `text` keeps content the model needs.';
