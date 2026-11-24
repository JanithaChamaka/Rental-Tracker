-- Rental Desk database. Paste all of this into Supabase > SQL Editor and click Run.

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  phone text,
  email text,
  address text,
  id_note text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists rentals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  customer_id uuid references customers(id) on delete set null,
  customer_name text,
  customer_phone text,
  customer_email text,
  item_name text not null,
  item_tag text,
  item_desc text,
  qty int not null default 1,
  price numeric,
  deposit numeric,
  start_date date,
  end_date date not null,
  reminders jsonb not null default '[]',
  email_customer boolean not null default false,
  photos_before jsonb not null default '[]',
  photos_after jsonb not null default '[]',
  notes text,
  status text not null default 'active',
  returned_at date,
  created_at timestamptz not null default now()
);

create table if not exists settings (
  owner_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  owner_email text,
  days jsonb not null default '[7,1]'
);

-- Only the signed-in owner can see or change their own data.
alter table customers enable row level security;
alter table rentals enable row level security;
alter table settings enable row level security;

drop policy if exists "own customers" on customers;
create policy "own customers" on customers for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "own rentals" on rentals;
create policy "own rentals" on rentals for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "own settings" on settings;
create policy "own settings" on settings for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Private photo storage. Each user's photos live in a folder named with their user id.
insert into storage.buckets (id, name, public) values ('photos', 'photos', false)
  on conflict (id) do nothing;

drop policy if exists "own photos read" on storage.objects;
create policy "own photos read" on storage.objects for select to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "own photos upload" on storage.objects;
create policy "own photos upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "own photos delete" on storage.objects;
create policy "own photos delete" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
