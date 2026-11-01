-- =====================================================================
-- Auth & User Management — IAM foundation (Phase A).
-- Author: Auth module  Date: 2026-06-28
--
-- ADDITIVE / non-breaking. The existing auth model (Supabase auth.users +
-- public.users + signed app_metadata.role claim {admin|consultant|user} + the
-- RLS policies that check `app_metadata->>'role' = 'admin'`) is LEFT INTACT.
-- This migration layers a richer 6-role RBAC catalog, organizations + team
-- membership/invitations, an expanded user profile, and security/audit tables on
-- top. The NestJS IAM module maps the fine-grained roles back onto the legacy
-- {admin|consultant|user} triad so every existing guard + RLS policy keeps working.
--
-- All writes to these tables go through the SERVICE-ROLE API (RLS bypassed); the
-- policies below are defense-in-depth for the direct user-JWT path.
-- =====================================================================

-- ── roles (RBAC catalog) ──────────────────────────────────────────────
create table public.roles (
  id          uuid primary key default uuid_generate_v4(),
  key         text not null unique,                 -- stable code, e.g. 'org_admin'
  name        text not null,
  description text,
  scope       text not null default 'platform'
                check (scope in ('platform','organization')),
  is_system   boolean not null default true,        -- system roles cannot be deleted
  created_at  timestamptz not null default now()
);
alter table public.roles enable row level security;
create policy roles_public_read on public.roles for select using (true);

-- ── permissions (catalog) ─────────────────────────────────────────────
create table public.permissions (
  id          uuid primary key default uuid_generate_v4(),
  key         text not null unique,                 -- e.g. 'org.members.manage'
  description text,
  created_at  timestamptz not null default now()
);
alter table public.permissions enable row level security;
create policy permissions_public_read on public.permissions for select using (true);

-- ── role_permissions (m:n) ────────────────────────────────────────────
create table public.role_permissions (
  role_id       uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);
alter table public.role_permissions enable row level security;
create policy role_permissions_public_read on public.role_permissions for select using (true);

