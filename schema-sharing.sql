-- Run this ONCE in Supabase: SQL Editor -> New query -> paste -> Run.
-- Do it after schema.sql. It adds read-only share links for your manager.

-- 1) One row per share link you create
create table if not exists public.shares (
  id            bigint generated always as identity primary key,
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  token         text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  display_name  text not null default '',
  date_from     date,                -- empty = from the beginning
  date_to       date,                -- empty = up to today and beyond (new entries show up too)
  expires_at    timestamptz,         -- empty = never expires
  created_at    timestamptz not null default now()
);

alter table public.shares enable row level security;
drop policy if exists "own shares" on public.shares;
create policy "own shares" on public.shares
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- 2) The manager's page calls this. It returns ONLY the entries covered by a valid, unexpired link.
--    The manager never gets direct access to your tables.
create or replace function public.get_shared_report(p_token text)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.shares;
begin
  select * into s from public.shares
   where token = p_token and (expires_at is null or expires_at > now());
  if not found then
    return null;
  end if;

  return json_build_object(
    'name',       s.display_name,
    'date_from',  s.date_from,
    'date_to',    s.date_to,
    'expires_at', s.expires_at,
    'entries', coalesce((
      select json_agg(json_build_object(
               'id', e.id, 'title', e.title, 'category', e.category, 'description', e.description,
               'links', e.links, 'entry_date', e.entry_date, 'start_time', e.start_time,
               'end_time', e.end_time, 'duration_min', e.duration_min, 'images', e.images)
             order by e.entry_date, e.start_time nulls last, e.id)
        from public.entries e
       where e.user_id = s.user_id
         and (s.date_from is null or e.entry_date >= s.date_from)
         and (s.date_to   is null or e.entry_date <= s.date_to)
    ), '[]'::json)
  );
end;
$$;

revoke all on function public.get_shared_report(text) from public;
grant execute on function public.get_shared_report(text) to anon, authenticated;

-- 3) Lets the manager's browser load screenshots, but only those attached to entries
--    covered by an active link. Delete the link and access stops immediately.
create or replace function public.is_shared_image(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.entries e
      join public.shares s on s.user_id = e.user_id
     where p_name = any(e.images)
       and (s.expires_at is null or s.expires_at > now())
       and (s.date_from is null or e.entry_date >= s.date_from)
       and (s.date_to   is null or e.entry_date <= s.date_to)
  );
$$;

revoke all on function public.is_shared_image(text) from public;
grant execute on function public.is_shared_image(text) to anon, authenticated;

drop policy if exists "shared screenshots" on storage.objects;
create policy "shared screenshots" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'screenshots' and public.is_shared_image(name));