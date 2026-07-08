// POST /api/comentarios {proposalId, texto} — requiere sesión; entra en cola de moderación.
// GET /api/comentarios?proposalId= — públicos (estado publicado).
import { getUser } from './lib/auth.mjs';
import { supa, supaConfigured, jsonErr, jsonOk } from './lib/supa.mjs';
import { rateLimited } from './contacto.mjs';

export default async (req, context) => {
  if (!supaConfigured()) return jsonErr(503, 'unconfigured', 'No disponible todavía');
  const url = new URL(req.url);

  if (req.method === 'GET') {
    const pid = String(url.searchParams.get('proposalId') || '');
    if (!/^[0-9a-f-]{36}$/.test(pid)) return jsonErr(400, 'bad_id', 'Propuesta no válida');
    const r = await supa('GET', `comments?proposal_id=eq.${pid}&estado=eq.publicado&select=id,texto,created_at,profiles:profiles(nombre)&order=created_at.asc&limit=100`);
    const items = (r.json || []).map((c) => ({
      id: c.id, texto: c.texto, fecha: String(c.created_at).slice(0, 10),
      autor: c.profiles?.nombre || 'Vecino/a',
    }));
    return jsonOk({ ok: true, items });
  }

  if (req.method !== 'POST') return jsonErr(405, 'method_not_allowed', 'Método no permitido');
  const ip = context.ip || '0.0.0.0';
  if (rateLimited('com:' + ip, 20)) return jsonErr(429, 'rate_limited', 'Demasiados comentarios seguidos');

  const user = await getUser(req);
  if (!user) return jsonErr(401, 'login_required', 'Inicia sesión para comentar');

  let b;
  try { b = await req.json(); } catch { return jsonErr(400, 'bad_json', 'Cuerpo inválido'); }
  const proposalId = String(b.proposalId || '');
  const texto = String(b.texto || '').trim();
  if (!/^[0-9a-f-]{36}$/.test(proposalId)) return jsonErr(400, 'bad_id', 'Propuesta no válida');
  if (texto.length < 2 || texto.length > 2000) return jsonErr(400, 'invalid_texto', 'Comentario entre 2 y 2000 caracteres');

  const r = await supa('POST', 'comments', { proposal_id: proposalId, user_id: user.id, texto, estado: 'pendiente' });
  if (!r.ok) { console.error('comment fail', r.status, r.text); return jsonErr(502, 'db_error', 'No se pudo guardar'); }
  return jsonOk({ ok: true, enModeracion: true });
};

export const config = { path: '/api/comentarios' };
