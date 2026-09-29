-- =============================================================
-- No Overtime – Supabase Migration: GDPR-Compliant Schema
-- =============================================================
-- Run this in the Supabase SQL Editor (London eu-west-2 region)
-- or via `supabase db push` with the Supabase CLI.
-- =============================================================


-- ─────────────────────────────────────────────────────────────
-- 0. Extensions
-- ─────────────────────────────────────────────────────────────
create extension if not exists "uuid-ossp" with schema extensions;


-- ─────────────────────────────────────────────────────────────
-- 1. PROFILES TABLE
--    Linked 1:1 with auth.users via id (uuid).
--    Tracks subscription tier and AI scan quota usage.
-- ─────────────────────────────────────────────────────────────
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text,
  subscription_tier text not null default 'free'
                    check (subscription_tier in ('free', 'pro')),
  ai_scans_used integer not null default 0,
  ai_scans_limit integer not null default 5,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.profiles is
  'User profile extending auth.users – tracks subscription tier and AI scan quota.';

-- Auto-create a profile row when a new user signs up
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();


-- ─────────────────────────────────────────────────────────────
-- 2. DEVICE USAGE TABLE
--    Tracks AI scans per physical device (Capacitor Device.getId()).
--    Prevents reinstall abuse on mobile free tier.
-- ─────────────────────────────────────────────────────────────
create table public.device_usage (
  device_uuid     text primary key,
  free_scans_used integer not null default 0,
  last_seen       timestamptz not null default now()
);

comment on table public.device_usage is
  'Per-device scan tracking to prevent free-tier reinstall abuse on mobile.';


