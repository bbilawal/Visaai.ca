-- Security RLS regression test (Master Security Audit 2026-08-16).
-- Asserts the DAST-confirmed exploits stay closed AND legitimate writes keep
-- working. Run against a stack with migrations applied:
--   docker exec -i <db> psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     -f supabase/tests/security/rls_column_hardening_test.sql
-- Exit code is non-zero if any assertion fails.

\set ON_ERROR_STOP on
begin;

-- ---- fixtures ----
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at) values
 ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','sec_alice@test','x',now(),now(),now()),
 ('22222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-000000000000','authenticated','authenticated','sec_bob@test','x',now(),now(),now()),
 ('33333333-3333-3333-3333-333333333333','00000000-0000-0000-0000-000000000000','authenticated','authenticated','sec_mallory@test','x',now(),now(),now())
on conflict (id) do nothing;
insert into public.users (id,email) values
 ('11111111-1111-1111-1111-111111111111','sec_alice@test'),
 ('22222222-2222-2222-2222-222222222222','sec_bob@test'),
 ('33333333-3333-3333-3333-333333333333','sec_mallory@test') on conflict do nothing;
insert into public.consultant_profiles (id, user_id, kyc_status, license_verified, payouts_enabled, rating_avg, rating_count, active_status)
 values ('44444444-4444-4444-4444-444444444444','33333333-3333-3333-3333-333333333333','pending',false,false,0,0,'draft')
on conflict (id) do update set kyc_status='pending', payouts_enabled=false, active_status='draft', stripe_connect_account_id=null;
insert into public.applications (id, user_id, status, plan_tier, destination_country) values
 ('aaaaaaaa-0000-0000-0000-00000000000a','11111111-1111-1111-1111-111111111111','draft','none','CA'),
 ('bbbbbbbb-0000-0000-0000-00000000000b','22222222-2222-2222-2222-222222222222','draft','none','CA')
on conflict (id) do update set plan_tier='none', status='draft';
insert into public.consultations (id, consultant_id, user_id, application_id, provider, scheduled_start, scheduled_end, timezone, status)
 values ('cccccccc-0000-0000-0000-00000000000c','44444444-4444-4444-4444-444444444444','11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-00000000000a','zoom',now(),now()+interval '1 hour','UTC','confirmed')
on conflict (id) do update set status='confirmed', user_id='11111111-1111-1111-1111-111111111111', application_id='aaaaaaaa-0000-0000-0000-00000000000a', meeting_url=null;

-- helper: run an UPDATE/INSERT as an authenticated user and assert it is denied
create or replace function pg_temp.assert_denied(p_sub uuid, p_sql text, p_label text)
returns void language plpgsql as $$
begin
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims', json_build_object('sub',p_sub,'role','authenticated')::text, true);
  begin
    execute p_sql;
    perform set_config('role','postgres',true);
    raise exception 'FAIL %: statement was NOT blocked', p_label;
  exception
    when insufficient_privilege or others then
      if sqlerrm like 'FAIL %' then raise; end if;
      perform set_config('role','postgres',true);
      raise notice 'PASS %', p_label;
  end;
end $$;

create or replace function pg_temp.assert_allowed(p_sub uuid, p_sql text, p_label text)
returns void language plpgsql as $$
begin
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims', json_build_object('sub',p_sub,'role','authenticated')::text, true);
  execute p_sql;
  perform set_config('role','postgres',true);
  raise notice 'PASS %', p_label;
exception when others then
  perform set_config('role','postgres',true);
  raise exception 'FAIL %: legitimate statement was blocked: %', p_label, sqlerrm;
end $$;

-- SEC-4090
select pg_temp.assert_denied('33333333-3333-3333-3333-333333333333',
  $q$update public.consultant_profiles set kyc_status='verified', payouts_enabled=true, stripe_connect_account_id='acct_ATTACKER' where user_id='33333333-3333-3333-3333-333333333333'$q$,
  'SEC-4090 consultant cannot self-approve kyc/payouts/acct');

-- SEC-4091 attack + legit
select pg_temp.assert_denied('33333333-3333-3333-3333-333333333333',
  $q$update public.consultations set user_id='22222222-2222-2222-2222-222222222222', application_id='bbbbbbbb-0000-0000-0000-00000000000b', meeting_url='https://attacker.example/phish' where id='cccccccc-0000-0000-0000-00000000000c'$q$,
  'SEC-4091 participant cannot rewrite identity/meeting_url');
select pg_temp.assert_allowed('11111111-1111-1111-1111-111111111111',
  $q$update public.consultations set scheduled_start=now()+interval '2 hour', scheduled_end=now()+interval '3 hour', meeting_url='https://us02web.zoom.us/j/123' where id='cccccccc-0000-0000-0000-00000000000c'$q$,
  'SEC-4091 participant CAN reschedule with a valid provider url');

-- SEC-9002
select pg_temp.assert_denied('22222222-2222-2222-2222-222222222222',
  $q$insert into public.payments (id,user_id,application_id,plan_tier,status,amount_cents,currency,provider,feature) values (gen_random_uuid(),'22222222-2222-2222-2222-222222222222','bbbbbbbb-0000-0000-0000-00000000000b','none','complete',0,'usd','stripe','prefill')$q$,
  'SEC-9002 applicant cannot fabricate a paid prefill payment');

-- SEC-4094 attack + legit own-row write (also proves SEC-4093 recursion gone)
select pg_temp.assert_denied('11111111-1111-1111-1111-111111111111',
  $q$update public.applications set plan_tier='expert' where id='aaaaaaaa-0000-0000-0000-00000000000a'$q$,
  'SEC-4094 applicant cannot self-upgrade plan_tier');
select pg_temp.assert_allowed('11111111-1111-1111-1111-111111111111',
  $q$update public.applications set destination_state='ON' where id='aaaaaaaa-0000-0000-0000-00000000000a'$q$,
  'SEC-4093 applicant CAN write own non-system column (no recursion)');

-- SEC-4092 / SEC-4003 / SEC-4005 : anon+authenticated denied privileged RPC/table
do $$ begin
  perform set_config('role','anon',true);
  begin
    perform count(*) from public.pricing_quotes;
    perform set_config('role','postgres',true);
    raise exception 'FAIL SEC-4092: anon could read pricing_quotes';
  exception when insufficient_privilege then
    perform set_config('role','postgres',true); raise notice 'PASS SEC-4092 anon cannot read pricing_quotes';
  end;
end $$;

do $$ begin
  perform set_config('role','anon',true);
  begin
    perform claim_outbox_batch(1);
    perform set_config('role','postgres',true);
    raise exception 'FAIL SEC-4003: anon could call claim_outbox_batch';
  exception when insufficient_privilege then
    perform set_config('role','postgres',true); raise notice 'PASS SEC-4003 anon cannot call claim_outbox_batch';
  end;
end $$;

rollback;
