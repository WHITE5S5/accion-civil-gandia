-- Analítica propia ligera (sin cookies de terceros, sid pseudónimo en localStorage).
-- Escribe solo el servidor (service_role vía /api/hit); RLS sin políticas públicas.
create table if not exists public.analytics_events (
  id bigint generated always as identity primary key,
  tipo text not null check (tipo in ('pageview','social','cta')),
  path text,
  red text,
  sid text,
  lang text,
  ref text,
  created_at timestamptz not null default now()
);
create index if not exists analytics_events_created_idx on public.analytics_events (created_at desc);
create index if not exists analytics_events_tipo_created_idx on public.analytics_events (tipo, created_at desc);
alter table public.analytics_events enable row level security;