-- ── organizations ─────────────────────────────────────────────────────
create table public.organizations (
  id            uuid primary key default uuid_generate_v4(),
  name          text not null,
  slug          text not null unique,
  owner_user_id uuid not null references public.users on delete restrict,
  plan          text not null default 'free',
  settings      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table public.organizations enable row level security;
create index organizations_owner_idx on public.organizations (owner_user_id);

-- ── organization_members ──────────────────────────────────────────────
create table public.organization_members (
  id              uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid not null references public.users on delete cascade,
  role            text not null default 'member'
                    check (role in ('org_admin','member','consultant')),
  status          text not null default 'active'
                    check (status in ('active','suspended')),
  joined_at       timestamptz not null default now(),
  unique (organization_id, user_id)
);
alter table public.organization_members enable row level security;
create index organization_members_org_idx on public.organization_members (organization_id, status);
create index organization_members_user_idx on public.organization_members (user_id);

-- Members can read their OWN membership rows; platform admin reads all. The full
-- roster is served via the service-role API (OrganizationsService authorizes the
-- caller). Deliberately NON-recursive: a policy on organization_members must not
-- subquery organization_members (Postgres RLS would recurse — cf. the earlier
-- 20260608000003_fix_visibility_recursion migration).
create policy organization_members_self_read on public.organization_members
  for select using (
    auth.uid() = user_id
    or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

-- Organizations: members (or platform admin) can read; writes via service role.
create policy organizations_member_read on public.organizations
  for select using (
    auth.uid() = owner_user_id
    or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    or exists (
      select 1 from public.organization_members m
      where m.organization_id = organizations.id
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
  );

-- ── organization_invitations ──────────────────────────────────────────
create table public.organization_invitations (
  id              uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email           text not null,
  role            text not null default 'member'
                    check (role in ('org_admin','member','consultant')),
  token           text not null unique,             -- opaque accept token
  invited_by      uuid references public.users on delete set null,
  status          text not null default 'pending'
                    check (status in ('pending','accepted','revoked','expired')),
  expires_at      timestamptz not null,
  created_at      timestamptz not null default now(),
  accepted_at     timestamptz
);
alter table public.organization_invitations enable row level security;
create index organization_invitations_org_idx on public.organization_invitations (organization_id, status);
create index organization_invitations_email_idx on public.organization_invitations (lower(email));
-- Org members + platform admin may read invitations of their org.
create policy organization_invitations_member_read on public.organization_invitations
  for select using (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    or exists (
      select 1 from public.organization_members m
      where m.organization_id = organization_invitations.organization_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
  );

-- ── user_roles (user ↔ role, optionally org-scoped) ───────────────────
create table public.user_roles (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references public.users on delete cascade,
  role_id         uuid not null references public.roles(id) on delete restrict,
  organization_id uuid references public.organizations(id) on delete cascade,
  granted_by      uuid references public.users on delete set null,
  granted_at      timestamptz not null default now(),
  -- one grant of a role per (user, org-scope); NULL org = platform-wide grant.
  unique (user_id, role_id, organization_id)
);
alter table public.user_roles enable row level security;
create index user_roles_user_idx on public.user_roles (user_id);
create index user_roles_role_idx on public.user_roles (role_id);
create policy user_roles_self_read on public.user_roles
  for select using (
    auth.uid() = user_id
    or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

-- ── user_profiles (expanded profile; 1:1 with users) ──────────────────
create table public.user_profiles (
  user_id      uuid primary key references public.users on delete cascade,
  first_name   text,
  last_name    text,
  phone        text,
  address_line1 text,
  address_line2 text,
  city         text,
  region       text,
  postal_code  text,
  country      text,                                 -- ISO-2
  timezone     text not null default 'UTC',          -- IANA tz
  avatar_url   text,
  privacy      jsonb not null default '{}'::jsonb,   -- {profile_visibility, share_email, ...}
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table public.user_profiles enable row level security;
create policy user_profiles_owner_all on public.user_profiles
  for all using (
    auth.uid() = user_id
    or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  )
  with check (auth.uid() = user_id);

-- ── login_history (per-attempt log; user-readable own) ────────────────
create table public.login_history (
  id             uuid primary key default uuid_generate_v4(),
  user_id        uuid references public.users on delete set null,
  email          text,
  success        boolean not null,
  failure_reason text,
  ip             text,
  user_agent     text,
  created_at     timestamptz not null default now()
);
alter table public.login_history enable row level security;
create index login_history_user_idx on public.login_history (user_id, created_at desc);
create policy login_history_owner_read on public.login_history
  for select using (
    auth.uid() = user_id
    or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

-- ── auth_audit_log (security events; service-role only) ───────────────
create table public.auth_audit_log (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid references public.users on delete set null,
  actor_id    uuid references public.users on delete set null,  -- who performed it (admin grants)
  event_type  text not null,                          -- login_success|role_granted|...
  ip          text,
  user_agent  text,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
alter table public.auth_audit_log enable row level security;
create index auth_audit_log_user_idx on public.auth_audit_log (user_id, created_at desc);
create index auth_audit_log_event_idx on public.auth_audit_log (event_type, created_at desc);
-- No user policy: sensitive security log, service-role only. Platform admin reads via API.

-- ── account_lockouts (brute-force tracking; service-role only) ────────
create table public.account_lockouts (
  email          text primary key,                    -- keyed by email (pre-auth identity)
  failed_count   integer not null default 0 check (failed_count >= 0),
  locked_until   timestamptz,
  last_failed_at timestamptz,
  updated_at     timestamptz not null default now()
);
alter table public.account_lockouts enable row level security;
-- No policies: service-role only.

-- =====================================================================
-- SEED: 6 roles + permission catalog + role→permission mappings
-- =====================================================================
insert into public.roles (key, name, description, scope) values
  ('applicant',      'Applicant',          'End user preparing visa applications', 'platform'),
  ('consultant',     'Consultant',         'Immigration consultant / advisor',     'platform'),
  ('support_agent',  'Support Agent',      'Customer support, read-mostly access',  'platform'),
  ('org_admin',      'Organization Admin', 'Manages an organization + its team',    'organization'),
  ('platform_admin', 'Platform Admin',     'VisaAI staff with platform-wide admin', 'platform'),
  ('super_admin',    'Super Admin',        'Unrestricted platform owner',           'platform')
on conflict (key) do nothing;

insert into public.permissions (key, description) values
  ('profile.read',            'Read own profile'),
  ('profile.update',          'Update own profile'),
  ('application.read.own',     'Read own applications'),
  ('application.manage.own',   'Create/edit own applications'),
  ('consultant.review',        'Review assigned applications'),
  ('org.read',                 'Read organization'),
  ('org.update',               'Update organization settings'),
  ('org.members.manage',       'Add/remove/suspend org members'),
  ('org.invitations.manage',   'Send/revoke org invitations'),
  ('org.billing.manage',       'Manage org billing'),
  ('iam.users.read',           'Read user directory'),
  ('iam.roles.manage',         'Grant/revoke user roles'),
  ('audit.read',               'Read security audit logs'),
  ('support.access',           'Support tooling access'),
  ('platform.admin',           'Platform administration'),
  ('*',                        'All permissions (super admin)')
on conflict (key) do nothing;

-- Helper: map (role_key, permission_key) pairs.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from (values
  ('applicant','profile.read'),
  ('applicant','profile.update'),
  ('applicant','application.read.own'),
  ('applicant','application.manage.own'),

  ('consultant','profile.read'),
  ('consultant','profile.update'),
  ('consultant','application.read.own'),
  ('consultant','consultant.review'),

  ('support_agent','profile.read'),
  ('support_agent','profile.update'),
  ('support_agent','iam.users.read'),
  ('support_agent','support.access'),
  ('support_agent','audit.read'),

  ('org_admin','profile.read'),
  ('org_admin','profile.update'),
  ('org_admin','org.read'),
  ('org_admin','org.update'),
  ('org_admin','org.members.manage'),
  ('org_admin','org.invitations.manage'),
  ('org_admin','org.billing.manage'),

  ('platform_admin','profile.read'),
  ('platform_admin','profile.update'),
  ('platform_admin','iam.users.read'),
  ('platform_admin','iam.roles.manage'),
  ('platform_admin','audit.read'),
  ('platform_admin','support.access'),
  ('platform_admin','org.read'),
  ('platform_admin','org.update'),
  ('platform_admin','org.members.manage'),
  ('platform_admin','org.invitations.manage'),
  ('platform_admin','platform.admin'),

  ('super_admin','*')
) as m(role_key, perm_key)
join public.roles r on r.key = m.role_key
join public.permissions p on p.key = m.perm_key
on conflict do nothing;

-- Backfill: give every existing user the baseline 'applicant' platform role.
-- Additive default; their legacy app_metadata.role is unchanged + still authoritative.
insert into public.user_roles (user_id, role_id)
select u.id, r.id
from public.users u
cross join public.roles r
where r.key = 'applicant'
on conflict (user_id, role_id, organization_id) do nothing;
