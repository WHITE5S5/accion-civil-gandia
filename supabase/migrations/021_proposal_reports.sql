-- 021 — Denuncias de propuestas ciudadanas: registro para revisión manual en el admin (sin auto-ocultar).
-- 1 usuario = 1 denuncia por propuesta (unique). El servidor usa service_role (salta RLS).

create table if not exists public.proposal_reports (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.proposals(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  motivo text not null check (motivo in ('spam','ofensivo','falso','duplicado','otro')),
  nota text,
  estado text not null default 'pendiente' check (estado in ('pendiente','revisado')),
  created_at timestamptz not null default now(),
  unique (proposal_id, user_id)
);
create index if not exists proposal_reports_pid_idx on public.proposal_reports (proposal_id);
create index if not exists proposal_reports_estado_idx on public.proposal_reports (estado);
alter table public.proposal_reports enable row level security;
