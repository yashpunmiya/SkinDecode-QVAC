create sequence if not exists public.routine_sync_change_seq;
grant usage, select on sequence public.routine_sync_change_seq to authenticated;

alter table public.routines
  add column if not exists sync_version bigint not null default 0,
  add column if not exists change_seq bigint not null default nextval('public.routine_sync_change_seq');

alter table public.routine_steps
  add column if not exists sync_version bigint not null default 0,
  add column if not exists change_seq bigint not null default nextval('public.routine_sync_change_seq');

alter table public.routine_logs
  add column if not exists sync_version bigint not null default 0,
  add column if not exists change_seq bigint not null default nextval('public.routine_sync_change_seq');

create index if not exists routines_user_change_seq_idx
  on public.routines (user_id, change_seq);
create index if not exists routine_steps_user_change_seq_idx
  on public.routine_steps (user_id, change_seq);
create index if not exists routine_logs_user_change_seq_idx
  on public.routine_logs (user_id, change_seq);

create or replace function public.stamp_routine_sync_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.sync_version is distinct from old.sync_version then
      raise exception 'routine_sync_conflict' using errcode = '40001';
    end if;
    new.sync_version := old.sync_version + 1;
  end if;

  new.updated_at := clock_timestamp();
  new.change_seq := nextval('public.routine_sync_change_seq');
  return new;
end;
$$;

drop trigger if exists routines_sync_version on public.routines;
create trigger routines_sync_version
  before insert or update on public.routines
  for each row execute function public.stamp_routine_sync_version();

drop trigger if exists routine_steps_sync_version on public.routine_steps;
create trigger routine_steps_sync_version
  before insert or update on public.routine_steps
  for each row execute function public.stamp_routine_sync_version();

drop trigger if exists routine_logs_sync_version on public.routine_logs;
create trigger routine_logs_sync_version
  before insert or update on public.routine_logs
  for each row execute function public.stamp_routine_sync_version();
