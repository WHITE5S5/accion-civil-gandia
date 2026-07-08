-- Tesorería del partido: ingresos y gastos que alimentan la página de Transparencia
-- y el panel de administración. Aplicada 2026-07-08 vía SQL Editor.
create table if not exists tesoreria (
  id uuid primary key default gen_random_uuid(),
  fecha date not null default current_date,
  tipo text not null check (tipo in ('ingreso','gasto')),
  categoria text not null,
  concepto text not null,
  importe_cents int not null check (importe_cents > 0),
  ejercicio int generated always as (extract(year from fecha)::int) stored,
  created_at timestamptz default now()
);
alter table tesoreria enable row level security;
-- sin políticas => solo service_role (el público la ve agregada vía /api/tesoreria)
