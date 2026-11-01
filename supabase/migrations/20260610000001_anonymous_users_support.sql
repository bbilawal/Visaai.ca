-- Anonymous (guest) user support.
--
-- The public intake funnel signs guests in anonymously: auth.users.email is NULL
-- until they upgrade. public.users.email was NOT NULL and the on_auth_user_created
-- trigger inserts new.email, so an anonymous sign-in would FAIL at the trigger
-- (null into a not-null column). Allow null, and keep public.users in sync when
-- the email is later set during the in-place upgrade (updateUser / linkIdentity).

-- 1. A guest has no email yet.
alter table public.users alter column email drop not null;

-- 2. Keep public.users in sync after an anonymous -> permanent upgrade (or any
--    email/profile change on auth.users). handle_new_user only fires on INSERT,
--    so without this the row would keep its original (null) email after upgrade.
create or replace function public.handle_user_identity_sync()
returns trigger as $$
begin
  if new.email is distinct from old.email
     or new.raw_user_meta_data is distinct from old.raw_user_meta_data then
    update public.users
      set email = new.email,
          full_name = coalesce(new.raw_user_meta_data->>'full_name', full_name)
      where id = new.id;
  end if;
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_identity_updated
  after update on auth.users
  for each row execute function public.handle_user_identity_sync();
