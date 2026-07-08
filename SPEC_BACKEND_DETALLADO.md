# Acción Civil Gandia — Especificación técnica del backend (hiperdetallada)
> Fecha: 2026-07-07 · Complementa a `AUDITORIA_Y_ROADMAP_BACKEND.md` (visión general y justificación).
> **Propósito de este documento:** que cualquier desarrollador o IA pueda ejecutar cada fase sin tomar decisiones de arquitectura — todas están tomadas aquí. Trabajar fase a fase, en orden, marcando checkboxes.

---

## 0. Mapa general de piezas

```
[Usuario] ⇄ Cloudflare Pages (web estática .dc.html)
                │
                ├── /api/* → Cloudflare Pages Functions (carpeta /functions del repo)
                │       ├── valida Turnstile + rate limit
                │       ├── lee/escribe en Supabase (service_role key, SOLO en server)
                │       ├── envía emails vía Resend
                │       ├── alta newsletter vía Brevo API
                │       └── crea sesiones y recibe webhooks de Stripe
                │
                ├── Supabase (región eu-central-1, Frankfurt)
                │       ├── Postgres (todas las tablas, RLS activado)
                │       ├── Auth (email+password, magic link)
                │       └── Storage (imágenes de contenido, docs PDF)
                │
                └── Directus (panel admin, apunta al MISMO Postgres de Supabase)
                        └── el equipo edita: posts, events, campaigns, actuaciones, equipo
```

**Reglas globales (aplican a TODO el documento):**
1. La clave `service_role` de Supabase JAMÁS sale del servidor (solo en Functions). El frontend usa la clave `anon` + RLS.
2. Todo endpoint POST público lleva: verificación **Turnstile**, **rate limit** (KV de Cloudflare, 10 req/h/IP por endpoint) y validación de esquema (rechazar campos extra).
3. Todos los emails salen de `no-reply@accioncivilgandia.org` (dominio verificado en Resend con SPF+DKIM+DMARC).
4. Respuestas de error uniformes: `{ "error": { "code": "string", "message": "string" } }` con HTTP 400/401/403/404/429/500. Nunca filtrar stack traces.
5. Fechas siempre `timestamptz` en UTC; el frontend formatea a `Europe/Madrid`.
6. Bilingüe: toda tabla de contenido tiene columnas `_es` y `_va`. Nunca una sola columna "traducible".

---

> **CAMBIO 2026-07-07 — hosting temporal Netlify.** Hasta tener el dominio oficial, el deploy es en **Netlify** (subdominio `*.netlify.app`, gratis, desde repo GitHub o drag&drop). Equivalencias respecto a este spec: `_headers` y `_redirects` funcionan idénticos (son formato nativo de Netlify); las Functions van en **`netlify/functions/`** con handlers formato Netlify (no `functions/api/`); las env vars se configuran en Site settings → Environment variables; el rate limiting con KV de Cloudflare se sustituye por Netlify Blobs o Upstash Redis (free tier). Al comprar el dominio se decide: quedarse en Netlify o migrar a Cloudflare Pages (cambio de ~1 hora, todo lo demás es portable). La Home fue renombrada `Acción Civil Gandia.dc.html` → **`index.html`** y `_redirects` regenerado con las 63 URLs canónicas del sitemap + 13 alias.

## 1. Repositorio y estructura de carpetas (Fase 0)

Repo existente: `https://github.com/WHITE5S5/accion-civil-gandia`. Estructura objetivo:

```
/                          # raíz = sitio estático actual (los .dc.html)
├── *.dc.html
├── assets/
├── support.js
├── _headers               # NUEVO — headers de seguridad (formato Cloudflare Pages)
├── _redirects             # NUEVO — URLs limpias → archivos reales
├── functions/             # NUEVO — Cloudflare Pages Functions (rutas /api/*)
│   └── api/
│       ├── contacto.ts
│       ├── newsletter.ts
│       ├── newsletter-confirm.ts
│       ├── propuestas.ts
│       ├── posts.ts            # GET listado
│       ├── posts/[slug].ts     # GET detalle
│       ├── events.ts
│       ├── campaigns.ts
│       ├── actuaciones.ts
│       ├── votos.ts
│       ├── comentarios.ts
│       ├── afiliacion.ts
│       ├── donaciones.ts
│       ├── cuenta/
│       │   ├── export.ts       # GET — RGPD derecho de acceso
│       │   └── borrar.ts       # POST — RGPD derecho de supresión
│       └── stripe/
│           └── webhook.ts
├── supabase/
│   └── migrations/        # NUEVO — SQL versionado (001_init.sql, 002_...)
├── scripts/               # los .py existentes de mantenimiento batch
└── docs/                  # este spec + auditoría
```

