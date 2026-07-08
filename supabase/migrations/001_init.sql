-- Acción Civil Gandia — Esquema inicial (Fase 2 del roadmap)
-- Ejecutar en Supabase: SQL Editor → pegar entero → Run.
-- Región del proyecto: eu-central-1 (Frankfurt). RLS activado en TODAS las tablas.

-- ============ CONTENIDO EDITORIAL (gestionado por Directus) ============

create table barrios (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  nombre_es text not null, nombre_va text not null,
  lat double precision, lng double precision,
  created_at timestamptz default now()
);

create table posts (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  tipo text not null check (tipo in ('noticia','comunicado','video','entrevista')),
  titulo_es text not null, titulo_va text not null,
  extracto_es text, extracto_va text,
  cuerpo_es text, cuerpo_va text,
  imagen text, video_url text,
  estado text not null default 'borrador' check (estado in ('borrador','publicado','archivado')),
  publicado_at timestamptz,
  created_at timestamptz default now()
);

create table events (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  titulo_es text not null, titulo_va text not null,
  descripcion_es text, descripcion_va text,
  fecha date not null, hora_inicio time, hora_fin time,
  lugar text, direccion text,
  barrio_id uuid references barrios(id),
  programa jsonb,
  estado text not null default 'borrador' check (estado in ('borrador','publicado','cancelado')),
  created_at timestamptz default now()
);

create table campaigns (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  titulo_es text not null, titulo_va text not null,
  descripcion_es text, descripcion_va text,
  imagen text,
  destacada boolean default false,
  progreso int default 0 check (progreso between 0 and 100),
  objetivos jsonb, cronologia jsonb, docs jsonb,
  estado text not null default 'activa' check (estado in ('borrador','activa','finalizada')),
  created_at timestamptz default now()
);

create table actuaciones (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  titulo_es text not null, titulo_va text not null,
  descripcion_es text, descripcion_va text,
  barrio_id uuid not null references barrios(id),
  estado text not null default 'propuesta' check (estado in ('propuesta','en_curso','completada')),
  cronologia jsonb,
  lat double precision, lng double precision,
  created_at timestamptz default now()
);

create table equipo (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  nombre text not null, cargo_es text not null, cargo_va text not null,
  bio_es text, bio_va text, foto text, orden int default 0,
  areas jsonb, redes jsonb,
  activo boolean default true,
  created_at timestamptz default now()
);

-- ============ USUARIOS Y PARTICIPACIÓN (Fase 3) ============

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nombre text, apellidos text,
  barrio_id uuid references barrios(id),
  lang text default 'es' check (lang in ('es','va')),
  rol text not null default 'registrado' check (rol in ('registrado','afiliado','moderador','admin')),
  created_at timestamptz default now()
);

-- trigger: crear profile al registrarse
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end $$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create table proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id),
  contacto_nombre text, contacto_email text,     -- solo propuestas de Fase 1 (sin cuenta)
  titulo text not null check (char_length(titulo) between 5 and 140),
  descripcion text not null check (char_length(descripcion) between 30 and 5000),
  categoria text not null, barrio_id uuid references barrios(id),
  estado text not null default 'pendiente_moderacion'
    check (estado in ('pendiente_moderacion','publicada','rechazada','aprobada','en_estudio')),
  motivo_rechazo text,
  moderated_by uuid references profiles(id), moderated_at timestamptz,
  created_at timestamptz default now()
);

create table votes (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references proposals(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  valor smallint not null check (valor in (1,-1)),
  created_at timestamptz default now(),
  unique (proposal_id, user_id)                  -- 1 persona = 1 voto
);

create table comments (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references proposals(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  texto text not null check (char_length(texto) between 2 and 2000),
  estado text not null default 'pendiente' check (estado in ('pendiente','publicado','oculto')),
  created_at timestamptz default now()
);

create view proposal_vote_counts as
  select proposal_id,
         count(*) filter (where valor = 1)  as a_favor,
         count(*) filter (where valor = -1) as en_contra
  from votes group by proposal_id;

-- ============ AFILIACIÓN, PAGOS Y DONACIONES (Fase 4) ============

create table members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique not null references profiles(id),
  dni_encrypted text not null,        -- AES-256-GCM (iv:cipher:tag base64), clave en env
  dni_hash text unique not null,      -- sha256 para deduplicar sin descifrar
  direccion text not null, cp text not null, telefono text,
  fecha_nacimiento date,
  cuota_tipo text not null check (cuota_tipo in ('mensual','anual','reducida')),
  estado text not null default 'pendiente_pago'
    check (estado in ('pendiente_pago','activo','impago','baja')),
  stripe_customer_id text unique, stripe_subscription_id text unique,
  consent_estatutos_at timestamptz not null,
  fecha_alta timestamptz, fecha_baja timestamptz,
  created_at timestamptz default now()
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id),
  stripe_invoice_id text unique not null,
  importe_cents int not null, moneda text default 'eur',
  estado text not null check (estado in ('pagado','fallido','reembolsado')),
  periodo_inicio date, periodo_fin date,
  created_at timestamptz default now()
);

