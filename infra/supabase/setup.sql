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
  data jsonb not null
);

drop trigger if exists set_agent_records_updated_at on public.agent_records;
drop index if exists public.agent_records_updated_at_idx;

alter table public.agent_records
  drop column if exists created_at,
  drop column if exists updated_at;

alter table public.agent_records enable row level security;
revoke all on public.agent_records from anon;
revoke all on public.agent_records from authenticated;

create table if not exists public.user_profiles (
  user_id uuid primary key,
  wallet_address text not null unique,
  display_name text,
  telegram_chat_id text,
  telegram_user_id text,
  telegram_username text,
  telegram_display_name text,
  telegram_smart_account_address text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_profiles
  add column if not exists telegram_chat_id text,
  add column if not exists telegram_user_id text,
  add column if not exists telegram_username text,
  add column if not exists telegram_display_name text,
  add column if not exists telegram_smart_account_address text;

do $$
begin
  if to_regclass('public.agent_records') is not null then
    update public.user_profiles profile
    set
      telegram_chat_id = binding.value ->> 'chatId',
      telegram_user_id = binding.value ->> 'telegramUserId',
      telegram_username = binding.value ->> 'telegramUsername',
      telegram_display_name = binding.value ->> 'telegramDisplayName',
      telegram_smart_account_address = binding.value ->> 'smartAccountAddress'
    from public.agent_records records,
      lateral jsonb_array_elements(records.data) as binding(value)
    where records.collection = 'telegram-bindings'
      and profile.user_id::text = binding.value ->> 'userId'
      and profile.telegram_chat_id is null;

    delete from public.agent_records
    where collection = 'telegram-bindings';
  end if;
end;
$$;

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
