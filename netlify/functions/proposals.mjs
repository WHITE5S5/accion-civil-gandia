// GET /api/proposals — propuestas ciudadanas PUBLICADAS con recuento de votos.
// Listo para Fase 3. La página Participacion se conectará cuando haya ≥6 propuestas
// reales publicadas (hasta entonces mantiene su demo — decisión 2026-07-08).
import { supaRead, supaReadConfigured } from './lib/supa.mjs';
import { cacheHeaders } from './lib/content-api.mjs';

export default async (req) => {
  if (req.method !== 'GET')
    return new Response(JSON.stringify({ error: { code: 'method_not_allowed' } }), { status: 405 });
  if (!supaReadConfigured())
    return new Response(JSON.stringify({ ok: true, items: [], total: 0 }), { status: 200, headers: cacheHeaders(60) });

  const lang = new URL(req.url).searchParams.get('lang') === 'va' ? 'va' : 'es';
  const q = new URLSearchParams({
    select: 'id,titulo,descripcion,categoria,estado,created_at,contacto_nombre,barrios:barrios(slug,nombre_es,nombre_va),proposal_vote_counts:proposal_vote_counts(a_favor,en_contra)',
    order: 'created_at.desc',
    limit: '30',
  });
  q.set('estado', 'in.(publicada,aprobada,en_estudio)');
  const r = await supaRead(`proposals?${q.toString()}`);
  if (!r.ok || !Array.isArray(r.json))
    return new Response(JSON.stringify({ ok: true, items: [], total: 0 }), { status: 200, headers: cacheHeaders(60) });

  const items = r.json.map((row) => {
    const nombre = row.contacto_nombre || (lang === 'va' ? 'Anònim' : 'Anónimo');
    const votes = Array.isArray(row.proposal_vote_counts) ? row.proposal_vote_counts[0] : row.proposal_vote_counts;
    return {
      id: row.id,
      title: row.titulo,
      excerpt: String(row.descripcion || '').slice(0, 180),
      cat: row.categoria,
      barrio: row.barrios ? (lang === 'va' ? row.barrios.nombre_va : row.barrios.nombre_es) : '',
      autor: nombre,
      ini: nombre.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase(),
      aFavor: votes?.a_favor || 0,
      enContra: votes?.en_contra || 0,
      estadoKey: row.estado,
      fecha: String(row.created_at).slice(0, 10),
    };
  });
  return new Response(JSON.stringify({ ok: true, items, total: items.length }), { status: 200, headers: cacheHeaders(120) });
};

export const config = { path: '/api/proposals' };