### 1.1 `_headers` (contenido exacto de partida)

```
/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' https://unpkg.com https://challenges.cloudflare.com https://js.stripe.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com; font-src https://fonts.gstatic.com; img-src 'self' data: https://*.tile.openstreetmap.org https://*.supabase.co; connect-src 'self' https://*.supabase.co https://api.stripe.com; frame-src https://challenges.cloudflare.com https://js.stripe.com
```
> Nota: `unsafe-inline` es necesario porque el dc-runtime usa estilos/scripts inline. Al migrar a Astro (Fase 6) se elimina. `unpkg.com` es por Leaflet (Home).

### 1.2 `_redirects` (URLs limpias — lista completa)

```
/                        /Acción%20Civil%20Gandia.dc.html   200
/conocenos               /Conocenos.dc.html                 200
/conocenos/historia      /Historia.dc.html                  200
/conocenos/equipo        /Equipo.dc.html                    200
/conocenos/valores       /Valores.dc.html                   200
/conocenos/faq           /FAQ.dc.html                       200
/propuestas              /Propuestas.dc.html                200
/propuestas/programa-pdf /ProgramaPDF.dc.html               200
/participacion           /Participacion.dc.html             200
/participacion/como-funciona /ComoFunciona.dc.html          200
/participacion/crear     /CrearPropuesta.dc.html            200
/contacto                /Contacto.dc.html                  200
/accion                  /Accion.dc.html                    200
/accion/mapa             /MapaActuaciones.dc.html           200
/campanas                /Campanas.dc.html                  200
/transparencia           /Transparencia.dc.html             200
/actualidad              /Actualidad.dc.html                200
/agenda                  /Agenda.dc.html                    200
/participa               /Participa.dc.html                 200
/mi-cuenta               /Ciudadano.dc.html                 200
/buscar                  /Buscador.dc.html                  200
/aviso-legal             /AvisoLegal.dc.html                200
/privacidad              /Privacidad.dc.html                200
/cookies                 /Cookies.dc.html                   200
/accesibilidad           /Accesibilidad.dc.html             200
/sitemap-web             /Sitemap.dc.html                   200
```
> Tras crearlas: actualizar `sitemap.xml` y los `canonical` de cada página a la URL limpia. Los `.dc.html` siguen funcionando (200, no 301) hasta la migración Astro.

### 1.3 Variables de entorno (Cloudflare Pages → Settings → Environment variables)

| Variable | Fase | Descripción |
|---|---|---|
| `SUPABASE_URL` | 2 | URL del proyecto |
| `SUPABASE_ANON_KEY` | 2 | clave pública (también en frontend) |
| `SUPABASE_SERVICE_ROLE_KEY` | 2 | **secreta** — solo Functions |
| `TURNSTILE_SECRET_KEY` | 1 | verificación server-side |
| `RESEND_API_KEY` | 1 | email transaccional |
| `BREVO_API_KEY` | 1 | newsletter |
| `BREVO_LIST_ID_ES` / `BREVO_LIST_ID_VA` | 1 | listas por idioma |
| `STRIPE_SECRET_KEY` | 4 | `sk_live_...` (en preview: `sk_test_...`) |
| `STRIPE_WEBHOOK_SECRET` | 4 | `whsec_...` |
| `STRIPE_PRICE_CUOTA_MENSUAL` / `_ANUAL` / `_REDUCIDA` | 4 | price IDs |
| `CONTACT_INBOX` | 1 | `info@accioncivilgandia.org` |
| `APP_BASE_URL` | 0 | `https://accioncivilgandia.org` |
| `ENCRYPTION_KEY` | 3 | AES-256 para cifrado de DNI (32 bytes base64) |

### 1.4 Checklist Fase 0

- [ ] Conectar repo a Cloudflare Pages (build command: ninguno; output dir: `/`). Branch `main` = producción; PRs = preview automático.
- [ ] DNS del dominio `accioncivilgandia.org` a Cloudflare; HTTPS full strict.
- [ ] Subir `_headers` y `_redirects` (contenido de arriba).
- [ ] Umami: instancia cloud gratuita (eu.umami.is) o self-host; añadir `<script defer src=".../script.js" data-website-id="...">` en el `<helmet>` de las 60 páginas (script Python batch, patrón ya usado en el proyecto).
- [ ] Sentry browser SDK en Home (la página con más JS) — DSN en snippet, sample rate 0.1.
- [ ] UptimeRobot: monitor HTTPS a `/` cada 5 min.
- [ ] og:image: crear `assets/og-home.webp` 1200×630 + 7 variantes de sección; añadir `<meta property="og:image">` batch.
- [ ] Ocultar preview widget: añadir `[data-om-raster]{display:none!important}` o equivalente en todas las páginas (verificar selector real del widget en una subpágina antes del batch).
- [ ] Excluir `*-print-*` del `sitemap.xml`.
- [ ] Fix a11y `FichaEvento-barrio` (contraste, headings, labels — score 71).

