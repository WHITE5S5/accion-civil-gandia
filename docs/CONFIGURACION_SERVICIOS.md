# Guía de activación de servicios — qué hacer cuando vuelvas
> Estado 2026-07-07: TODO el código de la Fase 1 está escrito, testeado (20/20 + 10/10 tests)
> y desplegable. Las Fases 2 y 4 tienen el código y el SQL listos. Solo faltan las cuentas
> y las claves — nada de programar. Tiempo estimado total: ~45 min.

## Paso 0 — Redeploy con las funciones (5 min) — SIN CUENTAS NUEVAS

La carpeta `deploy_netlify/` ya incluye `netlify/functions/`. Dos opciones:

- **Opción A (recomendada):** deploy por CLI, soporta funciones siempre:
  ```
  npx netlify-cli login          (una vez, abre el navegador)
  npx netlify-cli link           (elegir el site accioncivilgandia)
  npx netlify-cli deploy --prod --dir=deploy_netlify
  ```
- **Opción B:** drag&drop de `deploy_netlify` como hasta ahora. ⚠ Verificar tras subir que
  `https://accioncivilgandia.netlify.app/api/contacto` responde `405` (y no `404`).
  Si da 404, el drag&drop no ha empaquetado las funciones → usar la Opción A.

**Comportamiento actual sin claves:** los formularios validan y responden
"El envío automático aún no está activo…" (503 controlado). No se pierde nada.

## Paso 1 — Resend: emails de contacto y propuestas (10 min)

1. Crear cuenta en https://resend.com (gratis: 100 emails/día).
2. API Keys → Create → copiar `re_...`
3. En Netlify: **Site configuration → Environment variables** → añadir:
   - `RESEND_API_KEY` = `re_...`
   - `CONTACT_INBOX` = email donde quieres recibir los mensajes (ej. tu gmail o info@)
4. *(Opcional ahora, necesario en serio)*: Domains → Add domain → `accioncivilgandia.org`
   cuando exista el dominio → añade los registros DNS que te dé → entonces
   `EMAIL_FROM` = `Acción Civil Gandia <no-reply@accioncivilgandia.org>`.
   Sin dominio verificado Resend solo entrega al email de tu propia cuenta (vale para probar).
5. Redeploy (las env vars solo se aplican al redesplegar funciones):
   `npx netlify-cli deploy --prod --dir=deploy_netlify`
6. **Probar:** formulario de Contacto en la web → debe llegarte el email.

## Paso 2 — Newsletter con double opt-in (10 min)

1. Generar un secreto (PowerShell):
   `[Convert]::ToBase64String((1..32|%{Get-Random -Max 256}))`
2. Env var en Netlify: `NEWSLETTER_SECRET` = ese valor.
3. Crear cuenta Brevo https://www.brevo.com (gratis 300 emails/día):
   - Contacts → Lists → crear lista "Newsletter ES" y "Newsletter VA" → apuntar los IDs numéricos.
   - Settings → SMTP & API → API Keys → crear.
4. Env vars: `BREVO_API_KEY`, `BREVO_LIST_ID_ES`, `BREVO_LIST_ID_VA`.
5. `APP_BASE_URL` = `https://accioncivilgandia.netlify.app` (cambiar al dominio real cuando exista).
6. Redeploy y probar: footer → email → llega "Confirma tu suscripción" → click → página verde → contacto aparece en Brevo con `CONSENT_TS`.

## Paso 3 — Anti-spam Turnstile (5 min, cuando haya tráfico real)

1. https://dash.cloudflare.com → Turnstile → Add site → dominio `accioncivilgandia.netlify.app`.
2. Env var: `TURNSTILE_SECRET_KEY` = secret key.
3. Avisar a Claude para añadir el widget al frontend (sitekey pública) — 10 min de código.
   Mientras no exista la env var, la API no lo exige (honeypot + rate limit siguen activos).

## Paso 4 — Supabase (Fase 2, 15 min)

1. https://supabase.com → New project → **región Frankfurt (eu-central-1)** → guardar la contraseña de BD.
2. SQL Editor → pegar `supabase/migrations/001_init.sql` completo → Run.
3. Repetir con `002_members_inbox.sql`.
4. Repetir con `003_public_api_grants.sql`.
5. Env vars en Netlify:
   - `SUPABASE_URL` (Settings→API)
   - `SUPABASE_SERVICE_ROLE_KEY` (la service_role, NO la anon)
   - `SUPABASE_ANON_KEY` (lectura pública vía Functions Fase 2)
6. Test RLS obligatorio: con la anon key, `GET {SUPABASE_URL}/rest/v1/members?select=*` → debe devolver `[]`.
7. Ver guía de comprobación manual en `docs/tests-rls.md`.

## Paso 4.1 — Directus (Fase 2, 15-20 min)

1. Usar el material de `directus/` del repo (`.env.example` + `docker-compose.yml`) como base local o en Railway/Fly.
2. Crear un usuario/rol técnico de solo Directus sobre el Postgres de Supabase.
3. Configurar en Directus las colecciones editoriales:
   - `posts`, `events`, `campaigns`, `actuaciones`, `equipo`, `barrios`
   - `proposals` y `comments` como moderación
4. Ocultar al rol editor:
   - `members`, `payments`, `donations`, `consents`, `audit_log`, `profiles`
5. Publicar una noticia de prueba y comprobar:
   - `/api/posts?lang=es`
   - `/actualidad`
   - `/api/home`

## Paso 5 — Stripe (Fase 4, cuando el partido lo decida)

⚠ **Antes de activar donaciones reales, leer la sección legal del roadmap (LO 8/2007).**

1. Cuenta Stripe con los datos fiscales del partido. Empezar en **modo test**.
2. Products → crear: Cuota mensual (5 €/mes), Cuota anual (50 €/año), Cuota reducida (2 €/mes)
   → copiar los `price_...`.
3. Env vars: `STRIPE_SECRET_KEY` (sk_test primero), `STRIPE_PRICE_CUOTA_MENSUAL`, `_ANUAL`, `_REDUCIDA`.
4. Developers → Webhooks → Add endpoint → `https://accioncivilgandia.netlify.app/api/stripe/webhook`
   → eventos: `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`,
   `customer.subscription.deleted`, `charge.refunded`, `charge.dispute.created`
   → copiar `whsec_...` → env var `STRIPE_WEBHOOK_SECRET`.
5. Generar `ENCRYPTION_KEY` (32 bytes base64, mismo comando del Paso 2.1) — **guardar copia
   segura fuera de Netlify: sin ella los DNI cifrados son irrecuperables.**
6. Settings → Customer portal → activar (cambiar método de pago + cancelar).
7. Falta frontend: páginas `/afiliacion` y `/donar` (formularios) — pedírselas a Claude
   cuando llegues aquí; los endpoints ya están listos y testeados.

## Resumen de variables de entorno

| Variable | Servicio | Fase |
|---|---|---|
| RESEND_API_KEY, CONTACT_INBOX, EMAIL_FROM | Resend | 1 |
| NEWSLETTER_SECRET | (propia) | 1 |
| BREVO_API_KEY, BREVO_LIST_ID_ES, BREVO_LIST_ID_VA | Brevo | 1 |
| APP_BASE_URL | — | 1 |
| TURNSTILE_SECRET_KEY | Cloudflare | 1 (opcional) |
| SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY | Supabase | 2 |
| STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_CUOTA_* | Stripe | 4 |
| ENCRYPTION_KEY | (propia, 32 bytes base64) | 4 |

## Cómo probar las funciones en local (sin Netlify)

```
node scripts/test_functions.mjs     # 20 tests de la Fase 1
```
