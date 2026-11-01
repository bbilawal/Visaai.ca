-- Task 11 — Enterprise & Partner API Platform
--
-- Tenancy reuses `organizations` (20260628000000_iam_foundation). A partner IS
-- an organization with an approved partner record; there is no second tenant
-- concept.
--
-- AUTHORIZATION NOTE, stated up front because it is the most important thing
-- about this schema: partner traffic carries NO Supabase user JWT, so RLS
-- CANNOT be the authorization boundary for it. The runtime path uses the
-- service-role client and the boundary is PartnerAuthGuard + explicit
-- organization/subject filters in the repository. RLS below therefore protects
-- the *portal* path (a real user reading their own partner records) and is a
-- second line of defence, not the first. See
-- docs/partner-api/partner-api-security-review.md §2.
--
-- Secrets: API keys and access tokens are stored as SHA-256 hashes and can
-- never be recovered. Webhook signing secrets must be recoverable to sign
-- outbound payloads, so they are stored encrypted (AES-256-GCM via
-- FieldCryptoService), never in plaintext.

-- ---------------------------------------------------------------------------
-- 1. Partner (an approved organization)
-- ---------------------------------------------------------------------------
create table if not exists public.partners (
  id                uuid primary key default uuid_generate_v4(),
  organization_id   uuid not null unique references public.organizations(id) on delete cascade,
  legal_name        text not null,
  contact_email     text not null,
  website           text,
  -- Lifecycle: a partner may exist (and use sandbox) long before it is
  -- approved for live traffic. `approved` is required for live credentials.
  status            text not null default 'pending'
                      check (status in ('pending','approved','suspended','rejected')),
  tier              text not null default 'standard'
                      check (tier in ('standard','scale','enterprise')),
  -- Free-form compliance attestations (DPA signed, security questionnaire ref).
  -- Never store the documents themselves here.
  compliance        jsonb not null default '{}'::jsonb,
  status_reason     text,
  approved_at       timestamptz,
  approved_by       uuid references public.users on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists partners_status_idx on public.partners (status);

-- ---------------------------------------------------------------------------
-- 2. Partner applications (OAuth clients)
-- ---------------------------------------------------------------------------
-- One row per client. `environment` is immutable after creation: a credential
-- that could switch from sandbox to live is a production data leak waiting to
-- happen, so a partner registers two applications instead.
create table if not exists public.partner_applications (
  id                  uuid primary key default uuid_generate_v4(),
  partner_id          uuid not null references public.partners(id) on delete cascade,
  name                text not null,
  description         text,
  environment         text not null check (environment in ('sandbox','live')),
  client_id           text not null unique,
  -- Confidential clients only. Public (PKCE-only) clients have a null secret.
  client_secret_hash  text,
  client_type         text not null default 'confidential'
                        check (client_type in ('confidential','public')),
  status              text not null default 'active'
                        check (status in ('pending_review','active','suspended','revoked')),
  -- Scopes actually granted. `requested_scopes` records what was asked for so
  -- an approver can see the delta.
  scopes              text[] not null default '{}',
  requested_scopes    text[] not null default '{}',
  grant_types         text[] not null default '{client_credentials}',
  redirect_uris       text[] not null default '{}',
  -- CIDR strings, enforced in the guard. Empty array = no IP restriction.
  ip_allowlist        text[] not null default '{}',
  status_reason       text,
  created_by          uuid references public.users on delete set null,
  approved_at         timestamptz,
  approved_by         uuid references public.users on delete set null,
  revoked_at          timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists partner_applications_partner_idx
  on public.partner_applications (partner_id, environment);
create index if not exists partner_applications_client_idx
  on public.partner_applications (client_id) where revoked_at is null;

-- ---------------------------------------------------------------------------
-- 3. API keys
-- ---------------------------------------------------------------------------
-- Key format: vak_<env>_<prefix>_<secret>. Only `prefix` is stored in the
-- clear — it is the lookup handle. `key_hash` is SHA-256 of the whole key and
-- is compared in constant time. `last_four` exists so a human can recognise a
-- key in the portal without it being a credential.
create table if not exists public.partner_api_keys (
  id              uuid primary key default uuid_generate_v4(),
  application_id  uuid not null references public.partner_applications(id) on delete cascade,
  name            text not null,
  prefix          text not null unique,
  key_hash        text not null,
  last_four       text not null,
  -- A key may hold a SUBSET of the application's scopes, never a superset.
  scopes          text[] not null default '{}',
  status          text not null default 'active'
                    check (status in ('active','rotating','revoked')),
  -- Rotation: the old key stays valid until `expires_at` so the partner can
  -- deploy the new one without downtime.
  rotated_from    uuid references public.partner_api_keys(id) on delete set null,
  expires_at      timestamptz,
  last_used_at    timestamptz,
  created_by      uuid references public.users on delete set null,
  revoked_at      timestamptz,
  revoked_reason  text,
  created_at      timestamptz not null default now()
);
create index if not exists partner_api_keys_app_idx
  on public.partner_api_keys (application_id, status);

-- ---------------------------------------------------------------------------
-- 4. OAuth 2.0 access tokens (opaque, revocable)
-- ---------------------------------------------------------------------------
-- Opaque + hashed rather than self-contained JWTs, precisely so revocation is
-- real: a JWT stays valid until it expires no matter what the server thinks.
create table if not exists public.partner_access_tokens (
  id              uuid primary key default uuid_generate_v4(),
  application_id  uuid not null references public.partner_applications(id) on delete cascade,
  token_hash      text not null unique,
  scopes          text[] not null default '{}',
  grant_type      text not null check (grant_type in ('client_credentials','authorization_code')),
  -- Present only for user-consented (authorization_code) tokens.
  subject_user_id uuid references public.users on delete cascade,
  expires_at      timestamptz not null,
  revoked_at      timestamptz,
  last_used_at    timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists partner_access_tokens_app_idx
  on public.partner_access_tokens (application_id, expires_at desc);
create index if not exists partner_access_tokens_subject_idx
  on public.partner_access_tokens (subject_user_id) where subject_user_id is not null;

-- ---------------------------------------------------------------------------
-- 5. Authorization codes (Authorization Code + PKCE)
-- ---------------------------------------------------------------------------
create table if not exists public.partner_authorization_codes (
  id                    uuid primary key default uuid_generate_v4(),
  application_id        uuid not null references public.partner_applications(id) on delete cascade,
  code_hash             text not null unique,
  subject_user_id       uuid not null references public.users on delete cascade,
  scopes                text[] not null default '{}',
  redirect_uri          text not null,
  code_challenge        text not null,
  code_challenge_method text not null default 'S256' check (code_challenge_method = 'S256'),
  expires_at            timestamptz not null,
  consumed_at           timestamptz,
  created_at            timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 6. End-user consent
-- ---------------------------------------------------------------------------
-- A partner reading a user's immigration data needs that user's explicit,
-- revocable consent, recorded per scope. Revocation is a timestamp, not a
-- delete, so the record of having consented survives.
create table if not exists public.partner_user_consents (
  id              uuid primary key default uuid_generate_v4(),
  application_id  uuid not null references public.partner_applications(id) on delete cascade,
  user_id         uuid not null references public.users on delete cascade,
  scopes          text[] not null default '{}',
  granted_at      timestamptz not null default now(),
  revoked_at      timestamptz,
  unique (application_id, user_id)
);
create index if not exists partner_user_consents_user_idx
  on public.partner_user_consents (user_id) where revoked_at is null;

-- ---------------------------------------------------------------------------
-- 7. Domain events (the partner-facing event log)
-- ---------------------------------------------------------------------------
-- Produced once per business fact, then fanned out to matching endpoints. Kept
-- so a delivery can be replayed from the original payload rather than a
-- reconstruction. Payloads are MINIMAL by contract: identifiers and status,
-- never document contents or personal data.
create table if not exists public.partner_events (
  id              uuid primary key default uuid_generate_v4(),
  organization_id uuid references public.organizations(id) on delete cascade,
  subject_user_id uuid references public.users on delete cascade,
  event_type      text not null,
  resource_type   text not null,
  resource_id     uuid,
  environment     text not null default 'live' check (environment in ('sandbox','live')),
  payload         jsonb not null default '{}'::jsonb,
  -- Monotonic per organization; lets a consumer detect gaps and order events
  -- without trusting delivery order.
  sequence        bigserial,
  created_at      timestamptz not null default now()
);
create index if not exists partner_events_org_idx
  on public.partner_events (organization_id, created_at desc);
create index if not exists partner_events_type_idx
  on public.partner_events (event_type, created_at desc);

-- ---------------------------------------------------------------------------
-- 8. Webhook endpoints
-- ---------------------------------------------------------------------------
create table if not exists public.partner_webhook_endpoints (
  id                        uuid primary key default uuid_generate_v4(),
  application_id            uuid not null references public.partner_applications(id) on delete cascade,
  url                       text not null,
  description               text,
  events                    text[] not null default '{}',
  status                    text not null default 'pending_verification'
                              check (status in ('pending_verification','active','disabled')),
  -- AES-256-GCM ciphertext. Signing needs the plaintext, so this cannot be a
  -- hash; it must never be stored or logged in the clear.
  secret_encrypted          text not null,
  -- Rotation overlap: the previous secret keeps verifying until it expires.
  previous_secret_encrypted text,
  previous_secret_expires_at timestamptz,
  verification_token        text,
  verified_at               timestamptz,
  consecutive_failures      integer not null default 0,
  disabled_reason           text,
  disabled_at               timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  unique (application_id, url)
);
create index if not exists partner_webhook_endpoints_app_idx
  on public.partner_webhook_endpoints (application_id, status);

-- ---------------------------------------------------------------------------
-- 9. Webhook deliveries
-- ---------------------------------------------------------------------------
-- One row per (endpoint, event). The unique constraint IS the idempotency
-- guarantee: the same event can never be enqueued twice for one endpoint, so a
-- fan-out retry cannot double-deliver.
create table if not exists public.partner_webhook_deliveries (
  id               uuid primary key default uuid_generate_v4(),
  endpoint_id      uuid not null references public.partner_webhook_endpoints(id) on delete cascade,
  event_id         uuid not null references public.partner_events(id) on delete cascade,
  event_type       text not null,
  status           text not null default 'pending'
                     check (status in ('pending','delivering','delivered','failed','dead')),
  attempt_count    integer not null default 0,
  next_attempt_at  timestamptz not null default now(),
  last_status_code integer,
  -- Truncated, redacted response body. Never the request payload.
  last_error       text,
  duration_ms      integer,
  delivered_at     timestamptz,
  -- Set when a human or the API re-queued a dead delivery.
  replayed_from    uuid references public.partner_webhook_deliveries(id) on delete set null,
  created_at       timestamptz not null default now(),
  unique (endpoint_id, event_id)
);
create index if not exists partner_webhook_deliveries_due_idx
  on public.partner_webhook_deliveries (status, next_attempt_at)
  where status in ('pending','failed');
create index if not exists partner_webhook_deliveries_endpoint_idx
  on public.partner_webhook_deliveries (endpoint_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 10. Request log (usage + forensics, PII-free by construction)
-- ---------------------------------------------------------------------------
-- Stores the ROUTE TEMPLATE, never the resolved path: `/v1/applications/:id`
-- rather than the id, so the log cannot become a list of who applied for what.
create table if not exists public.partner_api_requests (
  id              uuid primary key default uuid_generate_v4(),
  application_id  uuid not null references public.partner_applications(id) on delete cascade,
  environment     text not null check (environment in ('sandbox','live')),
  method          text not null,
  route_template  text not null,
  api_version     text not null default 'v1',
  status_code     integer not null,
  latency_ms      integer not null,
  request_id      text not null,
  credential_kind text not null check (credential_kind in ('api_key','oauth_token')),
  credential_id   uuid,
  error_code      text,
  created_at      timestamptz not null default now()
);
create index if not exists partner_api_requests_app_idx
  on public.partner_api_requests (application_id, created_at desc);
create index if not exists partner_api_requests_request_idx
  on public.partner_api_requests (request_id);

-- ---------------------------------------------------------------------------
-- 11. Usage counters (quota enforcement)
-- ---------------------------------------------------------------------------
create table if not exists public.partner_usage_counters (
  application_id  uuid not null references public.partner_applications(id) on delete cascade,
  window_kind     text not null check (window_kind in ('minute','day','month')),
  window_start    timestamptz not null,
  count           bigint not null default 0,
  primary key (application_id, window_kind, window_start)
);

-- Atomic increment. A read-modify-write here would under-count under
-- concurrency, and an under-counted quota is an unenforced quota.
create or replace function public.increment_partner_usage(
  p_application_id uuid,
  p_window_kind    text,
  p_window_start   timestamptz,
  p_delta          bigint default 1
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  new_count bigint;
begin
  insert into public.partner_usage_counters (application_id, window_kind, window_start, count)
  values (p_application_id, p_window_kind, p_window_start, p_delta)
  on conflict (application_id, window_kind, window_start)
  do update set count = public.partner_usage_counters.count + p_delta
  returning count into new_count;
  return new_count;
end;
$$;
revoke all on function public.increment_partner_usage(uuid, text, timestamptz, bigint) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 12. Idempotency keys
-- ---------------------------------------------------------------------------
-- `request_hash` is what makes this safe: replaying a key with a DIFFERENT
-- body is a client bug and must be rejected (409), not answered with the old
-- response.
create table if not exists public.partner_idempotency_keys (
  id              uuid primary key default uuid_generate_v4(),
  application_id  uuid not null references public.partner_applications(id) on delete cascade,
  idempotency_key text not null,
  request_hash    text not null,
  route_template  text not null,
  status_code     integer,
  response_body   jsonb,
  state           text not null default 'in_progress'
                    check (state in ('in_progress','completed')),
  expires_at      timestamptz not null,
  created_at      timestamptz not null default now(),
  unique (application_id, idempotency_key)
);
create index if not exists partner_idempotency_expiry_idx
  on public.partner_idempotency_keys (expires_at);

-- ---------------------------------------------------------------------------
-- 13. Sandbox resources
-- ---------------------------------------------------------------------------
-- Sandbox data lives in its OWN table. Not a flag on the production tables —
-- a flag is one forgotten WHERE clause away from serving real applicants'
-- data to a test client.
create table if not exists public.partner_sandbox_resources (
  id              uuid primary key default uuid_generate_v4(),
  application_id  uuid not null references public.partner_applications(id) on delete cascade,
  resource_type   text not null,
  resource_key    text not null,
  data            jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (application_id, resource_type, resource_key)
);
create index if not exists partner_sandbox_resources_app_idx
  on public.partner_sandbox_resources (application_id, resource_type);

-- ---------------------------------------------------------------------------
-- RLS — portal path only (see the note at the top of this file)
-- ---------------------------------------------------------------------------
alter table public.partners                    enable row level security;
alter table public.partner_applications        enable row level security;
alter table public.partner_api_keys            enable row level security;
alter table public.partner_access_tokens       enable row level security;
alter table public.partner_authorization_codes enable row level security;
alter table public.partner_user_consents       enable row level security;
alter table public.partner_events              enable row level security;
alter table public.partner_webhook_endpoints   enable row level security;
alter table public.partner_webhook_deliveries  enable row level security;
alter table public.partner_api_requests        enable row level security;
alter table public.partner_usage_counters      enable row level security;
alter table public.partner_idempotency_keys    enable row level security;
alter table public.partner_sandbox_resources   enable row level security;

-- Members of the owning organization may read their partner record.
drop policy if exists partners_org_member_read on public.partners;
create policy partners_org_member_read on public.partners
  for select using (
    exists (
      select 1 from public.organization_members m
      where m.organization_id = partners.organization_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
  );

drop policy if exists partner_applications_org_member_read on public.partner_applications;
create policy partner_applications_org_member_read on public.partner_applications
  for select using (
    exists (
      select 1
      from public.partners p
      join public.organization_members m on m.organization_id = p.organization_id
      where p.id = partner_applications.partner_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
  );

-- Keys, endpoints, deliveries, request logs: same org-membership test, one hop
-- further out. Deliberately SELECT-only — every mutation goes through the API,
-- which audits it. There is no client-side write path to a credential.
drop policy if exists partner_api_keys_org_member_read on public.partner_api_keys;
create policy partner_api_keys_org_member_read on public.partner_api_keys
  for select using (
    exists (
      select 1
      from public.partner_applications a
      join public.partners p on p.id = a.partner_id
      join public.organization_members m on m.organization_id = p.organization_id
      where a.id = partner_api_keys.application_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
  );

drop policy if exists partner_webhook_endpoints_org_member_read on public.partner_webhook_endpoints;
create policy partner_webhook_endpoints_org_member_read on public.partner_webhook_endpoints
  for select using (
    exists (
      select 1
      from public.partner_applications a
      join public.partners p on p.id = a.partner_id
      join public.organization_members m on m.organization_id = p.organization_id
      where a.id = partner_webhook_endpoints.application_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
  );

drop policy if exists partner_webhook_deliveries_org_member_read on public.partner_webhook_deliveries;
create policy partner_webhook_deliveries_org_member_read on public.partner_webhook_deliveries
  for select using (
    exists (
      select 1
      from public.partner_webhook_endpoints e
      join public.partner_applications a on a.id = e.application_id
      join public.partners p on p.id = a.partner_id
      join public.organization_members m on m.organization_id = p.organization_id
      where e.id = partner_webhook_deliveries.endpoint_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
  );

drop policy if exists partner_api_requests_org_member_read on public.partner_api_requests;
create policy partner_api_requests_org_member_read on public.partner_api_requests
  for select using (
    exists (
      select 1
      from public.partner_applications a
      join public.partners p on p.id = a.partner_id
      join public.organization_members m on m.organization_id = p.organization_id
      where a.id = partner_api_requests.application_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
  );

-- A user sees and revokes their OWN consents. This is the only partner table a
-- non-org-member can touch, and it is the one that is about them.
drop policy if exists partner_user_consents_owner_read on public.partner_user_consents;
create policy partner_user_consents_owner_read on public.partner_user_consents
  for select using (user_id = auth.uid());

drop policy if exists partner_user_consents_owner_update on public.partner_user_consents;
create policy partner_user_consents_owner_update on public.partner_user_consents
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Secret material (key hashes, token hashes, auth codes, idempotency bodies,
-- sandbox rows, counters, raw events) has NO policy at all: RLS-enabled with
-- zero policies denies every non-service-role read. That is intentional — the
-- portal is served these through the API, filtered and redacted, never
-- directly.

-- ---------------------------------------------------------------------------
-- Permissions for the portal (RBAC, not RLS)
-- ---------------------------------------------------------------------------
insert into public.permissions (key, description) values
  ('partner.read',            'Read partner registration, applications and usage'),
  ('partner.manage',          'Create/update partner applications, keys and webhooks'),
  ('partner.approve',         'Approve partner registrations and live credentials')
on conflict (key) do nothing;

-- org_admin manages its own partner integration; platform_admin approves.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.key in ('partner.read','partner.manage')
where r.key = 'org_admin'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.key in ('partner.read','partner.manage','partner.approve')
where r.key in ('platform_admin','super_admin')
on conflict do nothing;