-- ─────────────────────────────────────────────────────────────
-- 3. RECEIPTS TABLE
--    Core receipt data with UK-specific fields.
--    Cascade-deletes when the owning profile is deleted (GDPR).
-- ─────────────────────────────────────────────────────────────
create table public.receipts (
  id               uuid primary key default extensions.uuid_generate_v4(),
  user_id          uuid not null references public.profiles(id) on delete cascade,
  merchant_name    text,
  receipt_date     date,                     -- ISO-8601 (stored from DD/MM/YYYY input)
  currency         text not null default 'GBP',
  subtotal         numeric(12,2),
  vat_amount       numeric(12,2),            -- UK 20% standard rate
  service_charge   numeric(12,2),            -- UK 12.5% optional service charge
  total_amount     numeric(12,2),
  confidence_score numeric(5,2),             -- 0.00 – 100.00
  status           text not null default 'needs_review'
                   check (status in ('needs_review', 'verified', 'exported')),
  image_path       text,                     -- path in Supabase Storage bucket
  raw_ocr_text     text,                     -- raw OCR output (before parsing)
  parsed_json      jsonb,                    -- structured parser output
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.receipts is
  'Scanned receipt records with UK VAT fields. Cascade-deletes with profile for GDPR.';

-- Index for fast user-scoped queries
create index idx_receipts_user_id on public.receipts(user_id);
create index idx_receipts_status  on public.receipts(status);


-- ─────────────────────────────────────────────────────────────
-- 4. RECEIPT ITEMS TABLE
--    Line-item breakdown for Excel export (Line Items tab).
--    Cascade-deletes with the parent receipt.
-- ─────────────────────────────────────────────────────────────
create table public.receipt_items (
  id          uuid primary key default extensions.uuid_generate_v4(),
  receipt_id  uuid not null references public.receipts(id) on delete cascade,
  description text,
  quantity    integer not null default 1,
  unit_price  numeric(12,2),
  total_price numeric(12,2),
  category    text,
  created_at  timestamptz not null default now()
);

comment on table public.receipt_items is
  'Individual line items from a receipt – used for the Excel Line Items tab.';

create index idx_receipt_items_receipt_id on public.receipt_items(receipt_id);


-- ─────────────────────────────────────────────────────────────
-- 5. UPDATED_AT TRIGGER
--    Auto-updates the updated_at column on row changes.
-- ─────────────────────────────────────────────────────────────
create or replace function public.update_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_profiles_updated_at
  before update on public.profiles
  for each row execute procedure public.update_updated_at();

create trigger set_receipts_updated_at
  before update on public.receipts
  for each row execute procedure public.update_updated_at();


-- ─────────────────────────────────────────────────────────────
-- 6. ROW-LEVEL SECURITY (RLS)
--    Users can only read/write their own data.
-- ─────────────────────────────────────────────────────────────

-- Profiles: users see and update only their own row
alter table public.profiles enable row level security;

create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- Receipts: users CRUD only their own receipts
alter table public.receipts enable row level security;

create policy "Users can view own receipts"
  on public.receipts for select
  using (auth.uid() = user_id);

create policy "Users can insert own receipts"
  on public.receipts for insert
  with check (auth.uid() = user_id);

create policy "Users can update own receipts"
  on public.receipts for update
  using (auth.uid() = user_id);

create policy "Users can delete own receipts"
  on public.receipts for delete
  using (auth.uid() = user_id);

-- Receipt Items: inherit access through the parent receipt's user_id
alter table public.receipt_items enable row level security;

create policy "Users can view own receipt items"
  on public.receipt_items for select
  using (
    exists (
      select 1 from public.receipts
      where receipts.id = receipt_items.receipt_id
        and receipts.user_id = auth.uid()
    )
  );

create policy "Users can insert own receipt items"
  on public.receipt_items for insert
  with check (
    exists (
      select 1 from public.receipts
      where receipts.id = receipt_items.receipt_id
        and receipts.user_id = auth.uid()
    )
  );

create policy "Users can update own receipt items"
  on public.receipt_items for update
  using (
    exists (
      select 1 from public.receipts
      where receipts.id = receipt_items.receipt_id
        and receipts.user_id = auth.uid()
    )
  );

create policy "Users can delete own receipt items"
  on public.receipt_items for delete
  using (
    exists (
      select 1 from public.receipts
      where receipts.id = receipt_items.receipt_id
        and receipts.user_id = auth.uid()
    )
  );

-- Device Usage: open for upsert from API (no user auth required)
-- The API route handles device-based quota logic server-side.
alter table public.device_usage enable row level security;

create policy "Service role can manage device usage"
  on public.device_usage for all
  using (true)
  with check (true);


-- ─────────────────────────────────────────────────────────────
-- 7. PRIVATE STORAGE BUCKET
--    Receipt images stored privately.
--    Client uses short-lived (15-min) Signed URLs to display.
-- ─────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('receipt-images', 'receipt-images', false);

-- Users can upload to their own folder: receipt-images/{user_id}/*
create policy "Users can upload own receipt images"
  on storage.objects for insert
  with check (
    bucket_id = 'receipt-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Users can view their own images
create policy "Users can view own receipt images"
  on storage.objects for select
  using (
    bucket_id = 'receipt-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Users can delete their own images
create policy "Users can delete own receipt images"
  on storage.objects for delete
  using (
    bucket_id = 'receipt-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );


-- ─────────────────────────────────────────────────────────────
-- 8. GDPR: CASCADING DELETE CLEANUP TRIGGER
--    When a profile is deleted, this fires BEFORE the cascade
--    to clean up Storage objects that aren't covered by FK cascades.
-- ─────────────────────────────────────────────────────────────
create or replace function public.handle_profile_deletion()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  -- Delete all receipt images from Storage for this user
  delete from storage.objects
  where bucket_id = 'receipt-images'
    and (storage.foldername(name))[1] = old.id::text;

  return old;
end;
$$;

create trigger on_profile_deleted
  before delete on public.profiles
  for each row execute procedure public.handle_profile_deletion();


-- ─────────────────────────────────────────────────────────────
-- Done! Schema is GDPR-compliant with:
--   ✓ Profile → Receipts → Receipt Items cascade delete
--   ✓ Profile deletion cleans up Storage objects
--   ✓ RLS policies enforce user-scoped data access
--   ✓ Private storage bucket with signed URL access
-- ─────────────────────────────────────────────────────────────
