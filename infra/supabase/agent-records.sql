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

select pg_notify('pgrst', 'reload schema');
