# Acción Civil Gandia — Web institucional

> ⚠️ **RENOMBRADO 2026-07-07:** la Home ya NO es `Acción Civil Gandia.dc.html` → ahora es **`index.html`** (requisito Netlify + URLs sin tildes/espacios). La print es `home-print.dc.html`. Los 264 enlaces internos ya están actualizados. Toda mención antigua al archivo con tilde en memorias/documentos se refiere a `index.html`.
> **Hosting temporal: Netlify** (drag&drop o repo GitHub) hasta tener dominio; `_headers`/`_redirects` son formato nativo Netlify. En Fase 1 las functions van en `netlify/functions/` (no `functions/`).
> **Deploy:** ejecutar `python scripts/make_deploy.py` → genera `deploy_netlify/` (solo archivos publicables, ~17,5 MB) → arrastrar ESA carpeta a Netlify. NUNCA subir la raíz del proyecto (contiene specs, auditorías, scripts y uploads privados). Regenerar tras cada cambio.

## Antes de hacer NADA

1. Leer `F:\WHITE_OS\08_MEMORIA\CLAUDE_MEMORY\CLAUDE_ACCION_CIVIL.md` — contiene TODO el contexto: stack, patrones, design tokens, nav, footer, estado de páginas, pendientes, errores conocidos.
2. Leer la sección "Errores a no repetir" de este archivo (abajo).
3. Dev server: `python -m http.server 8091` desde esta carpeta. Verificar que corre antes de abrir páginas.

## Auditoría y roadmap backend (2026-07-07)

- `AUDITORIA_Y_ROADMAP_BACKEND.md` — auditoría del frontend (8,4/10) + roadmap de 6 fases (visión general).
- `SPEC_BACKEND_DETALLADO.md` — **spec ejecutable**: esquema SQL completo, políticas RLS, contratos de API endpoint por endpoint, eventos Stripe uno a uno, `_headers`/`_redirects` literales, criterios de aceptación por fase. **Para implementar el backend, seguir este documento en orden (F0→F5).**
- Copia visual en el vault: `01_PROYECTOS/ACCION_CIVIL/`.

## Stack resumido

- **dc-runtime** (`support.js`) — NO editar. Archivos `.dc.html`, cada uno es una SPA con `<x-dc>`.
- **Patrón:** `class Component extends DCLogic` → `data(lang)` para datos estáticos + `renderVals()` para valores responsivos.
- **Templates:** `{{ var }}` (sin JS/ternarios), `<sc-for>`, `<sc-if>`, `<helmet>`.
- **Bilingüe:** `V(es, va)`. Idioma en `localStorage('acg_lang')`.
- **Responsive:** `isMob = s.device === 'mobile'`. Todo pre-computado en `renderVals()`.

## Crear una página nueva — checklist

1. Copiar estructura de una página similar existente (no empezar de cero).
2. `<helmet>`: title, description, canonical, OG, favicon, fonts, CSS (incluir `.acg-nav-item`, `.acg-dd`, `.acg-dd-link`).
3. Header con nav dropdown (copiar de `CLAUDE_ACCION_CIVIL.md` → "Nav data() completo").
4. Breadcrumb.
5. Contenido con hero navy gradient.
6. Footer 4 columnas (copiar datos de `CLAUDE_ACCION_CIVIL.md` → "Datos footer en data()").
7. Cambiar `col:'#0A2A5E', weight:700` en el nav item activo según la sección.
8. Actualizar `Sitemap.dc.html` si la página estaba como "Planificada" → cambiar a OK con href.

## Páginas pendientes (prioridad)

Ver lista completa en `CLAUDE_ACCION_CIVIL.md` → "Páginas pendientes".

Alta:
- Home (`index.html`) — añadir dropdowns al nav (estructura diferente, layout dual)
- Detalle de publicación (Actualidad)
- Ficha de evento (Agenda)
- Detalle de campaña (Campañas)

Media:
- Mapa de actuaciones + Barrios × 5 + Detalle de actuación (Acción en Gandia)

Baja:
- Categorías propuestas, Programa PDF, Buscador global, Perfil individual

## Errores a no repetir

1. **Edit tool falla con Unicode U+2019** (`'` comilla curva). El valenciano lo usa mucho (`d'actuacions`). → Usar scripts Python para esas ediciones.
2. **NO usar ternarios en templates** (`{{ x ? a : b }}`). Solo `{{ var }}`. Lógica en `renderVals()`.
3. **renderVals() duplicados**: al editar data() y renderVals() a la vez, verificar que no se dupliquen variables.
4. **Write en archivo existente**: leerlo primero (aunque sea 5 líneas) o falla con "File has not been read yet".
5. **Home tiene nav/layout completamente diferente** al resto. No aplicar scripts batch sin excluirla.
6. **CSS header overrides** usan `header>div[style*='height:70px']` (subpáginas) vs `height:74px` (Home). No cambiar alturas.
7. **Scripts batch pueden comerse líneas estructurales.** El 2026-07-07 se encontraron 5 páginas variante (DetalleActuacion-bici/camaras/grao, FichaEvento-asamblea/barrio) con la línea `timeline:[` / `programa:[` eliminada por un batch anterior → SyntaxError → la página entera renderizaba vacía (a11y 71). Tras CUALQUIER batch, ejecutar el barrido de sintaxis extrayendo el script `data-dc-script` de los 67 archivos con `new Function()` (el barrido antiguo de "38 páginas" no cubría las variantes).
8. **CSP sin `unsafe-eval` rompe TODA la web en producción.** El dc-runtime evalúa las clases con `new Function()` → `script-src` DEBE incluir `'unsafe-eval'` (además de `'unsafe-inline'`). Descubierto en el primer deploy a Netlify (2026-07-07): las páginas renderizaban vacías solo en producción (en localhost no hay headers). Al migrar a Astro se podrán retirar ambos.
9. **La Asset Optimization de Netlify ("Pretty URLs") ROMPE los estilos inline.** Reescribe los `<a>` con comillas simples y escapa `'Public Sans'` como `'` (inválido en HTML) → los botones pierden padding/radius/font. Solución aplicada (definitiva, 2026-07-07): se eliminaron TODAS las comillas de los nombres de fuente (`'Public Sans'` → `Public Sans`, 2075 casos) — CSS lo permite y así el reescritor no tiene nada que escapar. Además `netlify.toml` con `skip_processing = true` (no bastó por sí solo con drag&drop) y recomendado desactivar Asset optimization en el panel. Las fuentes NUEVAS deben escribirse SIN comillas en los estilos.
10. **Apóstrofes rectos en valenciano dentro de strings JS** (`d'Acció`, `conta'ns`) rompen el componente. Siempre U+2019 (`d’Acció`). Regex de reparación: `(\w)'(\w)` → `\1’\2` solo dentro del bloque script.