**Criterio de aceptación F0:** web en dominio real, Lighthouse BP ≥ 96 mantiene, headers verificados en securityheaders.com (A), analytics registrando, preview widget invisible en producción.

---

## 2. Fase 1 — Formularios y newsletter

### 2.1 `POST /api/contacto`

Request:
```json
{ "nombre": "string 2-80", "email": "email", "asunto": "string 2-120", "mensaje": "string 10-4000", "lang": "es|va", "turnstileToken": "string" }
```
Flujo: (1) rate limit KV → (2) verificar token contra `https://challenges.cloudflare.com/turnstile/v0/siteverify` → (3) honeypot: si llega el campo oculto `telefono2` relleno, responder 200 y descartar → (4) Resend: email a `CONTACT_INBOX` con reply-to del remitente → (5) `201 { "ok": true }`.
Frontend: `Contacto.dc.html` — sustituir `onsubmit="event.preventDefault()"` por handler que hace `fetch('/api/contacto')`, muestra estado enviando/ok/error en ambos idiomas, y renderiza el widget Turnstile (sitekey pública).

### 2.2 `POST /api/newsletter` + `GET /api/newsletter-confirm`

Request: `{ "email": "email", "lang": "es|va", "turnstileToken": "string" }`
Flujo double opt-in (obligatorio RGPD):
1. Generar token firmado (HMAC con `ENCRYPTION_KEY`, payload `email|lang|timestamp`, caducidad 48 h).
2. Resend: email "Confirma tu suscripción" con link `APP_BASE_URL/api/newsletter-confirm?t=<token>`.
3. En confirm: validar HMAC + caducidad → alta en Brevo (`POST /v3/contacts`, lista según `lang`, atributo `CONSENT_TS`) → insertar fila en `consents` (ver §3) → redirect 302 a `/gracias-newsletter` (página estática nueva, crear con patrón de subpágina estándar).
Frontend: el formulario del footer existe en las ~60 páginas → hacer el handler una sola vez y aplicarlo por script batch (mismo patrón que `update_nav_connectivity.py`).

### 2.3 `POST /api/propuestas` (versión F1 — buzón)

Request: `{ "titulo": "5-140", "descripcion": "50-5000", "categoria": "enum de las 13", "barrio": "enum de los 9", "nombre": "2-80", "email": "email", "lang", "turnstileToken" }`
Flujo: validar → insertar en `proposals` con `estado='pendiente_moderacion'` y `user_id=null` → email de aviso al equipo → `201`.
Frontend: `CrearPropuesta.dc.html` (formulario 3 pasos ya maquetado) — conectar el submit final.
> En F3 este endpoint pasa a exigir sesión y rellenar `user_id`.

**Criterio de aceptación F1:** los 3 formularios envían de verdad; email de prueba recibido; alta en Brevo solo tras confirmar; spam con token inválido → 403; 11ª petición en 1 h → 429.

---

## 3. Fase 2 — Esquema de base de datos completo (Supabase)

Crear como migración `supabase/migrations/001_init.sql`. Convenciones: `id uuid primary key default gen_random_uuid()`, `created_at timestamptz default now()` en todas (no se repite abajo).

### 3.1 Contenido editorial (lo gestiona Directus)

