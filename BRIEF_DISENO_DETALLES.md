# Brief para Claude Design — Páginas de detalle de Acción Civil

> **Cómo usarlo:** pega este brief en Claude Design y, si puedes, adjúntale también el archivo
> `Propuesta.dc.html` de este proyecto como *referencia visual exacta*. Entrega esperada: 4 mockups
> HTML/CSS estáticos, responsive y pulidos, con contenido de ejemplo realista. **No** hace falta que
> resuelva el data-binding: solo la estética. La conexión al runtime la hacemos nosotros después.

## Contexto
Web institucional de **Acción Civil Gandia**, un partido político **local** de Gandia. Tono **"partido
serio"**: sobrio, de prensa, confiable — NADA de look genérico de IA. Bilingüe ES/VA. Público: vecinos de
Gandia. Accesibilidad **AA obligatoria**.

## El problema a resolver
La página de detalle de **Propuesta ciudadana** (`Propuesta.dc.html`) es excelente. Pero las páginas de
detalle de **Noticia/blog, Agenda/evento, Campaña y Actuación** son todas iguales entre sí, planas y feas.
Quiero **4 páginas con personalidad propia pero de la misma familia visual**, a la altura de la de Propuesta.

## Sistema de diseño (respétalo al 100%)
**Tipografía** (Google Fonts, ya en uso):
- Titulares → **Fraunces** (serif de prensa), pesos 600–800, `letter-spacing:-.02em`, `text-wrap:balance`.
- Antetítulos, etiquetas y datos en **VERSALITAS** → **Oswald** 600 (uppercase + letter-spacing).
- Cuerpo, nav y botones → **Public Sans** 400–700.

**Color:**
- Navy primario `#0A2A5E` (titulares, marca) · Azul acción `#1563C4` (CTAs, enlaces) · Oro `#F6BE18` (acento/destacado).
- Verde `#1E7A45` (éxito/completado) · Rojo `#C0392B` (alerta).
- Texto `#17232F` / medio `#33414F` / secundario-meta `#5C6B7A`.
- Fondos: página `#F4F7FB`, tarjeta `#fff`, sutil `#F0F4F9`; bordes `#E9EEF4` / `#EEF2F7`.

**Forma:**
- **Bordes AFILADOS: radio 3px en TODO** (botones, badges, tarjetas, imágenes). Nunca redondeos grandes.
  Círculos (`border-radius:50%`) solo para avatares.
- Franja marino de **3px sobre el header** (`border-top:3px solid #0A2A5E`).
- Sombras **suaves y discretas** (`0 8px 24px rgba(0,0,0,.06–.12)`). `::selection` navy. Antialiased.
- Cuerpo `line-height:1.6`; **medida de lectura máx ~700–720px**. Mucho aire, jerarquía clarísima.
- Iconos **SVG inline de trazo fino** (`stroke-width` 1.9–2.4), coherentes con la referencia.

**Chrome común** (reutiliza el de la referencia): header con nav + dropdowns + selector ES/VA + CTA azul,
**breadcrumb**, y footer. En móvil, barra de navegación inferior.

## Anatomía de la referencia (Propuesta) — la vara de medir
Breadcrumb → bloque de título sobre fondo blanco (badges de categoría/estado en versalitas · H1 Fraunces
grande · fila de autor con avatar + meta con iconos) → **grid principal a 2 columnas**: izquierda el
contenido (galería con etiqueta monospace, secciones con H2 Fraunces, ubicación, documentos, timeline),
derecha un **sidebar sticky** con las acciones. Quiero que las 4 hereden esta calidad y ADN, pero con un
**layout adaptado a su contenido** (no calques secciones que no apliquen).

---

## Las 4 páginas (cada una con carácter propio)

### 1) Noticia / Blog — layout de artículo editorial
**Datos reales:** tipo (`noticia|comunicado|video|entrevista`), título, extracto, cuerpo (texto largo),
imagen destacada, URL de vídeo (opcional), fecha de publicación.
- **Hero:** antetítulo con el TIPO en versalitas + fecha · H1 Fraunces enorme · extracto como subtítulo ·
  imagen destacada a lo ancho con pie de foto.
