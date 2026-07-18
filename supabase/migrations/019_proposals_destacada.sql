-- 019 — "Realzar en web": destacar propuestas ciudadanas en la página Propuestas (Programa).
-- Añade el flag y marca 3 propuestas reales por defecto (se cambian desde el admin).

alter table public.proposals
  add column if not exists destacada boolean not null default false;

-- Marcadas por defecto (variedad: movilidad, vivienda y la que tiene foto propia)
update public.proposals set destacada = true
where id in (
  'de45b594-0f81-4d02-a988-d7607dfe054a',  -- Carril bici seguro del centro a la playa
  'aea7a885-2471-43a0-806d-29d1ec685798',  -- Vivienda asequible para jóvenes
  '29da7d4b-62cb-4078-93f3-be1b7f3dc54a'   -- Aceras levantadas y baldosas sueltas (con foto)
);
