-- Bandeja de mensajes del formulario de Contacto (visible en el panel /admin).
-- Aplicar en Supabase: SQL Editor -> pegar entero -> Run.
-- Solo el panel (service_role) accede; RLS activa sin políticas públicas bloquea anon/auth.
create table if not exists contact_messages (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  apellidos text,
  email text not null,
  asunto text,
  mensaje text not null,
  estado text not null default 'nuevo' check (estado in ('nuevo','leido','respondido','archivado')),
  created_at timestamptz default now()
);
create index if not exists contact_messages_created on contact_messages (created_at desc);
alter table contact_messages enable row level security;
