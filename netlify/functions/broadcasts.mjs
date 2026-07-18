// GET /api/broadcasts — anuncios activos del canal de difusión (público, solo lectura).
import { supa, supaConfigured } from './lib/supa.mjs';
import { cacheHeaders } from './lib/content-api.mjs';

export default async (req) => {
  if (req.method !== 'GET')
    return new Response(JSON.stringify({ error: { code: 'method_not_allowed' } }), { status: 405 });
  if (!supaConfigured())
    return new Response(JSON.stringify({ ok: true, items: [] }), { status: 200, headers: cacheHeaders(30) });
  const nowIso = new Date().toISOString();
  const r = await supa('GET', `broadcasts?or=(expires_at.is.null,expires_at.gt.${nowIso})&select=id,texto,created_at&order=created_at.desc&limit=50`);
  const items = (Array.isArray(r.json) ? r.json : []).map((b) => ({ id: b.id, texto: b.texto, at: b.created_at }));
  return new Response(JSON.stringify({ ok: true, items }), { status: 200, headers: cacheHeaders(30) });
};

export const config = { path: '/api/broadcasts' };
