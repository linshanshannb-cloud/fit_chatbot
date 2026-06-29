create extension if not exists pgcrypto;

create table if not exists public.user_info (
  id uuid primary key default gen_random_uuid(),
  user_id text not null unique,
  nickname text not null,
  sex text not null,
  age integer not null,
  height_cm numeric not null,
  goal_weight_kg numeric not null,
  training_frequency text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_body_record (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  weight_kg numeric not null,
  waist_cm numeric,
  body_fat numeric,
  bmi numeric,
  estimated_body_fat numeric,
  arm_cm numeric,
  thigh_cm numeric,
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.user_body_record
  add column if not exists bmi numeric,
  add column if not exists estimated_body_fat numeric;

create index if not exists user_body_record_user_id_recorded_at_idx
  on public.user_body_record (user_id, recorded_at desc);

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_user_info_updated_at on public.user_info;

create trigger set_user_info_updated_at
before update on public.user_info
for each row
execute function public.set_updated_at();

create table if not exists public.user_memory (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  memory_type text not null check (
    memory_type in ('preference', 'habit', 'goal', 'persona', 'note')
  ),
  content text not null,
  importance integer not null check (importance between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_memory_user_id_importance_updated_at_idx
  on public.user_memory (user_id, importance desc, updated_at desc);

drop trigger if exists set_user_memory_updated_at on public.user_memory;

create trigger set_user_memory_updated_at
before update on public.user_memory
for each row
execute function public.set_updated_at();

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_user_id_created_at_idx
  on public.chat_messages (user_id, created_at desc);

create table if not exists public.daily_checkin (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  date date not null,
  weight_recorded boolean not null default false,
  weight_value numeric,
  strength_done boolean not null default false,
  strength_part text,
  cardio_done boolean not null default false,
  cardio_type text,
  cardio_duration numeric,
  water_status text not null default 'unknown' check (
    water_status in ('unknown', 'low', 'normal', 'high')
  ),
  diet_status text not null default 'unknown' check (
    diet_status in ('unknown', 'low', 'normal', 'good', 'over')
  ),
  protein_status text not null default 'unknown' check (
    protein_status in ('unknown', 'low', 'normal', 'good')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, date)
);

create index if not exists daily_checkin_user_id_date_idx
  on public.daily_checkin (user_id, date desc);

drop trigger if exists set_daily_checkin_updated_at on public.daily_checkin;

create trigger set_daily_checkin_updated_at
before update on public.daily_checkin
for each row
execute function public.set_updated_at();
