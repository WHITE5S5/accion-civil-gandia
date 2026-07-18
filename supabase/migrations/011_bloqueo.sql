-- Bloqueo de usuarios (moderación del chat/comunidad).
alter table profiles add column if not exists bloqueado boolean not null default false;
