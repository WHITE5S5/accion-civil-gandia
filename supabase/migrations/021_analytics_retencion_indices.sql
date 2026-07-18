-- 021: Retención de analítica + índices de consultas calientes (2026-07-18)
-- 1) Tabla de agregados mensuales: antes de purgar eventos crudos (>90 días),
--    la función diaria consolida aquí los totales para conservar el histórico.
create table if not exists public.analytics_mensual (
  mes date not null,                 -- primer día del mes
  tipo text not null,                -- pageview | social | cta
  clave text not null default '',    -- path (pageview/cta) o red (social)
  hits integer not null default 0,
  unique (mes, tipo, clave)
);
alter table public.analytics_mensual enable row level security;
-- Sin políticas públicas: solo service_role (funciones del servidor) lee/escribe.

-- 2) Índices de consultas calientes (IF NOT EXISTS: inofensivo si ya existen)
create index if not exists comments_proposal_estado_idx on public.comments (proposal_id, estado);
create index if not exists comments_created_idx on public.comments (created_at desc);
create index if not exists messages_created_idx on public.messages (created_at desc);
create index if not exists votes_proposal_idx on public.votes (proposal_id);
create index if not exists proposals_estado_created_idx on public.proposals (estado, created_at desc);
create index if not exists event_inscripciones_slug_idx on public.event_inscripciones (event_slug);
create index if not exists audit_log_created_idx on public.audit_log (created_at desc);
