import { supaRead, supaReadConfigured } from './supa.mjs';
import {
  seedActuaciones,
  seedBarrios,
  seedCampaigns,
  seedEquipo,
  seedEvents,
  seedPosts,
} from './content-seeds.mjs';

const POST_THEME = {
  noticia: { catBg: '#EAF3FC', catCol: '#1563C4', cat_es: 'Noticia', cat_va: 'Notícia' },
  comunicado: { catBg: '#FBF0DC', catCol: '#D98A0B', cat_es: 'Comunicado', cat_va: 'Comunicat' },
  video: { catBg: '#E4F5F7', catCol: '#0B7C89', cat_es: 'Vídeo', cat_va: 'Vídeo' },
  entrevista: { catBg: '#EEEAFB', catCol: '#6B4EE6', cat_es: 'Entrevista', cat_va: 'Entrevista' },
};

const EVENT_THEME = {
  asamblea: { catBg: '#EEEAFB', catCol: '#6B4EE6', dateBg: '#EEEAFB', dateCol: '#6B4EE6', monthCol: '#8B7CC8' },
  comision: { catBg: '#EAF3FC', catCol: '#1563C4', dateBg: '#EAF3FC', dateCol: '#1563C4', monthCol: '#6B9DD4' },
  institucional: { catBg: '#FBF0DC', catCol: '#9A6208', dateBg: '#FBF0DC', dateCol: '#D98A0B', monthCol: '#C4A254' },
  taller: { catBg: '#E7F4EC', catCol: '#1E7A45', dateBg: '#E7F4EC', dateCol: '#2E9E5B', monthCol: '#5DAF7E' },
};

const ACTION_THEME = {
  completada: { color: '#2E9E5B', tint: '#E7F4EC', estado_es: 'Solucionado', estado_va: 'Solucionat' },
  en_curso: { color: '#1563C4', tint: '#EAF3FC', estado_es: 'En ejecución', estado_va: 'En execució' },
  propuesta: { color: '#D98A0B', tint: '#FBF0DC', estado_es: 'Presentado', estado_va: 'Presentat' },
};

