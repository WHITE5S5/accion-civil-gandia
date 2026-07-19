// GET /api/proposals — propuestas ciudadanas publicadas, con forma de tarjeta lista para render.
// GET /api/proposals?id=<uuid> — una propuesta con sus comentarios publicados (detalle).
import { supaRead, supaReadConfigured, supa, supaConfigured } from './lib/supa.mjs';
import { cacheHeaders } from './lib/content-api.mjs';
import { rangoDe, TITULO_META, titulosPayload } from './lib/titulos.mjs';

// Tema de categoría (clave = valor real del formulario) → chip + color.
const CAT = {
  'Urbanismo y vivienda': { key: 'vivienda', col: '#1563C4', bg: '#EAF3FC' },
  'Movilidad y transporte': { key: 'movilidad', col: '#6B4EE6', bg: '#EEEAFB' },
  'Medio ambiente': { key: 'medio', col: '#1E7A45', bg: '#E7F4EC' },
  'Cultura y fiestas': { key: 'cultura', col: '#C2410C', bg: '#FBEEE6' },
  'Educación': { key: 'educacion', col: '#0B7580', bg: '#E4F5F7' },
  'Sanidad': { key: 'sanidad', col: '#D24B4B', bg: '#FBECEC' },
  'Servicios sociales': { key: 'sociales', col: '#6B4EE6', bg: '#EEEAFB' },
  'Seguridad ciudadana': { key: 'seguridad', col: '#D24B4B', bg: '#FBECEC' },
  'Economía local': { key: 'economia', col: '#C2410C', bg: '#FBEEE6' },
  'Deportes': { key: 'deportes', col: '#1563C4', bg: '#EAF3FC' },
  'Turismo': { key: 'turismo', col: '#0B7580', bg: '#E4F5F7' },
  'Servicios básicos': { key: 'servicios', col: '#0B7580', bg: '#E4F5F7' },
  'Otro': { key: 'otro', col: '#5C6B7A', bg: '#EEF2F7' },
};
const AV = ['#0FA6B6', '#6B4EE6', '#1563C4', '#2E9E5B', '#C2410C', '#D24B4B', '#E0851B'];
// estado → etiqueta + color
const EST = {
  publicada: { es: 'Recogiendo apoyos', va: 'Recollint suports', col: '#0B7580', bg: '#E4F5F7', oficial: false },
  en_estudio: { es: 'Estudio técnico', va: 'Estudi tècnic', col: '#1563C4', bg: '#EAF3FC', oficial: true },
  aprobada: { es: 'Aceptada', va: 'Acceptada', col: '#1E7A45', bg: '#E7F4EC', oficial: true },
};
const umbral = (apoyos) => [100, 500, 1000, 5000, 10000].find((u) => u > apoyos) || 10000;
function haceTxt(iso, va) {
  const dias = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 864e5));
  if (dias <= 0) return va ? 'hui' : 'hoy';
  if (dias === 1) return va ? 'fa 1 dia' : 'hace 1 día';
  return va ? `fa ${dias} dies` : `hace ${dias} días`;
}

function tarjeta(row, lang) {
  const va = lang === 'va';
  const nombre = row.contacto_nombre || (va ? 'Anònim' : 'Anónimo');
  const votes = Array.isArray(row.proposal_vote_counts) ? row.proposal_vote_counts[0] : row.proposal_vote_counts;
  const apoyos = (votes && votes.a_favor) || 0;
  const comentCount = Array.isArray(row.comments) ? (row.comments[0] ? row.comments[0].count : 0) : 0;
  const cat = CAT[row.categoria] || CAT['Otro'];
  const est = EST[row.estado] || EST.publicada;
  const idNum = parseInt(String(row.id).replace(/[^0-9a-f]/g, '').slice(0, 6), 16) || 0;
  return {
    id: row.id,
    catKey: cat.key, cat: row.categoria, catColor: cat.col, catBg: cat.bg,
    barrioKey: row.barrios ? row.barrios.slug : '',
    barrio: row.barrios ? (va ? row.barrios.nombre_va : row.barrios.nombre_es) : (va ? 'Tota la ciutat' : 'Toda la ciudad'),
    autor: nombre,
    ini: nombre.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '·',
    avBg: AV[idNum % AV.length],
    apoyos, meta: umbral(apoyos),
    aFavor: apoyos, enContra: (votes && votes.en_contra) || 0,
    coment: comentCount, seguidores: apoyos + ((votes && votes.en_contra) || 0),
    estado: va ? est.va : est.es, estadoColor: est.col, estadoBg: est.bg, estadoKey: row.estado, oficial: est.oficial,
    ultima: haceTxt(row.created_at, va),
    dias: Math.max(0, Math.floor((Date.now() - new Date(row.created_at).getTime()) / 864e5)),
    title: row.titulo, destacada: !!row.destacada,
    excerpt: String(row.descripcion || '').slice(0, 180),
    descripcion: String(row.descripcion || ''),
    imagenes: Array.isArray(row.imagenes) ? row.imagenes.filter((u) => typeof u === 'string' && u.startsWith('https://msbrdowdkwqrrdlfeztj.supabase.co/storage/')) : [],
    lat: row.lat != null ? row.lat : null,
    lng: row.lng != null ? row.lng : null,
    recorrido: Array.isArray(row.recorrido) ? row.recorrido : [],
    umbrales: Array.isArray(row.umbrales) ? row.umbrales : null,
  };
}

