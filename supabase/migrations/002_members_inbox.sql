-- Puente Fase 4-sin-Fase 3: altas de afiliación pagadas antes de que exista el
-- área de usuario. El webhook las guarda aquí; al completar Fase 3, el equipo
-- las vincula a profiles y se migran a members (y esta tabla se vacía).
create table members_inbox (
  id uuid primary key default gen_random_uuid(),
  dni_encrypted text not null,
  dni_hash text unique not null,
  nombre text, apellidos text,
  direccion text, cp text, telefono text,
  fecha_nacimiento date,
  cuota_tipo text,
  consent_estatutos_at timestamptz,
  stripe_customer_id text unique, stripe_subscription_id text unique,
  estado text not null default 'activo',
  created_at timestamptz default now()
);
alter table members_inbox enable row level security;
-- sin políticas => solo service_role
