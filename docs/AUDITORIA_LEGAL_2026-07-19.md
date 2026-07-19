# Auditoría de legalidad — Acción Civil Gandia (2026-07-19)

Alcance: web pública (accioncivilgandia.es), tienda, donaciones/afiliación, canal de denuncias, área ciudadana, panel admin y servicios externos. Revisión sobre el código y las páginas desplegadas a fecha de hoy.

## Resumen ejecutivo

Cumplimiento **globalmente sólido** para un partido local: las cuatro patas duras (RGPD, LSSI, LO 8/2007 de financiación y Ley 2/2023 de denuncias) están cubiertas en lo esencial. Quedan **7 mejoras recomendadas**, ninguna de riesgo alto inminente; las tres primeras convendría hacerlas pronto.

## ✅ Conforme (verificado)

| Ámbito | Estado |
|---|---|
| **LSSI — Aviso legal** | Titular real con CIF G44754356, domicilio social (Ciutat Comtal 6) y oficinas (República Argentina 42), contacto. |
| **RGPD — Política de privacidad** | Bases jurídicas por finalidad (art. 6.1.a/c/f), plazos de conservación por tratamiento, derechos + AEPD, transferencias internacionales mencionadas, encargados citados: Supabase, Netlify, Brevo, Resend, Google. |
| **RGPD — Registro de actividades (art. 30)** | Redactado en `docs/RGPD_REGISTRO_ACTIVIDADES.md`. |
| **Consentimientos** | Newsletter con **double opt-in**; marketing con casilla NO premarcada; baja en un clic; propuestas con aviso de datos de cuenta. |
| **Cookies** | El sitio no usa cookies propias de rastreo (analítica propia server-side, preferencias en localStorage — declarado en la página de Cookies). Sin necesidad de banner invasivo. |
| **LO 8/2007 — Financiación** | Donaciones con DNI/NIE validado (nominatividad), límite 50.000 €/año codificado, cuotas de afiliación por Stripe con consolidación mensual; 37 tests pasando. |
| **Transparencia (Ley 19/2013 publicidad activa)** | Estatutos reales publicados, libro de tesorería real consultable + CSV descargable, documentos oficiales del Ayuntamiento. |
| **Ley 2/2023 — Canal de denuncias** | Canal con opción anónima, código de seguimiento, hilo bidireccional, acuse en 7 días y resolución en 3 meses (documentado en Privacidad con su base jurídica 6.1.c), audit log. |
| **Consumo — Tienda** | Condiciones de compra con desistimiento 14 días (7 menciones), IVA, devoluciones y reclamaciones. Sin enlace a la plataforma ODR (correcto: la UE la cerró en 2025). |
| **Accountability interna** | Audit log en admin (moderación, bloqueos con motivo y apelación, borrado de pedidos con motivo). |
| **Accesibilidad** | Página de declaración + skip-links y aria-labels (RD 1112/2018 no obliga a partidos, buena práctica). |

## ⚠ Mejoras recomendadas (por prioridad)

1. **Privacidad no menciona a Stripe, Sentry ni Cloudflare** como encargados/destinatarios. Stripe trata datos de donantes/socios/compradores (¡los más sensibles de la web!), Sentry recibe IP+datos técnicos en errores, y Cloudflare ahora proxya TODO el tráfico. → Añadir los tres a la cláusula de encargados y transferencias (Stripe/Sentry/Cloudflare tienen DPF/SCC — basta citarlos).
2. **Google Fonts cargadas en remoto** (`fonts.googleapis.com` en todas las páginas): envía la IP del visitante a Google sin consentimiento — criterio europeo contrario (multas en Alemania; la AEPD no ha sancionado aún, riesgo bajo-medio). → Autoalojar las 3 fuentes (además mejora rendimiento y quita dependencia).
3. **Edad mínima ausente**: la LOPDGDD fija 14 años para consentir; el registro de cuenta no lo declara. → Añadir línea "mayores de 14 años" en Privacidad y en el alta.
4. **YouTube embed estándar** (youtube.com): planta cookies al reproducir. → Cambiar a `youtube-nocookie.com` en el conversor de embeds.
5. **unpkg.com (Leaflet)**: CDN externo que recibe IPs. → Autoalojar leaflet.js/css (también robustez: si unpkg cae, los mapas caen).
6. **Nominatim/Photon** (buscador de direcciones): envían el texto buscado + IP a terceros; no aparecen en Privacidad. → Una línea en encargados/destinatarios.
7. **Normas de la comunidad**: el chat/comentarios se moderan pero no hay documento de normas enlazable (base para bloqueos ante una reclamación). → Página breve "Normas de la comunidad" enlazada desde Comunidad y el área ciudadana.

## Notas fuera del ámbito web
- Consentimientos de imagen de equipo/voluntarios: asegurar que constan por escrito (gestión interna, no del sitio).
- Cuando Stripe pase a live definitivo con datos reales de socios, revisar que el certificado de donaciones fiscales (IRPF) se emita si algún donante lo pide.