```sql
create table barrios (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,          -- 'beniopa', 'grao', 'corea', 'benipeixcar', 'centro'...
  nombre_es text not null, nombre_va text not null,
  lat double precision, lng double precision
);

create table posts (                   -- Actualidad
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  tipo text not null check (tipo in ('noticia','comunicado','video','entrevista')),
  titulo_es text not null, titulo_va text not null,
  extracto_es text, extracto_va text,
  cuerpo_es text, cuerpo_va text,      -- markdown
  imagen text,                         -- path en Storage bucket 'media'
  video_url text,
  estado text not null default 'borrador' check (estado in ('borrador','publicado','archivado')),
  publicado_at timestamptz,
  created_at timestamptz default now()
);

create table events (                  -- Agenda
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  titulo_es text not null, titulo_va text not null,
  descripcion_es text, descripcion_va text,
  fecha date not null, hora_inicio time, hora_fin time,
  lugar text, direccion text,
  barrio_id uuid references barrios(id),
  programa jsonb,                      -- [{hora, titulo_es, titulo_va}]
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
  objetivos jsonb,                     -- [{titulo_es, titulo_va, completado bool}]
  cronologia jsonb,                    -- [{fecha, hito_es, hito_va}]
  docs jsonb,                          -- [{titulo, url}]
  estado text not null default 'activa' check (estado in ('borrador','activa','finalizada')),
  created_at timestamptz default now()
);

create table actuaciones (             -- Acción en Gandia
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
  slug text unique not null,           -- 'alejandro-alcazar'...
  nombre text not null, cargo_es text not null, cargo_va text not null,
  bio_es text, bio_va text, foto text, orden int default 0,
  areas jsonb, redes jsonb,
  activo boolean default true
);
```

### 3.2 Usuarios y participación

```sql
create table profiles (                -- 1:1 con auth.users (trigger on signup)
  id uuid primary key references auth.users(id) on delete cascade,
  nombre text, apellidos text,
  barrio_id uuid references barrios(id),
  lang text default 'es' check (lang in ('es','va')),
  rol text not null default 'registrado' check (rol in ('registrado','afiliado','moderador','admin')),
  created_at timestamptz default now()
);

create table proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id),          -- null solo en las de F1 (buzón anónimo)
  contacto_nombre text, contacto_email text,     -- solo si user_id null
  titulo text not null, descripcion text not null,
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
  unique (proposal_id, user_id)                  -- 1 persona = 1 voto (regla de oro)
);

create table comments (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references proposals(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  texto text not null check (char_length(texto) between 2 and 2000),
  estado text not null default 'pendiente' check (estado in ('pendiente','publicado','oculto')),
  created_at timestamptz default now()
);
```

### 3.3 Afiliación, pagos y donaciones (F4 pero se crea el esquema ya)

```sql
create table members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique not null references profiles(id),
  dni_encrypted text not null,         -- AES-256-GCM con ENCRYPTION_KEY, cifrado en la Function
  dni_hash text unique not null,       -- sha256(dni normalizado) — para deduplicar sin descifrar
  direccion text not null, cp text not null, telefono text,
  fecha_nacimiento date,
  cuota_tipo text not null check (cuota_tipo in ('mensual','anual','reducida')),
  estado text not null default 'pendiente_pago'
    check (estado in ('pendiente_pago','activo','impago','baja')),
  stripe_customer_id text unique, stripe_subscription_id text unique,
  consent_estatutos_at timestamptz not null,     -- aceptación explícita (RGPD art. 9)
  fecha_alta timestamptz, fecha_baja timestamptz,
  created_at timestamptz default now()
);

create table payments (                -- cada cobro de cuota (desde webhooks)
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
  donor_dni_encrypted text not null, donor_dni_hash text not null,   -- NO unique: varias donaciones/persona
  donor_email text not null,
  importe_cents int not null check (importe_cents between 500 and 1000000),  -- 5 € a 10.000 €/operación
  ejercicio int not null,              -- año fiscal, para el límite y el Tribunal de Cuentas
  declaracion_persona_fisica boolean not null check (declaracion_persona_fisica),
  declaracion_fondos_propios boolean not null check (declaracion_fondos_propios),
  stripe_payment_intent text unique,
  estado text not null default 'iniciada' check (estado in ('iniciada','pagada','fallida','reembolsada')),
  certificado_enviado boolean default false,
  created_at timestamptz default now()
);
create index donations_limite on donations (donor_dni_hash, ejercicio) where estado = 'pagada';

create table consents (                -- registro probatorio RGPD
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id),
  email text,                          -- para consents sin cuenta (newsletter)
  tipo text not null check (tipo in ('newsletter','privacidad','afiliacion','donacion','cookies')),
  texto_version text not null,         -- ej. 'privacidad-v2026-07'
  ip text, user_agent text,
  created_at timestamptz default now()
);

create table audit_log (               -- INSERT-only (revocar UPDATE/DELETE a todos los roles)
  id bigint generated always as identity primary key,
  actor_id uuid, accion text not null, tabla text not null, registro_id text,
  detalle jsonb, created_at timestamptz default now()
);
```

### 3.4 Row Level Security — políticas exactas

Activar `alter table X enable row level security;` en TODAS. Resumen de políticas (implementar literal):

