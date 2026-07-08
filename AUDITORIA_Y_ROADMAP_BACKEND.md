# Acción Civil Gandia — Auditoría completa + Roadmap de Backend
> Fecha: 2026-07-07 · Auditor: Claude Code · Alcance: 60 páginas `.dc.html`, assets, SEO, a11y, performance, arquitectura y plan de backend/integraciones.

---

# PARTE 1 — AUDITORÍA DEL FRONTEND

## 1.1 Calificación global: **8,4 / 10** — frontend listo para publicar como web informativa; NO listo para operar (formularios, pagos y área ciudadana son maquetas sin backend)

| Dimensión | Nota | Evidencia |
|---|---|---|
| Propuesta visual / diseño | 9,5 | Sistema de diseño coherente (tokens navy/blue/teal/gold, Bricolage + Public Sans), 60 páginas consistentes, grids centrados, heroes correctos |
| Cobertura de contenido | 9 | Sitemap 100% completo, contenido real scrapeado, bilingüe ES/VA íntegro |
| SEO | 9,5 | Media 97,2 (Lighthouse). JSON-LD PoliticalParty, hreflang, canonical, sitemap.xml, robots.txt. **Falta og:image** |
| Best Practices | 9,5 | 96 uniforme en las 60 páginas |
| Accesibilidad | 8,5 | Media 91,3. Outliers: FichaEvento-barrio (71), páginas print (82) |
| **Performance** | **6,9** | **Media 69. Peores: Home 58, Campañas 58, Actualidad 61.** Causa: render 100% cliente (dc-runtime), Leaflet en Home, fuentes bloqueantes |
| Funcionalidad real | 3 | Formularios con `preventDefault()` sin destino, newsletter no envía, 0 llamadas a API, donaciones/afiliación son CTAs muertos, área Ciudadano es demo sin auth |
| Mantenibilidad | 6 | Nav + footer copiados en 60 archivos; todo cambio global exige scripts Python batch. Sin build pipeline ni tests |

## 1.2 Hallazgos priorizados

### Críticos (bloquean el lanzamiento operativo)
1. **No existe backend.** Contacto y CrearPropuesta hacen `event.preventDefault()` y nada más. Newsletter, votos, comentarios, donaciones y afiliación son decorativos.
2. **Donaciones/afiliación sin cumplimiento legal.** Un partido político español está sujeto a la **LO 8/2007 de financiación de partidos**: donaciones anónimas prohibidas, personas jurídicas prohibidas, límite 50.000 €/año/donante, cuenta bancaria específica, identificación del donante. Nada de esto puede montarse "con un botón de Stripe" sin capa de identidad.
3. **Datos de afiliación = categoría especial RGPD (art. 9).** La ideología/afiliación política exige consentimiento explícito, cifrado y minimización. Condiciona todo el diseño del backend.

### Altos
4. **Performance media 69.** Home (la página más vista) da 58. Acciones: diferir Leaflet, `font-display:swap` + preload de fuentes, prerender/SSG del HTML (el dc-runtime renderiza todo en cliente).
5. **URLs con espacios y tildes** (`Acci%C3%B3n%20Civil%20Gandia.dc.html`). Feas, frágiles en hosting/CDN y malas para compartir. Migrar a slugs limpios (`/`, `/conocenos/historia`…) con redirects.
6. **og:image ausente** en las 60 páginas (ya identificado como pendiente). Sin ella, cada share en redes sale sin imagen — grave para un partido que vive de difusión.
7. **Canal de denuncias = mailto.** La **Ley 2/2023** exige a partidos políticos un canal interno de informaciones con confidencialidad/anonimato. Un mailto no cumple.

### Medios
8. Outliers a11y: FichaEvento-barrio (71 — contraste/headings/labels), páginas print (82, SEO 58 — excluirlas también del sitemap además de robots).
9. Widget preview Escritorio/Móvil visible — ocultarlo en producción en todas las páginas (como ya hace Home).
10. Deuda de mantenimiento: 60 páginas autocontenidas. Asumible hoy; insostenible cuando Actualidad/Agenda requieran publicar contenido semanal → lo resuelve el CMS (Fase 2).

