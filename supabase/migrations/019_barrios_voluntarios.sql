-- Fase 3 · 2026-07-18
-- (1) Lista canónica única de barrios/distritos de Gandia: misma en admin, Crear propuesta y Voluntarios.
--     Se preservan los IDs existentes (UPDATE por slug) para no romper FKs de events/actuaciones/proposals.
-- (2) Nueva tabla `voluntarios` (Red de barrios de la página Equipo), gestionada desde el panel /admin.

-- ---------- (1) Barrios ----------
alter table barrios add column if not exists orden int default 100;

-- Renombra/ordena los 7 existentes al estándar (IDs intactos)
update barrios set nombre_es='Centro Histórico',            nombre_va='Centre Històric',               orden=10  where slug='centro';
update barrios set nombre_es='Corea',                       nombre_va='Corea',                         orden=50  where slug='corea';
update barrios set nombre_es='Santa Anna',                  nombre_va='Santa Anna',                    orden=60  where slug='santa-anna';
update barrios set nombre_es='Beniopa – Sant Pere',         nombre_va='Beniopa – Sant Pere',           orden=70  where slug='beniopa';
update barrios set nombre_es='Benipeixcar',                 nombre_va='Benipeixcar',                   orden=80  where slug='benipeixcar';
update barrios set nombre_es='Grau – Venècia – Rafalcaid',  nombre_va='Grau – Venècia – Rafalcaid',    orden=90  where slug='grao';
update barrios set nombre_es='Marxuquera',                  nombre_va='Marxuquera',                    orden=110 where slug='marchuquera';

-- Inserta los barrios que faltaban (slugs que propuesta.mjs ya esperaba → dejaban de resolverse)
insert into barrios (slug, nombre_es, nombre_va, orden) values
 ('raval',               'El Raval – El Prado',              'El Raval – El Prado',              20),
 ('germanies',           'Germanies – Els Jardinets',        'Germanies – Els Jardinets',        30),
 ('republica-argentina', 'Pl. El·líptica – Rep. Argentina',  'Pl. El·líptica – Rep. Argentina',  40),
 ('playa',               'Playa de Gandia',                  'Platja de Gandia',                 100)
on conflict (slug) do nothing;

-- ---------- (2) Voluntarios ----------
create table if not exists voluntarios (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  barrio_id uuid references barrios(id),
  foto text,
  orden int default 0,
  activo boolean default true,
  created_at timestamptz default now()
);

alter table voluntarios enable row level security;
drop policy if exists pub_voluntarios on voluntarios;
create policy pub_voluntarios on voluntarios for select using (activo);   -- lectura pública solo de los visibles
grant select on voluntarios to anon, authenticated;                      -- escritura: solo service_role (panel /admin)
