-- Fase 3 · 2026-07-18 — Sistema de títulos/rangos ligado a cuentas registradas.
-- Línea jerárquica (se muestra el más alto): ciudadano < voluntario < colaborador < afiliado.
-- + título aparte "donante" (bonus). Enlace afiliado/donante por email de la cuenta.

-- Flags en la cuenta (los lee el chat/cuenta/comentarios sin coste extra)
alter table profiles add column if not exists es_donante  boolean not null default false;
alter table profiles add column if not exists es_afiliado boolean not null default false;
alter table profiles add column if not exists voluntariado text;   -- 'voluntario' | 'colaborador' | null

-- Voluntarios: ahora ligados a una cuenta real (user_id) + tipo. Se conservan nombre/foto/barrio
-- como copia (snapshot) para que la página pública Equipo (clave anon, sin acceso a profiles) los muestre.
alter table voluntarios add column if not exists user_id uuid references profiles(id);
alter table voluntarios add column if not exists tipo text not null default 'voluntario'
  check (tipo in ('voluntario', 'colaborador'));
