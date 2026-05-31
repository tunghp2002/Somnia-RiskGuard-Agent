create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.agent_records (
  collection text primary key,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agent_records_updated_at_idx
  on public.agent_records (updated_at desc);

drop trigger if exists set_agent_records_updated_at on public.agent_records;
create trigger set_agent_records_updated_at
before update on public.agent_records
for each row execute function public.set_updated_at();

alter table public.agent_records enable row level security;
revoke all on public.agent_records from anon;
revoke all on public.agent_records from authenticated;

create table if not exists public.user_profiles (
  user_id uuid primary key,
  wallet_address text not null unique,
  display_name text,
  telegram_chat_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_profiles_updated_at_idx
  on public.user_profiles (updated_at desc);

drop trigger if exists set_user_profiles_updated_at on public.user_profiles;
create trigger set_user_profiles_updated_at
before update on public.user_profiles
for each row execute function public.set_updated_at();

alter table public.user_profiles enable row level security;
revoke all on public.user_profiles from anon;
revoke all on public.user_profiles from authenticated;

create table if not exists public.session_keys (
  session_key_id uuid primary key,
  wallet_address text not null,
  smart_account_address text,
  action text not null check (action in ('checkin', 'send', 'swap', 'riskguard-approval')),
  session_key_address text not null,
  encrypted_private_key text not null,
  encryption_iv text not null,
  encryption_tag text not null,
  status text not null check (status in ('pending', 'active', 'revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz
);

alter table public.session_keys
  drop constraint if exists session_keys_action_check;

alter table public.session_keys
  add constraint session_keys_action_check
  check (action in ('checkin', 'send', 'swap', 'riskguard-approval'));

create index if not exists session_keys_wallet_action_idx
  on public.session_keys (wallet_address, action, updated_at desc);

create index if not exists session_keys_smart_action_idx
  on public.session_keys (smart_account_address, action, updated_at desc)
  where smart_account_address is not null;

create unique index if not exists session_keys_active_smart_action_idx
  on public.session_keys (smart_account_address, action)
  where smart_account_address is not null and status <> 'revoked';

alter table public.session_keys enable row level security;
revoke all on public.session_keys from anon;
revoke all on public.session_keys from authenticated;

select pg_notify('pgrst', 'reload schema');
