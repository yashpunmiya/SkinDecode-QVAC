create table if not exists public.user_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  age_range text not null check (age_range in ('under_18', '18_24', '25_34', '35_44', '45_plus')),
  skin_type text not null check (skin_type in ('oily', 'dry', 'combination', 'normal', 'not_sure')),
  sensitivity text not null check (sensitivity in ('low', 'moderate', 'high', 'not_sure')),
  skin_concerns text[] not null check (
    cardinality(skin_concerns) between 1 and 3
    and skin_concerns <@ array['acne', 'dark_spots', 'redness', 'dryness', 'oiliness', 'texture', 'pores', 'fine_lines', 'dullness']::text[]
  ),
  skin_goals text[] not null check (
    cardinality(skin_goals) between 1 and 3
    and skin_goals <@ array['clear_acne', 'even_tone', 'hydrate', 'repair_barrier', 'reduce_redness', 'smooth_texture', 'anti_aging', 'maintain']::text[]
  ),
  preferences text[] not null default '{}'::text[] check (
    cardinality(preferences) <= 5
    and preferences <@ array['fragrance_free', 'vegan', 'cruelty_free', 'avoid_alcohol', 'none']::text[]
    and ('none' <> all(preferences) or preferences = array['none']::text[])
  ),
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_profiles enable row level security;

drop policy if exists "Users can read their own profile" on public.user_profiles;
create policy "Users can read their own profile"
  on public.user_profiles for select to authenticated
  using ((select auth.uid()) = id);

drop policy if exists "Users can create their own profile" on public.user_profiles;
create policy "Users can create their own profile"
  on public.user_profiles for insert to authenticated
  with check ((select auth.uid()) = id);

drop policy if exists "Users can update their own profile" on public.user_profiles;
create policy "Users can update their own profile"
  on public.user_profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

grant select, insert, update on public.user_profiles to authenticated;

create or replace function public.set_user_profiles_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_user_profiles_updated_at on public.user_profiles;
create trigger set_user_profiles_updated_at
  before update on public.user_profiles
  for each row execute function public.set_user_profiles_updated_at();
