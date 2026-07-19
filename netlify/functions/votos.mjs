// POST /api/votos {proposalId, valor: 1|-1} · DELETE {proposalId} — requiere sesión.
// 1 persona = 1 voto (unique proposal_id+user_id; repetir voto = cambiar sentido).
import { getUser } from './lib/auth.mjs';
import { supa, supaConfigured, jsonErr, jsonOk } from './lib/supa.mjs';
import { rateLimited } from './contacto.mjs';

async function counts(proposalId) {
  const r = await supa('GET', `proposal_vote_counts?proposal_id=eq.${proposalId}`);
  const c = r.json?.[0] || {};
  return { aFavor: c.a_favor || 0, enContra: c.en_contra || 0 };
}

export default async (req, context) => {
  if (!supaConfigured()) return jsonErr(503, 'unconfigured', 'No disponible todavía');
  const ip = req.headers.get('cf-connecting-ip') || context.ip || req.headers.get('x-nf-client-connection-ip') || '0.0.0.0';
  if (rateLimited('votos:' + ip, 60)) return jsonErr(429, 'rate_limited', 'Demasiadas peticiones');

  const user = await getUser(req);
  if (!user) return jsonErr(401, 'login_required', 'Inicia sesión para votar');

  // GET ?mine=1 — todos MIS votos (mapa proposal_id→valor) para inicializar la lista (botones en verde + toggle quitar)
  if (req.method === 'GET' && new URL(req.url).searchParams.get('mine')) {
    const v = await supa('GET', `votes?user_id=eq.${user.id}&select=proposal_id,valor`);
    const mine = {};
    for (const row of v.json || []) mine[row.proposal_id] = row.valor;
    return jsonOk({ ok: true, mine });
  }

  // GET ?proposalId= — estado inicial: mi voto actual + contadores (para pintar el botón al cargar)
  if (req.method === 'GET') {
    const pid = new URL(req.url).searchParams.get('proposalId') || '';
    if (!/^[0-9a-f-]{36}$/.test(pid)) return jsonErr(400, 'bad_id', 'Propuesta no válida');
    const v = await supa('GET', `votes?proposal_id=eq.${pid}&user_id=eq.${user.id}&select=valor`);
    return jsonOk({ ok: true, miVoto: (v.json && v.json[0] && v.json[0].valor) || 0, ...(await counts(pid)) });
  }

  let b;
  try { b = await req.json(); } catch { return jsonErr(400, 'bad_json', 'Cuerpo inválido'); }
  const proposalId = String(b.proposalId || '');
  if (!/^[0-9a-f-]{36}$/.test(proposalId)) return jsonErr(400, 'bad_id', 'Propuesta no válida');

  if (req.method === 'DELETE') {
    await supa('DELETE', `votes?proposal_id=eq.${proposalId}&user_id=eq.${user.id}`);
    return jsonOk({ ok: true, miVoto: 0, ...(await counts(proposalId)) });
  }
  if (req.method !== 'POST') return jsonErr(405, 'method_not_allowed', 'Método no permitido');

  const valor = Number(b.valor) === -1 ? -1 : 1;
  // solo se vota lo publicado/en estudio
  const p = await supa('GET', `proposals?id=eq.${proposalId}&select=estado`);
  if (!p.json?.length) return jsonErr(404, 'not_found', 'Propuesta no encontrada');
  if (!['publicada', 'en_estudio', 'aprobada'].includes(p.json[0].estado))
    return jsonErr(403, 'not_votable', 'Esta propuesta no admite votos');

  const r = await supa('POST', 'votes?on_conflict=proposal_id,user_id',
    { proposal_id: proposalId, user_id: user.id, valor },
    { prefer: 'resolution=merge-duplicates,return=representation' });
  if (!r.ok) { console.error('vote fail', r.status, r.text); return jsonErr(502, 'db_error', 'No se pudo registrar el voto'); }
  return jsonOk({ ok: true, miVoto: valor, ...(await counts(proposalId)) });
};

export const config = { path: '/api/votos' };
