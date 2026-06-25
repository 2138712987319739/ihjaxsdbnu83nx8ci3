create extension if not exists pgcrypto;

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  created_at timestamptz not null default now()
);

create or replace function public.is_friendconnect_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users
    where user_id = auth.uid()
  );
$$;

create table if not exists public.bot_config (
  bot_id text primary key,
  config jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.bot_status (
  bot_id text primary key,
  online boolean not null default false,
  current_players integer not null default 0,
  total_joins integer not null default 0,
  target_host text not null default 'play.fracturemc.com',
  target_port integer not null default 19132,
  session_display text not null default 'FractureMC',
  joinability text not null default 'friendsOnly',
  started_at timestamptz,
  last_heartbeat timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.bot_events (
  id uuid primary key default gen_random_uuid(),
  bot_id text not null,
  event_type text not null,
  message text not null,
  xuid text,
  gamertag text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.bot_errors (
  id uuid primary key default gen_random_uuid(),
  bot_id text not null,
  code text not null,
  message text not null,
  severity text not null default 'warning',
  status text not null default 'open',
  fix_action text,
  payload jsonb not null default '{}'::jsonb,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.bot_actions (
  id uuid primary key default gen_random_uuid(),
  bot_id text not null,
  action_type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued',
  result jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.fix_logs (
  id uuid primary key default gen_random_uuid(),
  bot_id text not null,
  action_id uuid references public.bot_actions(id) on delete set null,
  action_type text not null,
  status text not null,
  message text not null,
  result jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.player_sessions (
  id uuid primary key default gen_random_uuid(),
  bot_id text not null,
  xuid text not null,
  gamertag text not null,
  joined_at timestamptz not null default now(),
  left_at timestamptz
);

create index if not exists bot_events_bot_time_idx on public.bot_events (bot_id, created_at desc);
create index if not exists bot_errors_bot_time_idx on public.bot_errors (bot_id, created_at desc);
create index if not exists bot_actions_bot_status_time_idx on public.bot_actions (bot_id, status, created_at);
create index if not exists fix_logs_bot_time_idx on public.fix_logs (bot_id, created_at desc);
create index if not exists player_sessions_bot_time_idx on public.player_sessions (bot_id, joined_at desc);

alter table public.admin_users enable row level security;
alter table public.bot_config enable row level security;
alter table public.bot_status enable row level security;
alter table public.bot_events enable row level security;
alter table public.bot_errors enable row level security;
alter table public.bot_actions enable row level security;
alter table public.fix_logs enable row level security;
alter table public.player_sessions enable row level security;

create policy "admins read admins" on public.admin_users for select using (public.is_friendconnect_admin());
create policy "admins read config" on public.bot_config for select using (public.is_friendconnect_admin());
create policy "admins update config" on public.bot_config for insert with check (public.is_friendconnect_admin());
create policy "admins change config" on public.bot_config for update using (public.is_friendconnect_admin());
create policy "admins read status" on public.bot_status for select using (public.is_friendconnect_admin());
create policy "admins read events" on public.bot_events for select using (public.is_friendconnect_admin());
create policy "admins read errors" on public.bot_errors for select using (public.is_friendconnect_admin());
create policy "admins update errors" on public.bot_errors for update using (public.is_friendconnect_admin());
create policy "admins read actions" on public.bot_actions for select using (public.is_friendconnect_admin());
create policy "admins create actions" on public.bot_actions for insert with check (public.is_friendconnect_admin() and created_by = auth.uid());
create policy "admins read fix logs" on public.fix_logs for select using (public.is_friendconnect_admin());
create policy "admins read player sessions" on public.player_sessions for select using (public.is_friendconnect_admin());
