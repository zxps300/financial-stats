-- BTC Youth Fund Tracker: Lock database to a SINGLE OWNER ONLY.
-- SAFE TO RUN: Does NOT delete any transactions, events, members, or profiles.
-- Run this in Supabase Dashboard -> SQL Editor.
-- Also recommended: In Supabase Dashboard -> Authentication -> Providers -> Email,
-- turn OFF "Allow new users to sign up" so nobody else can register.

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select lower(coalesce((select email from auth.users where id = auth.uid()), '')) = 'bryanleesugue79@gmail.com';
$$;

-- Ensure the owner profile always has the 'treasurer' role
update public.profiles
set role = 'treasurer'
where lower(email) = 'bryanleesugue79@gmail.com';

-- Remove multi-user self-approval guard and approve any old pending transactions
drop trigger if exists guard_tx on public.transactions;
update public.transactions set status = 'approved' where status = 'pending';

-- Drop previous multi-user policies
drop policy if exists read_all on public.events;
drop policy if exists read_all on public.members;
drop policy if exists read_all on public.categories;
drop policy if exists read_all on public.transactions;
drop policy if exists read_all on public.audit_log;
drop policy if exists read_all on public.profiles;
drop policy if exists add_tx on public.transactions;
drop policy if exists update_tx on public.transactions;
drop policy if exists treasurer_events on public.events;
drop policy if exists treasurer_members on public.members;
drop policy if exists treasurer_categories on public.categories;
drop policy if exists treasurer_profiles on public.profiles;
drop policy if exists add_audit on public.audit_log;

-- Drop owner policies if re-running this script
drop policy if exists owner_only_events on public.events;
drop policy if exists owner_only_members on public.members;
drop policy if exists owner_only_categories on public.categories;
drop policy if exists owner_only_transactions on public.transactions;
drop policy if exists owner_only_audit_log on public.audit_log;
drop policy if exists owner_only_profiles on public.profiles;

-- Strict owner-only policies (SELECT, INSERT, UPDATE, DELETE)
create policy owner_only_events on public.events
  for all to authenticated using (public.is_owner()) with check (public.is_owner());

create policy owner_only_members on public.members
  for all to authenticated using (public.is_owner()) with check (public.is_owner());

create policy owner_only_categories on public.categories
  for all to authenticated using (public.is_owner()) with check (public.is_owner());

create policy owner_only_transactions on public.transactions
  for all to authenticated using (public.is_owner()) with check (public.is_owner());

create policy owner_only_audit_log on public.audit_log
  for all to authenticated using (public.is_owner()) with check (public.is_owner());

create policy owner_only_profiles on public.profiles
  for all to authenticated using (public.is_owner()) with check (public.is_owner());

-- Private 'receipts' storage bucket + owner-only access (upload, view, replace, delete)
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;

drop policy if exists receipts_read on storage.objects;
drop policy if exists receipts_add on storage.objects;
drop policy if exists owner_only_receipts on storage.objects;

create policy owner_only_receipts on storage.objects
  for all to authenticated
  using (bucket_id = 'receipts' and public.is_owner())
  with check (bucket_id = 'receipts' and public.is_owner());
