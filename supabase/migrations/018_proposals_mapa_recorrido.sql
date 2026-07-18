-- 018: propuestas ciudadanas — ubicación en mapa, recorrido y umbrales editables.
-- + tabla de ajustes globales (app_settings) para los umbrales por defecto.

alter table public.proposals add column if not exists lat double precision;
alter table public.proposals add column if not exists lng double precision;
alter table public.proposals add column if not exists recorrido jsonb not null default '[]';
alter table public.proposals add column if not exists umbrales jsonb;   -- NULL = usa los umbrales globales

-- Ajustes globales (clave -> valor jsonb): umbrales por defecto de las propuestas, etc.
create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
drop policy if exists app_settings_public_read on public.app_settings;
create policy app_settings_public_read on public.app_settings for select using (true);

-- Umbrales globales por defecto (editables desde el admin en Ajustes).
insert into public.app_settings (key, value) values
  ('umbrales_propuestas',
   '[{"n":100,"label":"Revisión local"},{"n":500,"label":"Respuesta pública"},{"n":1000,"label":"Estudio técnico"},{"n":5000,"label":"Debate interno"},{"n":10000,"label":"Consulta o compromiso"}]'::jsonb)
on conflict (key) do nothing;