- **Cuerpo** a medida de lectura (~700px): subtítulos, **pull-quotes** (cita con barra navy a la izquierda),
  listas. Tipografía cómoda y aireada.
- Si `tipo=video`: embed del vídeo arriba del cuerpo.
- Barra de **compartir** sutil + autoría (Acción Civil) + fecha.
- Cierre: **"Más noticias"** (3 tarjetas).

### 2) Evento / Agenda — layout de evento
**Datos:** título, descripción, fecha, hora inicio/fin, lugar, dirección, barrio, `inscribible` (bool).
- **Hero con bloque de fecha tipo "entrada"**: día grande + mes en versalitas Oswald.
- **Datos clave en fila con iconos:** cuándo (fecha + horas), dónde (lugar/dirección), barrio (badge).
- **CTA principal grande:** si `inscribible` → "Confirmar asistencia" (azul). Si no → "Añadir al calendario" (suave).
- Descripción / programa del acto.
- **Ubicación** con placeholder de mapa + dirección.
- Cierre: **"Otros actos"** (relacionados).

### 3) Campaña — layout de causa
**Datos:** título, descripción, imagen, `progreso` (0–100), `destacada` (bool), estado (`activa|finalizada`),
y apoyos reales.
- **Hero potente** con imagen + título Fraunces + estado.
- **Medidor de progreso elegante** (no la barra genérica): % + etiqueta.
- Secciones: **"Qué pedimos"**, **"Por qué importa"**, **hitos/timeline**.
- **Sidebar sticky** con acciones de apoyo: "Apoyar esta campaña" + contador de apoyos + compartir.
- Cierre: campañas relacionadas.

### 4) Actuación (por barrio) — layout "lo que hemos hecho en tu barrio"
**Datos:** título, descripción, barrio, lat/lng (mapa), estado (`propuesta|en_curso|completada`).
- **Estado MUY visible** como sello, con color semántico (oro=propuesta, azul=en curso, verde=completada).
- **Badge de barrio** prominente.
- **Hero con mapa** de la ubicación (lat/lng) o imagen.
- Descripción de la actuación. Opcional: bloque **"antes / después"** o hitos si encaja.
- Cierre: **"Otras actuaciones en el barrio"** (relacionadas).

---

## Requisitos técnicos
- HTML semántico + CSS (inline o `<style>`). **Sin frameworks ni dependencias externas** salvo las Google
  Fonts citadas. La maqueta no debe depender de JS.
- **Mobile-first**, perfectamente responsive (comprobar **375 / 768 / 1280 px**). En móvil las columnas se
  apilan y los sidebars pasan a bloque.
- Contraste **AA**. Contenido de ejemplo **realista en español** (títulos y textos plausibles de un partido
  local de Gandia) para poder juzgar la estética.
- Entrega **4 páginas HTML independientes y completas** (header/breadcrumb/contenido/footer), reutilizando
  el mismo header/footer entre ellas.

## Qué NO quiero
Gradientes agresivos, glassmorphism, esquinas muy redondeadas, sombras exageradas, emojis como bullets, el
patrón "tarjeta con borde izquierdo de color", cualquier cosa que huela a plantilla de IA. **Sobriedad de
periódico serio.**

---

## (Nota interna — fase de conexión, después del diseño)
Portar cada mockup a su `.dc.html` cableando los `{{ bindings }}` del dc-runtime a su API:
- Noticia → `DetallePublicacion.dc.html` ← `/api/post-detail`
- Evento → `FichaEvento.dc.html` ← `/api/event-detail`
- Campaña → `DetalleCampana.dc.html` ← `/api/campaign-detail`
- Actuación → `DetalleActuacion.dc.html` ← `/api/actuacion-detail`
Conservar el patrón anti-flash (skeleton `.acg-sk`, sin datos demo visibles) y rutas absolutas.
