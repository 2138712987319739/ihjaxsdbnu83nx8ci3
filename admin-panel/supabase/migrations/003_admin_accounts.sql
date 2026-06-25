alter table public.admin_users
  add column if not exists role text not null default 'operator',
  add column if not exists permissions jsonb not null default '[]'::jsonb,
  add column if not exists invited_by uuid references auth.users(id) on delete set null,
  add column if not exists invited_at timestamptz,
  add column if not exists accepted_at timestamptz,
  add column if not exists password_set_at timestamptz,
  add column if not exists last_seen_at timestamptz,
  add column if not exists disabled_at timestamptz;

update public.admin_users
set
  role = case when role is null or role = '' then 'owner' else role end,
  permissions = case
    when permissions is null or jsonb_typeof(permissions) <> 'array' then '["config:write","actions:write","users:write","security:write"]'::jsonb
    else permissions
  end,
  accepted_at = coalesce(accepted_at, created_at),
  password_set_at = coalesce(password_set_at, created_at)
where user_id is not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'admin_users_role_check'
      and conrelid = 'public.admin_users'::regclass
  ) then
    alter table public.admin_users
      add constraint admin_users_role_check check (role in ('owner', 'admin', 'operator', 'viewer'));
  end if;
end;
$$;

create or replace function public.is_friendconnect_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users
    where user_id = (select auth.uid())
      and disabled_at is null
  );
$$;

create or replace function public.friendconnect_admin_count()
returns integer
language sql
security definer
set search_path = public
as $$
  select count(*)::integer from public.admin_users where disabled_at is null;
$$;

create or replace function public.friendconnect_has_permission(required_permission text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users
    where user_id = (select auth.uid())
      and disabled_at is null
      and (
        role = 'owner'
        or permissions ? required_permission
      )
  );
$$;

create or replace function public.claim_first_friendconnect_admin()
returns public.admin_users
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  current_email text := auth.email();
  created_user public.admin_users;
begin
  if current_user_id is null or current_email is null then
    raise exception 'Authentication required.';
  end if;

  if exists (select 1 from public.admin_users where disabled_at is null) then
    raise exception 'The first admin account already exists.';
  end if;

  insert into public.admin_users (
    user_id,
    email,
    role,
    permissions,
    invited_at,
    accepted_at,
    password_set_at,
    last_seen_at
  )
  values (
    current_user_id,
    lower(current_email),
    'owner',
    '["config:write","actions:write","users:write","security:write"]'::jsonb,
    now(),
    now(),
    now(),
    now()
  )
  returning * into created_user;

  return created_user;
end;
$$;

create or replace function public.mark_friendconnect_password_set()
returns public.admin_users
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  updated_user public.admin_users;
begin
  if current_user_id is null then
    raise exception 'Authentication required.';
  end if;

  update public.admin_users
  set
    password_set_at = now(),
    accepted_at = coalesce(accepted_at, now()),
    last_seen_at = now()
  where user_id = current_user_id
    and disabled_at is null
  returning * into updated_user;

  if updated_user.user_id is null then
    raise exception 'Admin profile not found.';
  end if;

  return updated_user;
end;
$$;

grant execute on function public.friendconnect_admin_count() to anon, authenticated;
grant execute on function public.friendconnect_has_permission(text) to authenticated;
grant execute on function public.claim_first_friendconnect_admin() to authenticated;
grant execute on function public.mark_friendconnect_password_set() to authenticated;