| Tabla | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| posts/events/campaigns/actuaciones/equipo/barrios | público si `estado='publicado'` (o sin estado); todo para rol moderador+ | solo service_role/Directus | ídem | ídem |
| profiles | el propio usuario (`auth.uid() = id`); moderador+ todo | trigger de signup | el propio usuario (solo nombre/apellidos/barrio/lang, NO rol) | nadie (baja = borrar auth.users, cascade) |
| proposals | público si `estado='publicada' or 'aprobada' or 'en_estudio'`; el autor ve las suyas; moderador+ todo | usuario autenticado (`user_id = auth.uid()`) | moderador+ (estado); autor solo si `pendiente_moderacion` | admin |
| votes | agregado público vía vista `proposal_vote_counts` (no filas individuales); el usuario ve su voto | autenticado, `user_id = auth.uid()` | el propio (cambiar sentido) | el propio |
| comments | público si `estado='publicado'`; autor las suyas; moderador+ todo | autenticado | moderador (estado) | admin |
| members/payments/donations/consents | **solo service_role** (nunca cliente); el afiliado accede a SU ficha solo vía endpoint | solo service_role | solo service_role | nadie |
| audit_log | admin | service_role | nadie | nadie |

```sql
-- Vista pública de recuento de votos (evita exponer quién votó qué)
create view proposal_vote_counts as
  select proposal_id,
         count(*) filter (where valor = 1)  as a_favor,
         count(*) filter (where valor = -1) as en_contra
  from votes group by proposal_id;
```

**Test obligatorio antes de cerrar F2:** con la clave `anon` intentar leer `members`, `donations`, `consents` y filas `borrador` → debe devolver 0 filas. Documentar el test en `docs/tests-rls.md`.

### 3.5 Directus

- Desplegar Directus (Railway/Fly, imagen oficial) conectado al Postgres de Supabase (connection string con usuario propio `directus_admin`, no el postgres root).
- Colecciones visibles para el rol "Editor" del equipo: posts, events, campaigns, actuaciones, equipo, barrios. Y en solo-lectura+cambio de estado: proposals (moderación), comments (moderación).
- Ocultar por completo: members, payments, donations, consents, audit_log, profiles (solo rol Admin-técnico).
- Storage: configurar Directus para subir a Supabase Storage bucket `media` (público, solo lectura anónima).

### 3.6 Conexión frontend (páginas → datos)

Patrón dc-runtime: en cada página dinámica, `data(lang)` mantiene un fallback estático (lo actual) y en el mount se hace `fetch('/api/...')` → `setState({items})` → `renderVals()` mezcla. Páginas y su fuente:

| Página | Endpoint | Query params |
|---|---|---|
| Actualidad.dc.html | `GET /api/posts` | `?lang=&tipo=&limit=12&offset=` |
| DetallePublicacion*.dc.html | `GET /api/posts/:slug` | — |
| Agenda.dc.html | `GET /api/events` | `?desde=hoy` |
| FichaEvento*.dc.html | `GET /api/events/:slug` | — |
| Campanas.dc.html | `GET /api/campaigns` | `?estado=activa|finalizada` |
| DetalleCampana*.dc.html | `GET /api/campaigns/:slug` | — |
| Accion / MapaActuaciones | `GET /api/actuaciones` | `?barrio=` (incluye lat/lng para Leaflet) |
| Barrio-*.dc.html | `GET /api/actuaciones?barrio=<slug>` | — |
| DetalleActuacion*.dc.html | `GET /api/actuaciones/:slug` | — |
| Equipo / Conocenos / PerfilMiembro | `GET /api/equipo` | — |
| Participacion.dc.html | `GET /api/proposals?estado=publicada` + `proposal_vote_counts` | — |
| Home | `GET /api/home` (agregado: 3 posts + 3 events + campaña destacada + actuaciones para mapa) | — |

Todos estos GET son Functions que consultan Supabase con `anon` key (RLS los protege) y cachean 5 min (`Cache-Control: public, max-age=300`).

**Criterio de aceptación F2:** el equipo publica una noticia en Directus y aparece en Actualidad y Home sin tocar código; test RLS pasado; backup restaurado en proyecto Supabase de prueba y documentado.

---

## 4. Fase 3 — Auth y área ciudadana

### 4.1 Flujos de autenticación (Supabase Auth, JS SDK v2 en frontend)