const clean = (value) => String(value || '').trim();
const strip = (value) => clean(value).replace(/[#*_`>\-]/g, ' ').replace(/\s+/g, ' ').trim();
const lower = (value) => clean(value).toLowerCase();
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const fallbackImage = (value, fallback) => clean(value) || fallback;
const isVa = (lang) => lang === 'va';

function pick(es, va, lang) {
  return isVa(lang) ? (va || es || '') : (es || va || '');
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function parseDateOnly(value) {
  if (!value) return null;
  return new Date(`${value}T12:00:00Z`);
}

function formatDate(value, lang, opts = {}) {
  const date = value instanceof Date ? value : parseDateOnly(String(value).slice(0, 10));
  if (!date || Number.isNaN(date.getTime())) return '';
  const locale = isVa(lang) ? 'ca-ES' : 'es-ES';
  const format = new Intl.DateTimeFormat(locale, opts);
  return format.format(date).replace(/\.$/, '');
}

function monthShort(value, lang) {
  return formatDate(value, lang, { month: 'short', timeZone: 'UTC' }).replace('.', '').toLowerCase();
}

function monthLong(value, lang) {
  return formatDate(value, lang, { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function readTime(text, lang) {
  const words = strip(text).split(/\s+/).filter(Boolean).length || 80;
  const mins = clamp(Math.round(words / 180), 2, 9);
  return `${mins} ${isVa(lang) ? 'min' : 'min'}`;
}

function numberLabel(value, lang) {
  return new Intl.NumberFormat(isVa(lang) ? 'ca-ES' : 'es-ES').format(value || 0);
}

function inferEventKind(title) {
  const value = lower(title);
  if (value.includes('pleno') || value.includes('ple')) return 'institucional';
  if (value.includes('taller')) return 'taller';
  if (value.includes('comisión') || value.includes('comissió')) return 'comision';
  return 'asamblea';
}

function inferActionCategory(title, lang) {
  const value = lower(title);
  if (value.includes('mesa')) return pick('Calle', 'Carrer', lang);
  if (value.includes('cámara') || value.includes('camara')) return pick('Seguridad', 'Seguretat', lang);
  if (value.includes('oficina')) return pick('Propuesta', 'Proposta', lang);
  if (value.includes('nit dels ciris')) return pick('Acto vecinal', 'Acte veïnal', lang);
  return pick('Actuación', 'Actuació', lang);
}

function actionIconPath(title) {
  const value = lower(title);
  if (value.includes('cámara') || value.includes('camara')) return 'M12 3 5 6.5V11c0 4.2 3 7 7 8.3 4-1.3 7-4.1 7-8.3V6.5L12 3Z';
  if (value.includes('mesa')) return 'M12 20v-8M12 12l6-6M6 6l6 6';
  if (value.includes('oficina')) return 'M7 3h7l4 4v14H7zM14 3v4h4';
  return 'M12 3v2M12 19v2M5 12H3M21 12h-2M6.3 6.3 4.9 4.9M19.1 19.1l-1.4-1.4M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z';
}

function campaignMeta(campaign) {
  const progress = clamp(Number(campaign.progreso || 0), 0, 100);
  const target = 100;
  return { progress, target, support: Math.round((progress / 100) * target) };
}

function postHref(slug) {
  return ({
    'nit-dels-ciris': '/actualidad/nit-dels-ciris',
    camaras: '/actualidad/camaras',
    mesas: '/actualidad/mesas',
  }[slug]) || `/actualidad/${slug}`;
}

function eventHref(slug) {
  return ({
    asamblea: '/agenda/asamblea',
    'mesa-barrio': '/agenda/mesa-barrio',
  }[slug]) || `/agenda/${slug}`;
}

function campaignHref(slug) {
  return ({
    '38-camaras-seguridad': '/campanas/38-camaras-seguridad',
    antiokupacion: '/campanas/antiokupacion',
    mesas: '/campanas/mesas',
  }[slug]) || `/campanas/${slug}`;
}

function actuacionHref(slug) {
  return ({
    camaras: '/actuacion/camaras',
    bici: '/actuacion/bici',
    grao: '/actuacion/grao',
  }[slug]) || `/actuacion/${slug}`;
}

function normalizePost(row, lang) {
  const theme = POST_THEME[row.tipo] || POST_THEME.noticia;
  const excerpt = pick(row.extracto_es, row.extracto_va, lang) || strip(pick(row.cuerpo_es, row.cuerpo_va, lang)).slice(0, 160);
  const title = pick(row.titulo_es, row.titulo_va, lang);
  return {
    slug: row.slug,
    href: postHref(row.slug),
    catKey: row.tipo,
    cat: pick(theme.cat_es, theme.cat_va, lang),
    catBg: theme.catBg,
    catCol: theme.catCol,
    title,
    img: title,
    excerpt,
    date: formatDate(row.publicado_at || row.created_at, lang, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }),
    read: readTime(excerpt, lang),
    comments: '—',
    imgSrc: fallbackImage(row.imagen, 'assets/og-actualidad.webp'),
    body: pick(row.cuerpo_es, row.cuerpo_va, lang),
  };
}

function normalizeEvent(row, lang) {
  const kind = inferEventKind(pick(row.titulo_es, row.titulo_va, lang));
  const theme = EVENT_THEME[kind];
  const title = pick(row.titulo_es, row.titulo_va, lang);
  const date = row.fecha;
  const start = clean(row.hora_inicio).slice(0, 5);
  const end = clean(row.hora_fin).slice(0, 5);
  return {
    slug: row.slug,
    href: eventHref(row.slug),
    kind,
    title,
    desc: pick(row.descripcion_es, row.descripcion_va, lang),
    day: String(parseDateOnly(date)?.getUTCDate() || ''),
    month: monthShort(date, lang),
    time: start || '—',
    duration: start && end ? `${start} - ${end}` : '—',
    date,
    dateLabel: formatDate(date, lang, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }),
    place: clean(row.lugar) || pick(row.barrio_nombre_es, row.barrio_nombre_va, lang),
    capacity: pick('Público abierto', 'Públic obert', lang),
    full: false,
    cat: pick(
      kind === 'institucional' ? 'Institucional' : kind === 'comision' ? 'Comisión' : kind === 'taller' ? 'Taller' : 'Asamblea',
      kind === 'institucional' ? 'Institucional' : kind === 'comision' ? 'Comissió' : kind === 'taller' ? 'Taller' : 'Assemblea',
      lang
    ),
    ...theme,
  };
}

function normalizeCampaign(row, lang) {
  const { progress, target, support } = campaignMeta(row);
  const title = pick(row.titulo_es, row.titulo_va, lang);
  return {
    slug: row.slug,
    href: campaignHref(row.slug),
    title,
    img: title,
    text: pick(row.descripcion_es, row.descripcion_va, lang),
    result: pick(row.descripcion_es, row.descripcion_va, lang),
    imgSrc: fallbackImage(row.imagen, 'assets/og-campanas.webp'),
    pct: progress,
    apoyos: numberLabel(support, lang),
    meta: numberLabel(target, lang),
    state: row.estado,
    tag: inferActionCategory(title, lang),
    tagBg: '#EAF3FC',
    tagCol: '#1563C4',
    fecha: formatDate(row.created_at, lang, { month: 'short', year: 'numeric', timeZone: 'UTC' }),
    update: pick('Actualizada desde CMS', 'Actualitzada des del CMS', lang),
  };
}

function normalizeActuacion(row, lang) {
  const theme = ACTION_THEME[row.estado] || ACTION_THEME.propuesta;
  const title = pick(row.titulo_es, row.titulo_va, lang);
  const barrio = pick(row.barrio_nombre_es, row.barrio_nombre_va, lang) || pick(row.barrios?.nombre_es, row.barrios?.nombre_va, lang) || '';
  return {
    slug: row.slug,
    href: actuacionHref(row.slug),
    title,
    barrio,
    barrioSlug: row.barrio_slug || row.barrios?.slug || '',
    cat: inferActionCategory(title, lang),
    fecha: formatDate(row.created_at, lang, { month: 'short', year: 'numeric', timeZone: 'UTC' }),
    iconPath: actionIconPath(title),
    lat: Number(row.lat || 0),
    lng: Number(row.lng || 0),
    estado: pick(theme.estado_es, theme.estado_va, lang),
    color: theme.color,
    tint: theme.tint,
    stateKey: row.estado,
    desc: pick(row.descripcion_es, row.descripcion_va, lang),
  };
}

function normalizeEquipo(row, lang) {
  const extra = row.areas || {};
  const foto = clean(row.foto);
  const cargo = pick(row.cargo_es, row.cargo_va, lang);
  return {
    slug: row.slug,
    href: row.slug === 'alcazar' ? '/equipo/perfil' : `/equipo/${row.slug}`,
    nombre: row.nombre, name: row.nombre,
    cargo, role: cargo,
    area: pick(extra.area_es, extra.area_va, lang),
    bio: pick(row.bio_es, row.bio_va, lang),
    foto: fallbackImage(row.foto, 'assets/logo-icon.webp'),
    img: foto, noImg: !foto,
    ini: extra.ini || String(row.nombre || '').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase(),
    avBg: extra.avBg || '#1563C4',
    orden: Number(row.orden || 0),
  };
}

async function fetchRows(path, seedRows, normalizer, lang) {
  if (!supaReadConfigured()) return { items: seedRows.map((row) => normalizer(row, lang)), source: 'seed' };
  try {
    const response = await supaRead(path);
    if (!response.ok || !Array.isArray(response.json)) throw new Error(response.text || `supabase_${response.status}`);
    return { items: response.json.map((row) => normalizer(row, lang)), source: 'supabase' };
  } catch (error) {
    console.error('phase2 content fallback', path, error.message);
    return { items: seedRows.map((row) => normalizer(row, lang)), source: 'seed' };
  }
}

export async function getPosts(params = {}) {
  const lang = isVa(params.lang) ? 'va' : 'es';
  const tipo = clean(params.tipo);
  const limit = clamp(Number(params.limit || 12) || 12, 1, 24);
  const offset = clamp(Number(params.offset || 0) || 0, 0, 200);
  const slug = clean(params.slug);
  const query = new URLSearchParams({
    select: 'slug,tipo,titulo_es,titulo_va,extracto_es,extracto_va,cuerpo_es,cuerpo_va,imagen,video_url,estado,publicado_at,created_at',
    order: 'publicado_at.desc.nullslast,created_at.desc',
    limit: String(limit),
    offset: String(offset),
  });
  query.set('estado', 'eq.publicado');
  if (tipo) query.set('tipo', `eq.${tipo}`);
  if (slug) query.set('slug', `eq.${slug}`);
  const seedFiltered = seedPosts
    .filter((row) => row.estado === 'publicado')
    .filter((row) => !tipo || row.tipo === tipo)
    .filter((row) => !slug || row.slug === slug)
    .slice(offset, offset + limit);
  const { items, source } = await fetchRows(`posts?${query.toString()}`, seedFiltered, normalizePost, lang);
  return {
    ok: true,
    source,
    featured: items[0] || null,
    items,
    total: items.length,
    videos: items.filter((item) => item.catKey === 'video').slice(0, 3).map((item) => ({
      title: item.title,
      date: item.date,
      dur: item.read,
      views: '—',
    })),
  };
}

export async function getEvents(params = {}) {
  const lang = isVa(params.lang) ? 'va' : 'es';
  const slug = clean(params.slug);
  const from = clean(params.desde);
  const query = new URLSearchParams({
    select: 'slug,titulo_es,titulo_va,descripcion_es,descripcion_va,fecha,hora_inicio,hora_fin,lugar,direccion,estado,created_at,barrios:barrios(slug,nombre_es,nombre_va,lat,lng)',
    order: 'fecha.asc,hora_inicio.asc',
  });
  query.set('estado', 'eq.publicado');
  if (slug) query.set('slug', `eq.${slug}`);
  if (from) query.set('fecha', `gte.${from}`);
  const seedFiltered = seedEvents
    .filter((row) => row.estado === 'publicado')
    .filter((row) => !slug || row.slug === slug)
    .filter((row) => !from || row.fecha >= from);
  const { items, source } = await fetchRows(`events?${query.toString()}`, seedFiltered, normalizeEvent, lang);
  const now = new Date().toISOString().slice(0, 10);
  const upcoming = items.filter((item) => item.date >= now).slice(0, 8);
  const past = items.filter((item) => item.date < now).slice(-6).reverse();
  const calendar = {};
  items.forEach((item) => {
    const date = parseDateOnly(item.date);
    const key = `${date.getUTCFullYear()}-${date.getUTCMonth() + 1}-${date.getUTCDate()}`;
    if (!calendar[key]) calendar[key] = [];
    calendar[key].push({ label: item.title, bg: item.catBg, col: item.catCol });
  });
  return {
    ok: true,
    source,
    monthLabel: monthLong(upcoming[0]?.date || now, lang),
    items,
    upcoming,
    past,
    calendar,
  };
}

export async function getCampaigns(params = {}) {
  const lang = isVa(params.lang) ? 'va' : 'es';
  const estado = clean(params.estado);
  const slug = clean(params.slug);
  const query = new URLSearchParams({
    select: 'slug,titulo_es,titulo_va,descripcion_es,descripcion_va,imagen,destacada,progreso,objetivos,cronologia,docs,estado,created_at',
    order: 'destacada.desc,created_at.desc',
  });
  if (estado) query.set('estado', `eq.${estado}`);
  if (slug) query.set('slug', `eq.${slug}`);
  const seedFiltered = seedCampaigns
    .filter((row) => !estado || row.estado === estado)
    .filter((row) => !slug || row.slug === slug);
  const { items, source } = await fetchRows(`campaigns?${query.toString()}`, seedFiltered, normalizeCampaign, lang);
  const featured = items.find((item) => item.slug === '38-camaras-seguridad') || items[0] || null;
  return {
    ok: true,
    source,
    featured,
    active: items.filter((item) => item.state === 'activa'),
    finished: items.filter((item) => item.state === 'finalizada'),
    items,
  };
}

export async function getActuaciones(params = {}) {
  const lang = isVa(params.lang) ? 'va' : 'es';
  const barrio = clean(params.barrio);
  const slug = clean(params.slug);
  const query = new URLSearchParams({
    select: 'slug,titulo_es,titulo_va,descripcion_es,descripcion_va,estado,cronologia,lat,lng,created_at,barrios:barrios(slug,nombre_es,nombre_va,lat,lng)',
    order: 'created_at.desc',
  });
  if (slug) query.set('slug', `eq.${slug}`);
  const seedFiltered = seedActuaciones
    .filter((row) => !slug || row.slug === slug)
    .filter((row) => !barrio || row.barrio_slug === barrio);
  const { items, source } = await fetchRows(`actuaciones?${query.toString()}`, seedFiltered, normalizeActuacion, lang);
  const filteredItems = barrio ? items.filter((item) => item.barrioSlug === barrio) : items;
  const grouped = new Map();
  filteredItems.forEach((item) => {
    if (!grouped.has(item.barrioSlug)) grouped.set(item.barrioSlug, { slug: item.barrioSlug, name: item.barrio, count: 0, solved: 0 });
    const current = grouped.get(item.barrioSlug);
    current.count += 1;
    if (item.stateKey === 'completada') current.solved += 1;
  });
  const barrios = Array.from(grouped.values()).map((entry) => ({
    href: entry.slug ? `/barrio/${entry.slug}` : '/barrio',
    name: entry.name,
    count: String(entry.count),
    solucionadas: entry.solved ? String(entry.solved) : '—',
    pct: entry.count ? `${Math.round((entry.solved / entry.count) * 100)}%` : '0%',
  }));
  const pins = filteredItems.filter((item) => item.lat && item.lng).map((item) => ({
    lat: item.lat,
    lng: item.lng,
    color: item.color,
    label: item.title,
  }));
  const states = {
    completada: filteredItems.filter((item) => item.stateKey === 'completada').length,
    en_curso: filteredItems.filter((item) => item.stateKey === 'en_curso').length,
    propuesta: filteredItems.filter((item) => item.stateKey === 'propuesta').length,
  };
  const stats = [
    { value: String(filteredItems.length), label: pick('acciones registradas', 'accions registrades', lang), color: '#1563C4' },
    { value: String(new Set(filteredItems.map((item) => item.barrioSlug)).size), label: pick('barrios activos', 'barris actius', lang), color: '#2E9E5B' },
    { value: String(states.en_curso), label: pick('en ejecución', 'en execució', lang), color: '#0FA6B6' },
    { value: String(states.completada), label: pick('resueltas', 'resoltes', lang), color: '#D98A0B' },
  ];
  return {
    ok: true,
    source,
    items: filteredItems,
    stats,
    barrios,
    pins,
    legend: [
      { label: pick('Solucionado', 'Solucionat', lang), color: ACTION_THEME.completada.color },
      { label: pick('En ejecución', 'En execució', lang), color: ACTION_THEME.en_curso.color },
      { label: pick('Presentado', 'Presentat', lang), color: ACTION_THEME.propuesta.color },
    ],
  };
}

export async function getEquipo(params = {}) {
  const lang = isVa(params.lang) ? 'va' : 'es';
  const query = new URLSearchParams({
    select: 'slug,nombre,cargo_es,cargo_va,bio_es,bio_va,foto,orden,activo,areas',
    order: 'orden.asc',
  });
  query.set('activo', 'eq.true');
  const { items, source } = await fetchRows(`equipo?${query.toString()}`, seedEquipo.filter((row) => row.activo), normalizeEquipo, lang);
  return { ok: true, source, items };
}

export async function getHome(params = {}) {
  const lang = isVa(params.lang) ? 'va' : 'es';
  const [posts, events, campaigns, actuaciones] = await Promise.all([
    getPosts({ lang, limit: 3 }),
    getEvents({ lang }),
    getCampaigns({ lang }),
    getActuaciones({ lang }),
  ]);
  return {
    ok: true,
    source: [posts.source, events.source, campaigns.source, actuaciones.source].includes('supabase') ? 'mixed' : 'seed',
    posts: posts.items.slice(0, 3),
    events: events.upcoming.slice(0, 3),
    campaign: campaigns.featured,
    actuaciones: actuaciones.items.slice(0, 5),
    pins: actuaciones.pins,
  };
}

export function cacheHeaders(seconds = 300) {
  return {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': `public, max-age=${seconds}`,
  };
}
