# Supabase setup for shared community database

## 1) Create bucket
- In Supabase Storage, create a public bucket named: `stamps`

## 2) Create table
Run this SQL in Supabase SQL Editor:

```sql
create extension if not exists pgcrypto;

create table if not exists public.stamps (
  id uuid primary key default gen_random_uuid(),
  src text not null,
  created_at timestamptz not null default now(),
  wall_color text
);

alter table public.stamps enable row level security;

-- Public read
create policy if not exists "stamps_public_read"
on public.stamps
for select
using (true);

-- Public insert
create policy if not exists "stamps_public_insert"
on public.stamps
for insert
with check (true);
```

## 3) Set app env vars
Create `.env.local` in project root:

```bash
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
```

## 4) Restart dev server
```bash
npm run dev
```

When env vars are configured:
- Database panel loads community stamps from Supabase
- "Submit to database" publishes to shared storage + shared table

If env vars are missing, app falls back to local-only IndexedDB mode.
