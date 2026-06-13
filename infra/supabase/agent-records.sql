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

select pg_notify('pgrst', 'reload schema');
