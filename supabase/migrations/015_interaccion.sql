-- 015: apoyos a campañas + inscripciones a eventos + hilo de denuncias + avatar de perfil.
-- (Aplicada el 2026-07-12 vía SQL Editor.)

-- Apoyos a campañas del partido (1 usuario = 1 apoyo, retirable)
create table if not exists public.campaign_supports (
  campaign_slug text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (campaign_slug, user_id)
);
alter table public.campaign_supports enable row level security;

-- Inscripciones a actos de la agenda
alter table public.events add column if not exists inscribible boolean not null default false;
create table if not exists public.event_inscripciones (
  id uuid primary key default gen_random_uuid(),
  event_slug text not null,
  nombre text,
  email text not null,
  user_id uuid references auth.users(id) on delete set null,
  recordatorio_enviado boolean not null default false,
  created_at timestamptz not null default now(),
  unique (event_slug, email)
);
create index if not exists event_insc_slug_idx on public.event_inscripciones (event_slug);
alter table public.event_inscripciones enable row level security;

-- Denuncias: vínculo opcional a usuario registrado + hilo de conversación por código
alter table public.denuncias add column if not exists user_id uuid references auth.users(id) on delete set null;
alter table public.denuncias add column if not exists email text;
create table if not exists public.denuncia_mensajes (
  id uuid primary key default gen_random_uuid(),
  codigo text not null,
  autor text not null check (autor in ('equipo','ciudadano')),
  texto text not null,
  created_at timestamptz not null default now()
);
create index if not exists denuncia_mensajes_codigo_idx on public.denuncia_mensajes (codigo);
alter table public.denuncia_mensajes enable row level security;

-- Avatar del perfil (Google o subida propia)
alter table public.profiles add column if not exists avatar_url text;
