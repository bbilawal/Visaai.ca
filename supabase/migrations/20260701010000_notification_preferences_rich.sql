alter table public.notification_preferences
  add column categories jsonb not null default '{}'::jsonb,  -- { "<category>": false } = opted out
  add column quiet_hours_start smallint,
  add column quiet_hours_end   smallint,
  add column timezone text,
  add column language text,
  add constraint notification_prefs_qh_start_chk
    check (quiet_hours_start is null or (quiet_hours_start between 0 and 23)),
  add constraint notification_prefs_qh_end_chk
    check (quiet_hours_end is null or (quiet_hours_end between 0 and 23));
