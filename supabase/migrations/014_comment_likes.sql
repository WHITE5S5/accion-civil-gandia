-- Likes en comentarios del debate ciudadano (1 usuario = 1 like por comentario).
-- La API media todos los accesos con service_role; RLS sin políticas públicas.
create table if not exists public.comment_likes (
  comment_id uuid not null references public.comments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);
create index if not exists comment_likes_comment_idx on public.comment_likes (comment_id);
alter table public.comment_likes enable row level security;
