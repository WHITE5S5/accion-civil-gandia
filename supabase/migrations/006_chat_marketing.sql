-- F3: chat de miembros (Comunidad) + consentimiento de marketing en el registro.

-- consents.tipo ahora admite 'marketing' (opt-in del registro, desmarcado por defecto)
alter table consents drop constraint consents_tipo_check;
alter table consents add constraint consents_tipo_check
  check (tipo in ('newsletter','privacidad','afiliacion','donacion','cookies','marketing'));

-- Chat de miembros. RGPD: al borrar la cuenta se borran sus mensajes (cascade).
create table messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  texto text not null check (char_length(texto) between 1 and 1000),
  estado text not null default 'publicado' check (estado in ('publicado','oculto')),
  created_at timestamptz default now()
);
create index messages_created on messages (created_at desc);

alter table messages enable row level security;
-- Solo usuarios con sesión leen el chat (es de miembros, no público)
create policy msg_sel on messages for select
  using (auth.uid() is not null and (estado = 'publicado' or user_id = auth.uid() or my_rol() in ('moderador','admin')));
create policy msg_ins on messages for insert
  with check (user_id = auth.uid());
-- Moderación: ocultar mensajes
create policy msg_mod on messages for update
  using (my_rol() in ('moderador','admin'));