export default async (req) => {
  if (req.method !== 'GET')
    return new Response(JSON.stringify({ error: { code: 'method_not_allowed' } }), { status: 405 });
  if (!supaReadConfigured())
    return new Response(JSON.stringify({ ok: true, items: [], total: 0 }), { status: 200, headers: cacheHeaders(60) });

  const url = new URL(req.url);
  const lang = url.searchParams.get('lang') === 'va' ? 'va' : 'es';
  const id = url.searchParams.get('id');
  const sel = 'id,user_id,titulo,descripcion,categoria,estado,destacada,created_at,contacto_nombre,imagenes,lat,lng,recorrido,umbrales,barrios:barrios(slug,nombre_es,nombre_va),proposal_vote_counts:proposal_vote_counts(a_favor,en_contra),comments:comments(count)';

  if (id) {                                             // ---- detalle de una propuesta
    if (!/^[0-9a-f-]{36}$/.test(id))
      return new Response(JSON.stringify({ ok: false }), { status: 400, headers: cacheHeaders(0) });
    const r = await supaRead(`proposals?id=eq.${id}&estado=in.(publicada,aprobada,en_estudio)&select=${sel}`);
    const row = r.ok && Array.isArray(r.json) ? r.json[0] : null;
    if (!row) return new Response(JSON.stringify({ ok: false }), { status: 404, headers: cacheHeaders(0) });
    const c = await supaRead(`comments?proposal_id=eq.${id}&estado=eq.publicado&select=texto,created_at&order=created_at.desc&limit=50`);
    const va = lang === 'va';
    const comentarios = (c.ok && Array.isArray(c.json) ? c.json : []).map((x) => ({
      texto: x.texto, hace: haceTxt(x.created_at, va),
    }));
    const item = tarjeta(row, lang);
    // Ficha del autor: rango (insignia) + nº de propuestas + apoyos totales.
    // Solo si NO es anónimo (contacto_nombre presente) para no desanonimizar. profiles requiere service role.
    if (row.user_id && row.contacto_nombre && supaConfigured()) {
      const [prof, props] = await Promise.all([
        supa('GET', `profiles?id=eq.${row.user_id}&select=nombre,voluntariado,es_afiliado,es_donante,avatar_url`),
        supa('GET', `proposals?user_id=eq.${row.user_id}&estado=in.(publicada,aprobada,en_estudio)&select=id,proposal_vote_counts:proposal_vote_counts(a_favor)`),
      ]);
      const pf = (prof.json && prof.json[0]) || {};
      const meta = TITULO_META[rangoDe(pf)] || TITULO_META.ciudadano;
      item.autorTitulo = va ? meta.va : meta.es;
      item.autorTitulos = titulosPayload(pf, lang);
      item.autorAvatar = (pf.avatar_url && pf.avatar_url !== 'none') ? pf.avatar_url : '';
      const lista = Array.isArray(props.json) ? props.json : [];
      item.autorProps = lista.length;
      item.autorApoyos = lista.reduce((s, x) => {
        const vc = Array.isArray(x.proposal_vote_counts) ? x.proposal_vote_counts[0] : x.proposal_vote_counts;
        return s + ((vc && vc.a_favor) || 0);
      }, 0);
    }
    if (!item.umbrales || !item.umbrales.length) {                 // sin override → umbrales globales
      const g = await supaRead('app_settings?key=eq.umbrales_propuestas&select=value');
      const gv = g.ok && Array.isArray(g.json) && g.json[0] ? g.json[0].value : null;
      item.umbrales = Array.isArray(gv) ? gv : null;
    }
    return new Response(JSON.stringify({ ok: true, item, comentarios }), {
      status: 200, headers: cacheHeaders(20),
    });
  }

  const q = new URLSearchParams({ select: sel, order: 'created_at.desc', limit: '30' });
  q.set('estado', 'in.(publicada,aprobada,en_estudio)');
  const r = await supaRead(`proposals?${q.toString()}`);
  if (!r.ok || !Array.isArray(r.json))
    return new Response(JSON.stringify({ ok: true, items: [], total: 0 }), { status: 200, headers: cacheHeaders(60) });
  const items = r.json.map((row) => tarjeta(row, lang));
  // Avatares de los autores (solo NO anónimos), en un único lookup batch (profiles requiere service role).
  if (supaConfigured()) {
    const ids = [...new Set(r.json.filter((row) => row.user_id && row.contacto_nombre).map((row) => row.user_id))];
    if (ids.length) {
      const pr = await supa('GET', `profiles?id=in.(${ids.join(',')})&select=id,avatar_url`);
      const avMap = {};
      for (const p of (pr.json || [])) if (p.avatar_url && p.avatar_url !== 'none') avMap[p.id] = p.avatar_url;
      r.json.forEach((row, i) => { if (row.user_id && row.contacto_nombre && avMap[row.user_id]) items[i].autorAvatar = avMap[row.user_id]; });
    }
  }
  // total de propuestas RECIBIDAS (todas, incluidas pendientes/rechazadas) para el contador público
  let recibidas = items.length;
  try {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;   // service: cuenta también las pendientes (RLS)
    const rc = await fetch(`${process.env.SUPABASE_URL}/rest/v1/proposals?select=id`, {
      method: 'HEAD', headers: { apikey: key, authorization: `Bearer ${key}`, prefer: 'count=exact' },
    });
    const t = Number((rc.headers.get('content-range') || '').split('/')[1]);
    if (Number.isFinite(t)) recibidas = t;
  } catch {}
  return new Response(JSON.stringify({ ok: true, items, total: items.length, recibidas }), {
    status: 200, headers: cacheHeaders(120),
  });
};

export const config = { path: '/api/proposals' };
