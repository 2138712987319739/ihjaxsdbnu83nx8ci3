alter table public.bot_status
  add column if not exists friend_policy text not null default 'open',
  add column if not exists lockdown_mode boolean not null default false;

create table if not exists public.security_events (
  id uuid primary key default gen_random_uuid(),
  bot_id text not null,
  severity text not null default 'info',
  category text not null,
  message text not null,
  source text not null default 'bot_bridge',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists security_events_bot_time_idx on public.security_events (bot_id, created_at desc);

alter table public.security_events enable row level security;

create policy "admins read security events" on public.security_events for select using (public.is_friendconnect_admin());
