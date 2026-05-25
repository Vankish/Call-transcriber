-- ── Call Transcriber — Supabase Schema ──────────────────────────────────────
-- Run this entire file in the Supabase SQL Editor (supabase.com → SQL Editor)

-- Profiles (extends auth.users)
create table public.profiles (
  id              uuid references auth.users on delete cascade primary key,
  name            text    not null default '',
  email           text    not null default '',
  company         text    not null default '',
  photo           text    not null default '',
  groq_api_key    text    not null default '',
  tx_model        text    not null default 'whisper-large-v3',
  sum_model       text    not null default 'llama-3.3-70b-versatile',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Projects
create table public.projects (
  id          text primary key,
  user_id     uuid references auth.users on delete cascade not null,
  name        text not null default '',
  company     text not null default '',
  status      text not null default 'active',
  created_at  timestamptz not null default now()
);

-- Candidates
create table public.candidates (
  id          text primary key,
  user_id     uuid references auth.users on delete cascade not null,
  project_id  text references public.projects(id) on delete cascade not null,
  name        text not null default '',
  email       text not null default '',
  phone       text not null default '',
  role        text not null default '',
  notes       text not null default '',
  created_at  timestamptz not null default now()
);

-- Interviews
create table public.interviews (
  id                    text primary key,
  user_id               uuid references auth.users on delete cascade not null,
  candidate_id          text references public.candidates(id) on delete cascade not null,
  project_id            text references public.projects(id) on delete cascade not null,
  session_name          text    not null default '',
  status                text    not null default 'idle',
  duration_sec          integer not null default 0,
  mic_device_id         text    not null default '',
  output_device_id      text    not null default '',
  transcript_original   text    not null default '',
  transcript_edited     text    not null default '',
  transcript_updated_at timestamptz,
  recording_url         text,
  recording_file_path   text,
  capture_source        text    not null default 'none',
  transcription_status  text    not null default 'pending',
  summary_instructions  text    not null default '',
  summary_text          text    not null default '',
  summary_status        text    not null default 'idle',
  summary_type          text    not null default 'resumen',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- ── Row Level Security ────────────────────────────────────────────────────────
alter table public.profiles   enable row level security;
alter table public.projects   enable row level security;
alter table public.candidates enable row level security;
alter table public.interviews enable row level security;

create policy "own profile"     on public.profiles   for all using (auth.uid() = id);
create policy "own projects"    on public.projects   for all using (auth.uid() = user_id);
create policy "own candidates"  on public.candidates for all using (auth.uid() = user_id);
create policy "own interviews"  on public.interviews for all using (auth.uid() = user_id);

-- ── Auto-create profile on signup ────────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, email)
  values (new.id, coalesce(new.email, ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
