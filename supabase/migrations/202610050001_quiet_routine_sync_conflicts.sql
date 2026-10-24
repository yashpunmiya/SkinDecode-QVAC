-- A stale optimistic write is an expected sync outcome, not a database fault.
-- Skip that row without raising SQLSTATE 40001; the client detects the missing
-- RETURNING row and reconciles against the current cloud snapshot.
create or replace function public.stamp_routine_sync_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.sync_version is distinct from old.sync_version then
      return null;
    end if;
    new.sync_version := old.sync_version + 1;
  end if;

  new.updated_at := clock_timestamp();
  new.change_seq := nextval('public.routine_sync_change_seq');
  return new;
end;
$$;
