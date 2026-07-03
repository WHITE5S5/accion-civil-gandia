# Acción Civil Gandia — Web institucional

## Antes de hacer NADA

1. Leer `F:\WHITE_OS\08_MEMORIA\CLAUDE_MEMORY\CLAUDE_ACCION_CIVIL.md` — contiene TODO el contexto: stack, patrones, design tokens, nav, footer, estado de páginas, pendientes, errores conocidos.
2. Leer la sección "Errores a no repetir" de este archivo (abajo).
3. Dev server: `python -m http.server 8091` desde esta carpeta. Verificar que corre antes de abrir páginas.

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
- Home (`Acción Civil Gandia.dc.html`) — añadir dropdowns al nav (estructura diferente, layout dual)
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
