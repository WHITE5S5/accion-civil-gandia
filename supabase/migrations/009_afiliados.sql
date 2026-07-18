-- Registro interno de personas afiliadas y sus cuotas (importado del Excel del equipo).
-- Datos personales (DNI/teléfono): solo panel admin. RLS sin políticas públicas.
create table if not exists afiliados (
  id uuid primary key default gen_random_uuid(),
  numero int,
  nombre text not null,
  apellidos text not null default '',
  dni text,
  telefono text,
  cuota numeric not null default 0,      -- cuota mensual en euros
  total numeric not null default 0,      -- total pagado histórico en euros
  estado text not null default 'activo' check (estado in ('activo','baja')),
  notas text,
  created_at timestamptz default now()
);
create index if not exists afiliados_numero on afiliados (numero);
alter table afiliados enable row level security;