- Registro: email + password (mín. 10 chars) O magic link. `emailRedirectTo: APP_BASE_URL/mi-cuenta`. Verificación de email OBLIGATORIA (`mailer_autoconfirm=false`).
- En signup: trigger `handle_new_user()` crea fila en `profiles`; el formulario de registro incluye checkbox de privacidad (no premarcado) → insertar `consents(tipo='privacidad')`.
- Sesión en frontend: `supabase.auth.getSession()` en el mount de páginas que lo necesiten (Ciudadano, CrearPropuesta, PropuestaCiudadana, Participa). Si no hay sesión donde se requiere → redirect a `/mi-cuenta` con formulario de login.
- Páginas nuevas a crear (patrón subpágina estándar del CLAUDE.md): `Login.dc.html` (`/entrar`), `Registro.dc.html` (`/registro`), `RecuperarPassword.dc.html`.
- 2FA TOTP obligatorio para `moderador` y `admin` (Supabase MFA). Bloquear acciones de moderación si `aal < aal2`.

### 4.2 Endpoints de participación

| Endpoint | Auth | Contrato |
|---|---|---|
| `POST /api/votos` | sí | `{proposalId, valor: 1|-1}` → upsert en votes → `200 {aFavor, enContra, miVoto}` |
| `DELETE /api/votos` | sí | `{proposalId}` → quita el voto |
| `POST /api/comentarios` | sí | `{proposalId, texto}` → estado `pendiente` → `201` + aviso email a moderadores si cola > 10 |
| `POST /api/propuestas` | **ahora sí** | igual que F1 pero `user_id` de la sesión; sin nombre/email |
| `GET /api/cuenta/export` | sí | JSON con profile + proposals + votes + comments + consents + (si member) ficha sin DNI descifrado |
| `POST /api/cuenta/borrar` | sí | anonimiza comments/proposals (`user_id=null`, texto se conserva si publicado — interés legítimo debate), borra votes, consents marcados revocados, borra auth.user. **Si es member activo:** cancelar sub Stripe primero; conservar members/payments/donations 6 años (obligación mercantil/contable) con datos mínimos |

### 4.3 Moderación

- Cola en Directus (proposals y comments con `estado='pendiente*'`).
- Toda acción de moderación escribe en `audit_log` (`accion='aprobar_propuesta'`, etc.) — hacerlo con trigger en Postgres para que no se pueda saltar.

**Criterio de aceptación F3:** flujo completo real: registro → verificar email → crear propuesta → moderador aprueba → aparece pública → otro usuario vota (y NO puede votar 2 veces ni votar sin sesión) → comenta → moderación → visible. Export y borrado RGPD probados.

---

## 5. Fase 4 — Stripe (afiliación y donaciones)

### 5.1 Configuración en el Dashboard de Stripe

- [ ] Cuenta Stripe con datos fiscales del partido. Activar **SEPA Direct Debit** y tarjeta.
- [ ] Productos/Precios: `Cuota mensual` 5 €/mes, `Cuota anual` 50 €/año, `Cuota reducida` 2 €/mes (ajustar importes con el partido). Guardar los `price_...` en env vars.
- [ ] Customer Portal activado: permitir cambiar método de pago y cancelar; NO permitir cambiar de precio (eso pasa por el partido).
- [ ] Webhook endpoint: `APP_BASE_URL/api/stripe/webhook` con los eventos de §5.4. Copiar `whsec_`.
- [ ] Emails de Stripe (recibos) desactivados — los enviamos nosotros vía Resend con la plantilla propia.
- [ ] Statement descriptor: `ACCION CIVIL GANDIA`.

### 5.2 `POST /api/afiliacion` — alta de afiliado

Request:
```json
{ "nombre": "", "apellidos": "", "dni": "regex DNI/NIE", "fechaNacimiento": "YYYY-MM-DD",
  "direccion": "", "cp": "5 dígitos", "telefono": "opcional",
  "cuotaTipo": "mensual|anual|reducida",
  "aceptaEstatutos": true, "aceptaPrivacidadArt9": true, "turnstileToken": "" }
```
Flujo (requiere sesión):
1. Validar DNI/NIE con algoritmo de letra de control. Normalizar (mayúsculas, sin guiones).
2. `dni_hash = sha256(dni)`. Si ya existe member con ese hash y estado ≠ baja → `409 member_exists`.
3. Mayoría de edad (≥ 18) por `fechaNacimiento`.
4. Cifrar DNI (AES-256-GCM, `ENCRYPTION_KEY`, IV aleatorio por registro, guardar `iv:ciphertext:tag` base64).
5. Insertar `members` estado `pendiente_pago` + `consents(tipo='afiliacion', texto_version='afiliacion-v1')`.
6. Crear/reusar Stripe Customer (`metadata.member_id`), crear **Checkout Session** `mode='subscription'`, `payment_method_types=['sepa_debit','card']`, `success_url=/mi-cuenta?alta=ok&session={CHECKOUT_SESSION_ID}`, `cancel_url=/participa`.
7. `200 { "checkoutUrl": "..." }` → frontend redirige.

