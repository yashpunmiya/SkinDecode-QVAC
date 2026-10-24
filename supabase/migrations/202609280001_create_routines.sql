create table if not exists public.routines (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null default 'My skincare routine',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists routines_user_active_idx
  on public.routines (user_id, is_active) where deleted_at is null;

create table if not exists public.routine_steps (
  id text primary key,
  routine_id text not null references public.routines (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  kind text not null default 'custom',
  period text not null check (period in ('am', 'pm')),
  days_of_week smallint[] not null default array[0,1,2,3,4,5,6]::smallint[],
  frequency_per_week smallint not null default 7 check (frequency_per_week between 0 and 7),
  notes text,
  position integer not null default 0,
  enabled boolean not null default true,
  product_id uuid,
  source_scan_id uuid,
  recommendation_id uuid,
  ingredient_context jsonb,
  conflict_refs text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists routine_steps_owner_schedule_idx
  on public.routine_steps (user_id, routine_id, period, position) where deleted_at is null;

create table if not exists public.routine_logs (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  routine_id text not null references public.routines (id) on delete cascade,
  step_id text not null references public.routine_steps (id) on delete cascade,
  log_date date not null,
  period text not null check (period in ('am', 'pm')),
  status text not null check (status in ('completed', 'skipped')),
  occurred_at timestamptz not null default now(),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (user_id, step_id, log_date)
);

create index if not exists routine_logs_history_idx
  on public.routine_logs (user_id, log_date desc, period) where deleted_at is null;

alter table public.routines enable row level security;
alter table public.routine_steps enable row level security;
alter table public.routine_logs enable row level security;

drop policy if exists "Users manage their own routines" on public.routines;
create policy "Users manage their own routines"
  on public.routines for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users manage their own routine steps" on public.routine_steps;
create policy "Users manage their own routine steps"
  on public.routine_steps for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.routines
      where routines.id = routine_id and routines.user_id = (select auth.uid())
    )
  );

drop policy if exists "Users manage their own routine logs" on public.routine_logs;
create policy "Users manage their own routine logs"
  on public.routine_logs for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.routines
      where routines.id = routine_id and routines.user_id = (select auth.uid())
    )
    and exists (
      select 1 from public.routine_steps
      where routine_steps.id = step_id and routine_steps.user_id = (select auth.uid())
    )
  );

grant select, insert, update, delete on public.routines to authenticated;
grant select, insert, update, delete on public.routine_steps to authenticated;
grant select, insert, update, delete on public.routine_logs to authenticated;
