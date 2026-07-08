-- Canal interno de informaciones (Ley 2/2023). Aplicada 2026-07-08 vía SQL Editor.
-- Anonimato: no se guarda IP ni user-agent. `contacto` es opcional y lo aporta el informante.
create table if not exists denuncias (
  id uuid primary key default gen_random_uuid(),
  codigo text unique not null,               -- código de seguimiento que se da al informante
  categoria text not null,
  texto text not null check (char_length(texto) between 30 and 8000),
  contacto text,                             -- opcional (email si quiere respuesta directa)
  estado text not null default 'nueva' check (estado in ('nueva','en_tramite','cerrada')),
  respuesta text,                            -- resolución visible al consultar el código
  created_at timestamptz default now()
);
alter table denuncias enable row level security;
-- sin políticas => solo service_role
