-- Canal de difusión: anuncios donde solo publica el equipo; aparecen en Comunidad y caducan.
create table if not exists broadcasts (
  id uuid primary key default gen_random_uuid(),
  texto text not null check (char_length(texto) between 1 and 2000),
  created_at timestamptz default now(),
  expires_at timestamptz
);
create index if not exists broadcasts_created on broadcasts (created_at desc);
alter table broadcasts enable row level security;
-- sin políticas públicas: solo service_role (el público los lee vía /api/broadcasts).
