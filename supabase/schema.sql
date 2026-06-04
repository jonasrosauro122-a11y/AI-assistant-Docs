-- Lava AI Assistant over Docs
-- Run in Supabase SQL Editor.
-- This app assumes existing spine tables: public.employees and public.role_grants.
-- If your spine uses different column names, adjust the helper functions only.

create extension if not exists pgcrypto;
create extension if not exists vector;


-- Local compatibility tables. If the Lava spine already has these tables, this will not overwrite them.
-- Replace/merge with the real spine employee data before production.
create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid,
  email text unique,
  full_name text,
  department text,
  role text,
  created_at timestamptz not null default now()
);

create table if not exists public.role_grants (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid,
  role_key text,
  department text,
  created_at timestamptz not null default now()
);

-- Documents uploaded by Admins/Trainers.
create table if not exists public.docs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  file_path text not null,
  file_type text not null check (file_type in ('pdf', 'markdown')),
  department text not null,
  uploaded_by uuid,
  status text not null default 'uploaded' check (status in ('uploaded', 'indexing', 'indexed', 'failed', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Searchable chunks. Embedding is nullable so local Markdown fallback can seed text before the spine embedding job is connected.
-- Adjust vector dimension to match the spine embedding model if needed.
create table if not exists public.doc_chunks (
  id uuid primary key default gen_random_uuid(),
  doc_id uuid not null references public.docs(id) on delete cascade,
  chunk_text text not null,
  chunk_index integer default 0,
  embedding vector(1536),
  department text not null,
  created_at timestamptz not null default now()
);

-- Append-only audit log for every state change.
create table if not exists public.activity_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  actor_name text,
  app text not null,
  action text not null,
  target_type text,
  target_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists docs_department_status_idx on public.docs (department, status);
create index if not exists docs_created_at_idx on public.docs (created_at desc);
create index if not exists doc_chunks_doc_id_idx on public.doc_chunks (doc_id);
create index if not exists doc_chunks_department_idx on public.doc_chunks (department);
create index if not exists doc_chunks_text_idx on public.doc_chunks using gin (to_tsvector('english', chunk_text));
create index if not exists activity_log_app_created_at_idx on public.activity_log (app, created_at desc);

-- Optional vector index. Enable only after embeddings exist and dimension/model are finalized.
-- create index if not exists doc_chunks_embedding_idx on public.doc_chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists docs_touch_updated_at on public.docs;
create trigger docs_touch_updated_at
before update on public.docs
for each row execute function public.touch_updated_at();

-- Database-level append-only protection.
create or replace function public.prevent_activity_log_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'activity_log is append-only. Updates and deletes are not allowed.';
end;
$$;

drop trigger if exists activity_log_no_update on public.activity_log;
create trigger activity_log_no_update
before update on public.activity_log
for each row execute function public.prevent_activity_log_mutation();

drop trigger if exists activity_log_no_delete on public.activity_log;
create trigger activity_log_no_delete
before delete on public.activity_log
for each row execute function public.prevent_activity_log_mutation();

-- Helper functions. Adjust these if your spine employees/role_grants columns differ.
create or replace function public.current_employee_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select e.id
  from public.employees e
  where coalesce(to_jsonb(e)->>'auth_user_id', '') = auth.uid()::text
     or lower(coalesce(to_jsonb(e)->>'email', to_jsonb(e)->>'work_email', '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
  limit 1;
$$;

create or replace function public.current_employee_department()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(to_jsonb(e)->>'department', to_jsonb(e)->>'Department', to_jsonb(e)->>'team', to_jsonb(e)->>'Team')
  from public.employees e
  where e.id = public.current_employee_id()
  limit 1;
$$;

create or replace function public.current_employee_name()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(to_jsonb(e)->>'full_name', to_jsonb(e)->>'name', to_jsonb(e)->>'display_name', to_jsonb(e)->>'email')
  from public.employees e
  where e.id = public.current_employee_id()
  limit 1;
$$;

create or replace function public.current_employee_has_role(role_pattern text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.role_grants rg
    where (coalesce(to_jsonb(rg)->>'employee_id', '') = public.current_employee_id()::text
        or coalesce(to_jsonb(rg)->>'user_id', '') = public.current_employee_id()::text)
      and lower(coalesce(to_jsonb(rg)->>'role_key', to_jsonb(rg)->>'role', to_jsonb(rg)->>'grant_name', '')) like lower(role_pattern)
  );
$$;

create or replace function public.current_employee_can_manage_docs()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_employee_has_role('%admin%')
      or public.current_employee_has_role('%trainer%')
      or public.current_employee_has_role('%training%')
      or public.current_employee_has_role('%manager%')
      or public.current_employee_has_role('%director%');
$$;

create or replace function public.current_employee_can_access_department(target_department text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_employee_can_manage_docs()
      or lower(coalesce(public.current_employee_department(), '')) = lower(coalesce(target_department, ''))
      or exists (
        select 1
        from public.role_grants rg
        where (coalesce(to_jsonb(rg)->>'employee_id', '') = public.current_employee_id()::text
             or coalesce(to_jsonb(rg)->>'user_id', '') = public.current_employee_id()::text)
          and lower(coalesce(to_jsonb(rg)->>'department', '')) = lower(coalesce(target_department, ''))
      );
$$;


-- Drop app policies before recreating them so this script is safe to rerun.
drop policy if exists "docs_select_by_department_or_manager" on public.docs;
drop policy if exists "docs_insert_by_manager" on public.docs;
drop policy if exists "docs_update_by_manager" on public.docs;
drop policy if exists "docs_delete_blocked" on public.docs;
drop policy if exists "doc_chunks_select_by_department_or_manager" on public.doc_chunks;
drop policy if exists "doc_chunks_insert_by_manager_for_markdown_fallback" on public.doc_chunks;
drop policy if exists "doc_chunks_update_by_manager" on public.doc_chunks;
drop policy if exists "doc_chunks_delete_by_manager" on public.doc_chunks;
drop policy if exists "activity_log_insert_authenticated" on public.activity_log;
drop policy if exists "activity_log_select_manager" on public.activity_log;
drop policy if exists "activity_log_update_blocked" on public.activity_log;
drop policy if exists "activity_log_delete_blocked" on public.activity_log;
drop policy if exists "training_docs_read_by_authenticated" on storage.objects;
drop policy if exists "training_docs_upload_by_manager" on storage.objects;
drop policy if exists "training_docs_update_by_manager" on storage.objects;
drop policy if exists "training_docs_delete_by_manager" on storage.objects;

-- RLS
alter table public.docs enable row level security;
alter table public.doc_chunks enable row level security;
alter table public.activity_log enable row level security;

-- Docs policies
create policy "docs_select_by_department_or_manager"
on public.docs
for select
to authenticated
using (public.current_employee_can_access_department(department));

create policy "docs_insert_by_manager"
on public.docs
for insert
to authenticated
with check (public.current_employee_can_manage_docs());

create policy "docs_update_by_manager"
on public.docs
for update
to authenticated
using (public.current_employee_can_manage_docs())
with check (public.current_employee_can_manage_docs());

-- No hard deletes from browser. Archive instead.
create policy "docs_delete_blocked"
on public.docs
for delete
to authenticated
using (false);

-- Chunk policies. Spine/service role can bypass RLS for indexing.
create policy "doc_chunks_select_by_department_or_manager"
on public.doc_chunks
for select
to authenticated
using (public.current_employee_can_access_department(department));

create policy "doc_chunks_insert_by_manager_for_markdown_fallback"
on public.doc_chunks
for insert
to authenticated
with check (public.current_employee_can_manage_docs());

create policy "doc_chunks_update_by_manager"
on public.doc_chunks
for update
to authenticated
using (public.current_employee_can_manage_docs())
with check (public.current_employee_can_manage_docs());

create policy "doc_chunks_delete_by_manager"
on public.doc_chunks
for delete
to authenticated
using (public.current_employee_can_manage_docs());

-- Activity log policies. Insert only; select by manager.
create policy "activity_log_insert_authenticated"
on public.activity_log
for insert
to authenticated
with check (true);

create policy "activity_log_select_manager"
on public.activity_log
for select
to authenticated
using (public.current_employee_can_manage_docs());

create policy "activity_log_update_blocked"
on public.activity_log
for update
to authenticated
using (false)
with check (false);

create policy "activity_log_delete_blocked"
on public.activity_log
for delete
to authenticated
using (false);

-- Storage bucket setup. Run once. Keep bucket private if your spine creates signed links.
insert into storage.buckets (id, name, public)
values ('training-docs', 'training-docs', true)
on conflict (id) do nothing;

create policy "training_docs_read_by_authenticated"
on storage.objects
for select
to authenticated
using (bucket_id = 'training-docs');

create policy "training_docs_upload_by_manager"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'training-docs' and public.current_employee_can_manage_docs());

create policy "training_docs_update_by_manager"
on storage.objects
for update
to authenticated
using (bucket_id = 'training-docs' and public.current_employee_can_manage_docs())
with check (bucket_id = 'training-docs' and public.current_employee_can_manage_docs());

create policy "training_docs_delete_by_manager"
on storage.objects
for delete
to authenticated
using (bucket_id = 'training-docs' and public.current_employee_can_manage_docs());