Frontend: `Participa.dc.html` → botón "Quiero afiliarme" abre el formulario (nueva página `Afiliacion.dc.html`, `/afiliacion`) → Checkout de Stripe (hosted, no tocamos tarjetas).

### 5.3 `POST /api/donaciones` — donación puntual conforme LO 8/2007

Request:
```json
{ "nombre": "", "apellidos": "", "dni": "", "email": "",
  "importeCents": 1000,
  "declaracionPersonaFisica": true, "declaracionFondosPropios": true,
  "declaracionLimiteAnual": true, "turnstileToken": "" }
```
Flujo (NO requiere cuenta — pero SÍ identificación completa):
1. Las 3 declaraciones deben ser `true` (checkboxes no premarcados) → si no, `400`.
2. Validar DNI/NIE. Importe entre 500 (5 €) y 1.000.000 cents (10.000 €) por operación.
3. **Límite legal:** `SELECT sum(importe_cents) FROM donations WHERE donor_dni_hash=$1 AND ejercicio=$2 AND estado='pagada'`. Si suma + nueva > 5.000.000 cents (50.000 €) → `422 limite_anual_excedido` con mensaje legal.
4. Insertar `donations` estado `iniciada` + `consents(tipo='donacion')`.
5. Checkout Session `mode='payment'`, `metadata.donation_id`, `payment_intent_data.statement_descriptor_suffix='DONATIVO'`.
6. `200 { "checkoutUrl": "..." }`.

Frontend: `Participa.dc.html` sección Dona → nueva página `Donar.dc.html` (`/donar`) con importes sugeridos 10/25/50/100 € + libre, el formulario de identificación y las 3 declaraciones con texto legal literal visible.

### 5.4 `POST /api/stripe/webhook` — evento por evento

**Antes de nada:** `stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET)` — firma inválida → `400`. Idempotencia: tabla `stripe_events (id text primary key)`; si el `event.id` ya existe → `200` y salir.

| Evento | Acción |
|---|---|
| `checkout.session.completed` (mode=subscription) | member → `activo`, `fecha_alta=now()`, guardar `stripe_customer_id` + `stripe_subscription_id`; email bienvenida (plantilla ES/VA según profile.lang); `profiles.rol='afiliado'`; audit_log |
| `checkout.session.completed` (mode=payment) | donation (por `metadata.donation_id`) → `pagada`, guardar `payment_intent`; generar y enviar **certificado de donación** (PDF: datos donante, importe, fecha, NIF del partido, mención a deducción IRPF LO 8/2007 art. 12 bis / Ley 49/2002); `certificado_enviado=true`; audit_log |
| `invoice.paid` | insertar `payments` (estado `pagado`, periodo desde `invoice.lines`); si member estaba `impago` → `activo`; email recibo |
| `invoice.payment_failed` | member → `impago`; email "problema con tu cuota" con link al Customer Portal; Stripe reintenta solo (Smart Retries ON) |
| `customer.subscription.deleted` | member → `baja`, `fecha_baja=now()`; `profiles.rol='registrado'`; email confirmación de baja; audit_log |
| `charge.refunded` | payment/donation → `reembolsada`; audit_log |
| `charge.dispute.created` | email urgente al tesorero |

### 5.5 Portal del afiliado

`GET /api/afiliacion/portal` (auth, member activo) → `stripe.billingPortal.sessions.create({customer, return_url:'/mi-cuenta'})` → `{url}`. Botón "Gestionar mi cuota" en Ciudadano.dc.html.

### 5.6 Contabilidad y Tribunal de Cuentas

- `GET /api/admin/export-contable?ejercicio=2026` (solo admin+2FA): CSV con todas las `donations` pagadas (nombre, apellidos, DNI **descifrado en el momento**, importe, fecha) y `payments` de cuotas. La descarga se registra en audit_log.
- Cuenta bancaria: en Stripe, payouts a la **cuenta específica de donaciones** del partido. Si cuotas y donaciones deben ir a cuentas distintas, separar en dos cuentas Stripe o gestionar la segregación contablemente con este export (decisión del tesorero — dejar documentada).