create table donations (
  id uuid primary key default gen_random_uuid(),
  donor_nombre text not null, donor_apellidos text not null,
  donor_dni_encrypted text not null, donor_dni_hash text not null,
  donor_email text not null,
  importe_cents int not null check (importe_cents between 500 and 1000000),
  ejercicio int not null,
  declaracion_persona_fisica boolean not null check (declaracion_persona_fisica),
  declaracion_fondos_propios boolean not null check (declaracion_fondos_propios),
  stripe_payment_intent text unique,
  estado text not null default 'iniciada' check (estado in ('iniciada','pagada','fallida','reembolsada')),
  certificado_enviado boolean default false,
  created_at timestamptz default now()
);
create index donations_limite on donations (donor_dni_hash, ejercicio) where estado = 'pagada';

create table consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id),
  email text,
  tipo text not null check (tipo in ('newsletter','privacidad','afiliacion','donacion','cookies')),
  texto_version text not null,
  ip text, user_agent text,
  created_at timestamptz default now()
);

create table stripe_events (        -- idempotencia de webhooks
  id text primary key,
  created_at timestamptz default now()
);

create table audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid, accion text not null, tabla text not null, registro_id text,
  detalle jsonb, created_at timestamptz default now()
);

-- ============ ROW LEVEL SECURITY ============

alter table barrios      enable row level security;
alter table posts        enable row level security;
alter table events       enable row level security;
alter table campaigns    enable row level security;
alter table actuaciones  enable row level security;
alter table equipo       enable row level security;
alter table profiles     enable row level security;
alter table proposals    enable row level security;
alter table votes        enable row level security;
alter table comments     enable row level security;
alter table members      enable row level security;
alter table payments     enable row level security;
alter table donations    enable row level security;
alter table consents     enable row level security;
alter table stripe_events enable row level security;
alter table audit_log    enable row level security;

create or replace function public.my_rol() returns text
language sql stable security definer set search_path = public as
$$ select rol from profiles where id = auth.uid() $$;

-- Contenido: lectura pública de lo publicado; escritura solo service_role (Directus/Functions)
create policy pub_barrios on barrios for select using (true);
create policy pub_equipo  on equipo  for select using (activo);
create policy pub_posts   on posts   for select using (estado = 'publicado' or my_rol() in ('moderador','admin'));
create policy pub_events  on events  for select using (estado = 'publicado' or my_rol() in ('moderador','admin'));
create policy pub_campaigns on campaigns for select using (estado in ('activa','finalizada') or my_rol() in ('moderador','admin'));
create policy pub_actuaciones on actuaciones for select using (true);

-- Profiles: cada uno el suyo; moderadores todo; el rol NO se autoedita
create policy own_profile_sel on profiles for select using (id = auth.uid() or my_rol() in ('moderador','admin'));
create policy own_profile_upd on profiles for update using (id = auth.uid())
  with check (id = auth.uid() and rol = (select rol from profiles p where p.id = auth.uid()));

-- Proposals: públicas las moderadas; el autor ve las suyas; crear requiere sesión
create policy prop_sel on proposals for select
  using (estado in ('publicada','aprobada','en_estudio') or user_id = auth.uid() or my_rol() in ('moderador','admin'));
create policy prop_ins on proposals for insert
  with check (auth.uid() is not null and user_id = auth.uid());
create policy prop_mod on proposals for update using (my_rol() in ('moderador','admin'));

-- Votes: el usuario gestiona su voto; recuentos vía vista
create policy vote_sel on votes for select using (user_id = auth.uid() or my_rol() in ('moderador','admin'));
create policy vote_ins on votes for insert with check (user_id = auth.uid());
create policy vote_upd on votes for update using (user_id = auth.uid());
create policy vote_del on votes for delete using (user_id = auth.uid());

-- Comments: públicos los publicados; crear con sesión; moderar moderadores
create policy com_sel on comments for select
  using (estado = 'publicado' or user_id = auth.uid() or my_rol() in ('moderador','admin'));
create policy com_ins on comments for insert with check (user_id = auth.uid());
create policy com_mod on comments for update using (my_rol() in ('moderador','admin'));

-- members/payments/donations/consents/stripe_events: SIN políticas => solo service_role.
-- audit_log: lectura solo admin; insert vía service_role/trigger; nunca update/delete.
create policy audit_sel on audit_log for select using (my_rol() = 'admin');
revoke update, delete on audit_log from anon, authenticated;

-- ============ SEED: barrios reales de Gandia ============
insert into barrios (slug, nombre_es, nombre_va, lat, lng) values
 ('centro','Centro','Centre',38.9670,-0.1810),
 ('grao','Playa-Grao','Platja-Grau',38.9930,-0.1620),
 ('beniopa','Beniopa','Beniopa',38.9720,-0.1950),
 ('benipeixcar','Benipeixcar','Benipeixcar',38.9620,-0.1890),
 ('santa-anna','Santa Anna','Santa Anna',38.9750,-0.1750),
 ('corea','Corea','Corea',38.9700,-0.1870),
 ('marchuquera','Marchuquera','Marxuquera',38.9450,-0.2350);
