create table if not exists public.session_keys (
  session_key_id uuid primary key,
  wallet_address text not null,
  smart_account_address text,
  action text not null check (action in ('checkin', 'send', 'swap')),
  session_key_address text not null,
  encrypted_private_key text not null,
  encryption_iv text not null,
  encryption_tag text not null,
  status text not null check (status in ('pending', 'active', 'revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz
);

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