### Fortalezas a conservar
- Identidad visual sobresaliente y diferenciada del estándar municipal.
- Bilingüe real (no traducción automática), persistente.
- SEO técnico prácticamente perfecto; imágenes WebP optimizadas (228 MB → 10 MB).
- Cero enlaces rotos verificados; sitemap y arquitectura de información completos.

---

# PARTE 2 — ROADMAP DE BACKEND E INTEGRACIONES

## Decisión de arquitectura (recomendación)

**Stack: Cloudflare Pages (estático + Functions) + Supabase EU (Postgres/Auth/RLS/Storage) + Directus como CMS + Stripe + Brevo.**

- Corto plazo: el frontend dc-runtime se mantiene y consume endpoints JSON (`fetch` en `data()`/mount).
- Medio plazo (Fase 6): migración progresiva a **Astro** (SSG) reutilizando el diseño → resuelve de golpe performance (HTML pre-renderizado), URLs limpias y la duplicación nav/footer (componentes). No es urgente; no bloquea nada.
- Coste operativo estimado: **25–60 €/mes** (+comisiones Stripe) — Cloudflare Pages 0 €, Supabase 0–25 €, Brevo 0–19 €, Umami/Plausible 0–9 €, dominio ~15 €/año.

## FASE 0 — Fundamentos y deploy (semanas 1–2)
**Objetivo: la web actual, publicada y medible en `accioncivilgandia.org`.**

- [ ] Deploy a **Netlify** (temporal, subdominio `*.netlify.app`) desde el repo GitHub (`WHITE5S5/accion-civil-gandia`) o drag&drop. Preparado 2026-07-07: `index.html` creado (Home renombrada), 0 enlaces rotos, `_redirects` con 63 URLs canónicas. Al tener dominio: decidir Netlify vs Cloudflare Pages.
- [ ] Dominio + DNS (pendiente de compra), HTTPS, HSTS.
- [x] Headers de seguridad (`_headers`): CSP (permitiendo Leaflet/fonts), X-Content-Type-Options, Referrer-Policy, Permissions-Policy. ✅ 2026-07-07
- [x] Redirects de URLs limpias → archivos actuales (`/conocenos → /Conocenos.dc.html`), preparando la migración de slugs. ✅ 2026-07-07 (incluida raíz `/` → Home)
- [ ] Analytics cookieless (Umami self-host o Plausible EU) — sin cookies = sin consentimiento de analytics, banner más simple.
- [ ] Uptime monitoring (UptimeRobot free) + Sentry (errores JS del runtime).
- [x] Quick wins de la auditoría ✅ 2026-07-07: og:image en 100% de páginas; preview widget oculto en producción (visible en localhost); sitemap ya estaba limpio de prints; a11y FichaEvento-barrio reparada (causa real: script del componente roto — 5 páginas variante reparadas, axe WCAG A/AA = 0 violaciones); contraste footer corregido en 66 archivos; favicon.ico creado.

**Salida:** web pública, segura, medida. Sin backend aún.

## FASE 1 — Formularios y newsletter (semanas 2–4)
**Objetivo: que los CTAs existentes funcionen, sin construir todavía el backend completo.**

> ✅ **CÓDIGO COMPLETADO 2026-07-07** (sesión autónoma): 4 funciones Netlify (`contacto`, `newsletter`, `newsletter-confirm`, `propuesta`) + `assets/acg-forms.js` inyectado en 67 páginas + 20 tests pasando (`scripts/test_functions.mjs`). También listos: SQL Fase 2 (`supabase/migrations/`) y funciones Stripe Fase 4 (`donaciones`, `afiliacion`, `stripe-webhook`, 10 tests de helpers). **Falta solo: cuentas + claves + redeploy → ver `docs/CONFIGURACION_SERVICIOS.md`.**

- [ ] **Cloudflare Pages Functions** (serverless) como capa API inicial: `/api/contacto`, `/api/newsletter`, `/api/propuesta`.
- [ ] Contacto → email al partido vía **Resend** o Brevo transaccional. Anti-spam: honeypot + **Cloudflare Turnstile** (gratuito, sin cookies) + rate limiting.
- [ ] Newsletter → **Brevo** (servidores UE) con **double opt-in** obligatorio (RGPD) y registro de consentimiento (timestamp + IP + texto aceptado).
- [ ] CrearPropuesta → de momento guarda en tabla `proposals_inbox` (Supabase, ver F2) con estado `pendiente_moderacion` + email de aviso al equipo.
- [ ] Actualizar Política de Privacidad con los tratamientos reales (finalidad, base jurídica, plazos).

