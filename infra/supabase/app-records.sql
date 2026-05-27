create table if not exists public.app_records (
  collection text primary key,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists app_records_updated_at_idx
  on public.app_records (updated_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_app_records_updated_at on public.app_records;
create trigger set_app_records_updated_at
before update on public.app_records
for each row execute function public.set_updated_at();

alter table public.app_records enable row level security;

revoke all on public.app_records from anon;
revoke all on public.app_records from authenticated;
