-- Copied from backend/supabase/migrations/005_site_content_tables.sql

create extension if not exists pgcrypto;

create table if not exists public.site_stats (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  value text not null,
  sort_order int,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.testimonials (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role text,
  quote text not null,
  rating int,
  sort_order int,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'site_stats_touch_updated_at') then
    create trigger site_stats_touch_updated_at
    before update on public.site_stats
    for each row
    execute procedure public.touch_updated_at();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'testimonials_touch_updated_at') then
    create trigger testimonials_touch_updated_at
    before update on public.testimonials
    for each row
    execute procedure public.touch_updated_at();
  end if;
end $$;

alter table public.site_stats enable row level security;
alter table public.testimonials enable row level security;

drop policy if exists "site_stats_public_read" on public.site_stats;
create policy "site_stats_public_read"
on public.site_stats
for select
to anon, authenticated
using (is_active = true);

drop policy if exists "testimonials_public_read" on public.testimonials;
create policy "testimonials_public_read"
on public.testimonials
for select
to anon, authenticated
using (is_active = true);

create index if not exists site_stats_sort_order_idx on public.site_stats (sort_order);
create index if not exists site_stats_is_active_idx on public.site_stats (is_active);
create index if not exists testimonials_sort_order_idx on public.testimonials (sort_order);
create index if not exists testimonials_is_active_idx on public.testimonials (is_active);