**Criterio de aceptación F4 (todo en modo test primero):** alta de afiliado completa con SEPA test → member activo + email; impago simulado (`4000000000000341`-equivalente SEPA) → estado impago + email; baja desde Portal → estado baja; donación OK con certificado PDF recibido; donación que supera 50.000 € acumulados → rechazada con 422; webhook con firma falsa → 400; evento duplicado → no duplica filas.

---

## 6. Fase 5 — Seguridad y cumplimiento (checklist ejecutable)

- [ ] **RAT (RGPD art. 30):** documento con los 6 tratamientos: contacto, newsletter, participación, afiliación (art. 9), donaciones, analytics. Por cada uno: finalidad, base jurídica, categorías de datos, plazos de conservación, destinatarios (Supabase, Stripe, Brevo, Resend, Cloudflare — todos con DPA firmado, verificar y archivar los DPA).
- [ ] **DPD:** designar (puede ser externo) y comunicarlo a la AEPD. Para un partido (art. 9 a escala) es prácticamente obligatorio (art. 37.1.b/c RGPD).
- [ ] **EIPD** sobre el tratamiento de afiliados (plantilla AEPD "Gestiona EIPD").
- [ ] **Política de privacidad**: reescribir `Privacidad.dc.html` con los tratamientos reales de arriba (la actual es genérica).
- [ ] **Canal de denuncias Ley 2/2023:** desplegar GlobaLeaks (self-host, Docker, subdominio `denuncias.accioncivilgandia.org`) o equivalente con anonimato, acuse en 7 días, resolución 3 meses, responsable designado. Sustituir el mailto del footer (60 páginas, script batch).
- [ ] Hardening: revisar TODAS las políticas RLS con un test automatizado (script que intenta cada operación con anon/user/otro-user); rate limit global Cloudflare (100 req/min/IP a /api/*); rotar `ENCRYPTION_KEY` documentando el procedimiento de recifrado; secrets scan en CI (gitleaks).
- [ ] Backups: PITR de Supabase (plan Pro) o `pg_dump` nocturno a R2 con retención 30 días; **simulacro de restauración trimestral** anotado en `docs/runbook.md`.
- [ ] `docs/runbook.md`: qué hacer si (a) filtración de datos → contener, evaluar, **notificar AEPD < 72 h**, notificar afectados si alto riesgo; (b) caída de Supabase; (c) disputa Stripe; (d) defacement.
- [ ] Pentest ligero externo o revisión con OWASP ZAP baseline antes de campaña electoral.

---

## 7. Fase 6 — Migración a Astro (guía para cuando toque)

1. `npm create astro@latest` en carpeta `/astro` del repo; portar design tokens a `src/styles/tokens.css`; componentes `Nav.astro`, `Footer.astro`, `Hero.astro`, `Breadcrumb.astro` copiando el HTML/CSS documentado en `CLAUDE_ACCION_CIVIL.md`.
2. i18n con rutas: `/es/...` implícito en raíz y `/va/...` (astro-i18n o routing manual) — sustituye el sistema `localStorage acg_lang` por URLs indexables (mejor SEO que el actual).
3. Contenido: en build, fetch a la API de Directus → páginas estáticas; rebuild automático vía deploy hook de Cloudflare llamado por webhook de Directus al publicar.
4. Islands (única JS en cliente): mapa Leaflet, buscador, votos/comentarios (usan Supabase JS), formularios.
5. Migrar por orden: Home → Actualidad/Agenda (las más dinámicas) → resto. Los `_redirects` pasan de 200 a 301 hacia las rutas nuevas cuando cada página migra.
6. Al terminar: eliminar `unsafe-inline` del CSP, presupuesto Lighthouse en CI: Perf ≥ 90, A11y ≥ 95, SEO = 100.

---

## 8. Orden de ejecución y dependencias (resumen para la siguiente sesión)

```
F0 (nada depende de fuera) → F1 (necesita F0: functions desplegadas)
→ F2 (necesita cuenta Supabase; Directus necesita F2.1-3.3 aplicadas)
→ F3 (necesita F2: profiles/RLS) → F4 (necesita F3: auth para afiliación; donaciones solo F2)
→ F5 (transversal, arrancar en paralelo desde F2) → F6 (cualquier momento tras F2)
```

**Empezar SIEMPRE por:** leer `CLAUDE.md` del proyecto + `CLAUDE_ACCION_CIVIL.md` (memoria técnica del frontend) + este spec. Marcar los checkboxes aquí al completar. Errores nuevos → sección "Errores a no repetir" del CLAUDE.md.