**Salida:** cero CTAs muertos en formularios. Primer registro de consentimientos RGPD.

## FASE 2 — Backend core + CMS (semanas 4–8)
**Objetivo: el equipo publica contenido sin tocar código; existe base de datos.**

- [ ] **Supabase proyecto región UE** (Frankfurt): Postgres + Auth + Storage + Row Level Security desde el día 1.
- [ ] Modelo de datos inicial:
  `users`, `profiles`, `members`(afiliados), `posts`(actualidad), `events`(agenda), `campaigns`, `actuaciones`(+barrio, estado, cronología), `proposals`(ciudadanas), `votes`, `comments`, `subscriptions`(cuotas), `donations`, `consents`, `audit_log`.
- [ ] **Directus** (self-host en Railway/Fly ~5 €/mes, o Directus Cloud) sobre ese Postgres como panel de edición: Actualidad, Agenda, Campañas, Actuaciones, Equipo. Roles de editor para el equipo del partido.
- [ ] El frontend pasa a leer estas colecciones vía API REST de Directus/Supabase (fetch en las páginas Actualidad, Agenda, Campañas, Accion, Barrio, Detalles).
- [ ] Backups automáticos diarios (Supabase PITR o `pg_dump` a R2) + **prueba de restauración documentada**.

**Salida:** contenido dinámico gestionado por no-técnicos. La web deja de ser estática en las secciones vivas.

## FASE 3 — Auth + área ciudadana (semanas 8–12)
**Objetivo: participación real — propuestas, votos y debate.**

- [ ] Supabase Auth: registro email+password y magic link. Verificación de email obligatoria.
- [ ] Roles: `visitante` → `registrado` → `afiliado` → `moderador` → `admin` (RLS por rol en cada tabla).
- [ ] Propuestas ciudadanas: creación (desde F1 inbox), moderación previa a publicación, **1 persona = 1 voto** (constraint único user+proposal), a favor/en contra.
- [ ] Comentarios con moderación (cola en Directus) — imprescindible en política local.
- [ ] Área Ciudadano real: mis propuestas, mis votos, notificaciones por email (Resend).
- [ ] **RGPD art. 9**: el registro como simpatizante/afiliado lleva consentimiento explícito separado; cifrado at-rest (Supabase lo da) + minimización (no pedir más que lo necesario); derecho de acceso/supresión implementado (endpoint de export + borrado en cascada).
- [ ] 2FA obligatorio para `moderador`/`admin`.

**Salida:** la plataforma de participación prometida por el diseño, funcionando.

## FASE 4 — Pagos: Stripe para afiliación y donaciones (semanas 12–16)
**Objetivo: ingresos recurrentes y donaciones LEGALES.**

### 4a. Cuotas de afiliados (Stripe Billing)
- [ ] Productos: cuota mensual/anual (p. ej. 5 €/mes, 50 €/año, cuota reducida). **Stripe Checkout** en modo `subscription`.
- [ ] **SEPA Direct Debit como método principal** (estándar en partidos españoles; comisión ~0,35 % vs ~1,5 % tarjeta) + tarjeta como alternativa.
- [ ] **Stripe Customer Portal**: el afiliado gestiona su método de pago y baja sin intervención manual.
- [ ] Alta de afiliado = formulario con datos identificativos (nombre, DNI, dirección) ANTES del Checkout → registro en `members` → luego pago. La ficha de afiliación es un requisito estatutario, no solo de pago.
- [ ] Webhooks (`checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.deleted`) en una Function: **verificar firma del webhook**, idempotencia por `event.id`, actualizar `members.status`, email de recibo/bienvenida.
- [ ] Dunning: reintentos automáticos de Stripe + email en fallo de cobro.

