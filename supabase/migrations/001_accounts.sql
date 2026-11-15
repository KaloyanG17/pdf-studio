-- Accounts, cloud library and usage quotas for PDF Studio.
-- Every table has row-level security: the browser (anon key + user JWT) can only reach the
-- signed-in user's own rows; plan and usage changes happen only on the server (service role).

-- ── Profiles: one per user, created by trigger on sign-up ──────────────────────────────────
create table if not exists public.profiles (
  id                     uuid primary key references auth.users on delete cascade,
  email                  text,
  plan                   text not null default 'free' check (plan in ('free', 'pro')),
  stripe_customer_id     text unique,
  stripe_subscription_id text,
  subscription_status    text,
  current_period_end     timestamptz,
  created_at             timestamptz not null default now()
);
alter table public.profiles enable row level security;
drop policy if exists "profiles: read own" on public.profiles;
create policy "profiles: read own" on public.profiles for select using (auth.uid() = id);
-- No insert/update policies: the plan can't be changed from the browser.

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email) on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── Cloud library: document metadata here, content in the private "documents" bucket ──────
create table if not exists public.documents (
  user_id      uuid not null default auth.uid() references auth.users on delete cascade,
  id           text not null,
  name         text not null,
  page_count   int  not null default 0,
  thumb        text not null default '',
  tags         text[] not null default '{}',
  source_count int  not null default 1,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (user_id, id)
);
alter table public.documents enable row level security;

-- Free accounts keep up to 3 documents in the cloud; Pro is unlimited.
create or replace function public.can_add_document() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select plan = 'pro' from profiles where id = auth.uid()), false)
      or (select count(*) from documents where user_id = auth.uid()) < 3
$$;

drop policy if exists "documents: read own" on public.documents;
drop policy if exists "documents: add own within plan" on public.documents;
drop policy if exists "documents: update own" on public.documents;
drop policy if exists "documents: delete own" on public.documents;
create policy "documents: read own" on public.documents for select using (auth.uid() = user_id);
create policy "documents: add own within plan" on public.documents for insert
  with check (auth.uid() = user_id and public.can_add_document());
create policy "documents: update own" on public.documents for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "documents: delete own" on public.documents for delete using (auth.uid() = user_id);

insert into storage.buckets (id, name, public, file_size_limit)
values ('documents', 'documents', false, 52428800)
on conflict (id) do nothing;

-- Objects live under "<user id>/<document id>/…": a user only reaches their own folder.
drop policy if exists "documents bucket: own folder read" on storage.objects;
drop policy if exists "documents bucket: own folder write" on storage.objects;
drop policy if exists "documents bucket: own folder update" on storage.objects;
drop policy if exists "documents bucket: own folder delete" on storage.objects;
create policy "documents bucket: own folder read" on storage.objects for select
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "documents bucket: own folder write" on storage.objects for insert
  with check (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "documents bucket: own folder update" on storage.objects for update
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "documents bucket: own folder delete" on storage.objects for delete
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);

-- ── Usage: translated characters per subject (user or hashed IP) per period ──────────────
create table if not exists public.usage (
  subject text not null,
  period  text not null,
  chars   int  not null default 0,
  primary key (subject, period)
);
alter table public.usage enable row level security;
drop policy if exists "usage: read own" on public.usage;
create policy "usage: read own" on public.usage for select using (subject = 'u:' || auth.uid()::text);

-- Adds n characters if that stays within cap. Returns the new total, or null when over the cap.
-- Atomic, so parallel requests can't overshoot the quota.
create or replace function public.consume_usage(p_subject text, p_period text, p_chars int, p_cap int)
returns int language plpgsql security definer set search_path = public as $$
declare total int;
begin
  insert into usage (subject, period, chars) values (p_subject, p_period, 0)
    on conflict (subject, period) do nothing;
  update usage set chars = chars + p_chars
    where subject = p_subject and period = p_period and chars + p_chars <= p_cap
    returning chars into total;
  return total;
end $$;
revoke execute on function public.consume_usage(text, text, int, int) from public, anon, authenticated;