### 4b. Donaciones puntuales (Stripe Checkout one-off) — con cumplimiento LO 8/2007
- [ ] Formulario previo obligatorio: nombre completo, DNI/NIE, declaración responsable de (a) persona física, (b) donación con fondos propios, (c) no superar 50.000 €/año. **Sin identificación no hay botón de pago** — las donaciones anónimas están prohibidas.
- [ ] Validación de límite anual acumulado por DNI en `donations`.
- [ ] Importes sugeridos (10/25/50/100 €) + importe libre con tope por transacción.
- [ ] Cuenta bancaria de destino **específica para donaciones** (requisito legal — configurar en Stripe un payout account dedicado o segregación contable).
- [ ] Recibo/certificado automático por email (las donaciones a partidos desgravan — IRPF art. 61 bis LO 8/2007 / Ley 49/2002: comunicarlo en el recibo).
- [ ] Export contable CSV/Excel por ejercicio para la rendición al **Tribunal de Cuentas**.
- [ ] PCI: no tocar nunca datos de tarjeta (todo en Checkout hosted). No almacenar PAN. Guardar solo `payment_intent`/`customer` ids.

**Salida:** afiliación y donaciones operativas, auditables y conformes a la ley de financiación de partidos.

## FASE 5 — Seguridad y cumplimiento (semanas 16–20, solapable)
**Objetivo: cerrar el círculo legal y de seguridad antes de campaña.**

- [ ] **Registro de Actividades de Tratamiento** (RGPD art. 30) documentado; evaluar designación de **DPD** (tratamiento a gran escala de categorías especiales → art. 37 lo hace prácticamente obligatorio para un partido).
- [ ] Evaluación de Impacto (EIPD/DPIA) para el tratamiento de datos de afiliados.
- [ ] **Canal de denuncias Ley 2/2023**: sustituir el mailto por herramienta con confidencialidad/anonimato y plazos de acuse (opciones gratuitas/low-cost: GlobaLeaks self-host, o formulario cifrado dedicado con responsable designado).
- [ ] Hardening: rate limiting en todas las Functions, WAF de Cloudflare, revisión RLS completa (test de acceso cruzado entre usuarios), rotación de claves, secrets en variables de entorno (nunca en repo).
- [ ] `audit_log` inmutable de acciones admin (quién publicó/borró/moderó qué y cuándo).
- [ ] Pentest ligero / revisión externa antes de campaña electoral.
- [ ] Simulacro de restauración de backup + runbook de incidentes (incluye notificación AEPD 72 h).

## FASE 6 — Operación y evolución (continuo)
- [ ] CI/CD: checks Lighthouse en PR (presupuesto: Perf ≥ 85, A11y ≥ 95), tests de humo de las Functions.
- [ ] Migración progresiva a **Astro** página a página (empezar por Home): SSG + islands → Perf 90+, URLs limpias definitivas, nav/footer como componentes únicos.
- [ ] Métricas de participación en panel admin (propuestas/votos/altas por mes).
- [ ] Revisión trimestral: dependencias, backups, permisos, consentimientos caducados.

## Resumen de integraciones

| Integración | Servicio | Fase | Coste |
|---|---|---|---|
| Hosting + CDN + Functions | Cloudflare Pages | 0 | 0 € |
| Anti-spam | Cloudflare Turnstile | 1 | 0 € |
| Email transaccional | Resend / Brevo | 1 | 0–15 € |
| Newsletter | Brevo (UE, double opt-in) | 1 | 0–19 € |
| BBDD + Auth + Storage | Supabase (región UE) | 2 | 0–25 € |
| CMS | Directus | 2 | 0–15 € |
| Analytics | Umami / Plausible | 0 | 0–9 € |
| Pagos | Stripe (Billing + Checkout + Portal, SEPA) | 4 | comisiones |
| Errores/monitoring | Sentry + UptimeRobot | 0 | 0 € |
| Mapas | Leaflet + OSM (ya en uso) | — | 0 € |

## Riesgos principales

1. **Legal financiero** (LO 8/2007): mitigado con identificación previa al pago y límites — no lanzar donaciones sin la Fase 4b completa.
2. **RGPD art. 9**: los datos de afiliados son lo más sensible del proyecto; RLS + cifrado + minimización desde F2, no después.
3. **Dependencia de dc-runtime** (runtime propio sin comunidad): mitigado con la vía Astro en F6; mientras tanto, la capa de datos vive en servicios estándar (Postgres) y es portable.
4. **Equipo pequeño**: cada fase entrega valor por sí sola; se puede pausar tras cualquier fase sin dejar nada a medias.
