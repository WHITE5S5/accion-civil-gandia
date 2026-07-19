// POST /api/comentarios {proposalId, texto} — requiere sesión; se publica al instante (sin moderación previa; el admin puede borrarlos).
// POST /api/comentarios {action:'like', commentId} — toggle de like (requiere sesión + migración 014).
// GET /api/comentarios?proposalId= — públicos (estado publicado) con likes y autor.
import { getUser } from './lib/auth.mjs';
import { supa, supaConfigured, jsonErr, jsonOk } from './lib/supa.mjs';
import { rateLimited } from './contacto.mjs';
import { splitCargo } from './lib/names.mjs';
import { titulosPayload } from './lib/titulos.mjs';

// La tabla comment_likes llega con la migración 014: si aún no existe, la API degrada
// (likesOn:false) y la web oculta los corazones en vez de romperse.
let LIKES_ON = null;
async function likesDisponibles() {
  if (LIKES_ON !== null) return LIKES_ON;
  const r = await supa('GET', 'comment_likes?select=comment_id&limit=1');
  LIKES_ON = r.ok;
  return LIKES_ON;
}

async function likesDe(commentIds) {
  if (!commentIds.length || !(await likesDisponibles())) return {};
  const r = await supa('GET', `comment_likes?comment_id=in.(${commentIds.join(',')})&select=comment_id,user_id`);
  const map = {};
  for (const row of r.json || []) {
    (map[row.comment_id] ||= { n: 0, users: new Set() });
    map[row.comment_id].n++; map[row.comment_id].users.add(row.user_id);
  }
  return map;
}

export default async (req, context) => {
  if (!supaConfigured()) return jsonErr(503, 'unconfigured', 'No disponible todavía');
  const url = new URL(req.url);

  if (req.method === 'GET') {
    const pid = String(url.searchParams.get('proposalId') || '');
    if (!/^[0-9a-f-]{36}$/.test(pid)) return jsonErr(400, 'bad_id', 'Propuesta no válida');
    const lang = url.searchParams.get('lang') === 'va' ? 'va' : 'es';
    const r = await supa('GET', `comments?proposal_id=eq.${pid}&estado=eq.publicado&select=id,texto,created_at,profiles:profiles(nombre,avatar_url,es_donante,es_afiliado,voluntariado)&order=created_at.asc&limit=100`);
    const rows = r.json || [];
    const likes = await likesDe(rows.map((c) => c.id));
    const user = await getUser(req);           // opcional: para marcar mis likes
    const items = rows.map((c) => {
      const sc = splitCargo(c.profiles?.nombre || 'Vecino/a');
      return {
        id: c.id, texto: c.texto, fecha: String(c.created_at).slice(0, 10),
        autor: sc.nombre, cargo: sc.cargo,
        titulos: titulosPayload(c.profiles || {}, lang),
        avatar: (c.profiles?.avatar_url && c.profiles.avatar_url !== 'none') ? c.profiles.avatar_url : '',
        likes: likes[c.id] ? likes[c.id].n : 0,
        miLike: !!(user && likes[c.id] && likes[c.id].users.has(user.id)),
      };
    });
    return jsonOk({ ok: true, items, likesOn: LIKES_ON === true });
  }

  if (req.method !== 'POST') return jsonErr(405, 'method_not_allowed', 'Método no permitido');
  const ip = req.headers.get('cf-connecting-ip') || context.ip || req.headers.get('x-nf-client-connection-ip') || '0.0.0.0';

  let b;
  try { b = await req.json(); } catch { return jsonErr(400, 'bad_json', 'Cuerpo inválido'); }

  const user = await getUser(req);
  if (!user) return jsonErr(401, 'login_required', 'Inicia sesión para participar');
  // Cuenta bloqueada: puede borrar lo suyo, pero no comentar ni dar like.
  const perfilB = await supa('GET', `profiles?id=eq.${user.id}&select=nombre,avatar_url,es_donante,es_afiliado,voluntariado,bloqueado`);
  const prof = (perfilB.json && perfilB.json[0]) || {};
  const cuentaBloqueada = !!prof.bloqueado;

  if (b.action === 'borrar') {                            // ---- borrar comentario propio
    const cid = String(b.commentId || '');
    if (!/^[0-9a-f-]{36}$/.test(cid)) return jsonErr(400, 'bad_id', 'Comentario no válido');
    const propio = await supa('GET', `comments?id=eq.${cid}&user_id=eq.${user.id}&select=id`);
    if (!(propio.json || []).length) return jsonErr(403, 'no_es_tuyo', 'Solo puedes borrar tus comentarios');
    const del = await supa('DELETE', `comments?id=eq.${cid}&user_id=eq.${user.id}`);
    if (!del.ok) return jsonErr(502, 'db_error', 'No se pudo borrar');
    return jsonOk({ ok: true, borrado: true });
  }

  if (cuentaBloqueada) return jsonErr(403, 'blocked', 'Tu cuenta ha sido bloqueada; no puedes comentar ni participar hasta nuevo aviso.');

  if (b.action === 'like') {                              // ---- toggle like
    if (rateLimited('like:' + ip, 60)) return jsonErr(429, 'rate_limited', 'Demasiadas peticiones');
    const cid = String(b.commentId || '');
    if (!/^[0-9a-f-]{36}$/.test(cid)) return jsonErr(400, 'bad_id', 'Comentario no válido');
    if (!(await likesDisponibles())) return jsonErr(503, 'likes_unavailable', 'Los likes aún no están activos');
    const ya = await supa('GET', `comment_likes?comment_id=eq.${cid}&user_id=eq.${user.id}&select=comment_id`);
    if ((ya.json || []).length) {
      await supa('DELETE', `comment_likes?comment_id=eq.${cid}&user_id=eq.${user.id}`);
    } else {
      const ins = await supa('POST', 'comment_likes', { comment_id: cid, user_id: user.id });
      if (!ins.ok) return jsonErr(502, 'db_error', 'No se pudo registrar');
    }
    const n = await supa('GET', `comment_likes?comment_id=eq.${cid}&select=comment_id`);
    return jsonOk({ ok: true, likes: (n.json || []).length, miLike: !(ya.json || []).length });
  }

  if (rateLimited('com:' + ip, 20)) return jsonErr(429, 'rate_limited', 'Demasiados comentarios seguidos');
  const proposalId = String(b.proposalId || '');
  const texto = String(b.texto || '').trim();
  if (!/^[0-9a-f-]{36}$/.test(proposalId)) return jsonErr(400, 'bad_id', 'Propuesta no válida');
  if (texto.length < 2 || texto.length > 2000) return jsonErr(400, 'invalid_texto', 'Comentario entre 2 y 2000 caracteres');

  // Sin moderación previa: se publica al instante. El admin los ve todos y puede borrarlos.
  const r = await supa('POST', 'comments', { proposal_id: proposalId, user_id: user.id, texto, estado: 'publicado' });
  if (!r.ok) { console.error('comment fail', r.status, r.text); return jsonErr(502, 'db_error', 'No se pudo guardar'); }
  // Devuelve el comentario ya formado (nombre, foto, cargo, medallas) para pintarlo al instante en la web.
  const row = (r.json && r.json[0]) || {};
  const lang = String(b.lang) === 'va' ? 'va' : 'es';
  const sc = splitCargo(prof.nombre || 'Vecino/a');
  const comentario = {
    id: row.id || '', texto, fecha: String(row.created_at || '').slice(0, 10),
    autor: sc.nombre, cargo: sc.cargo,
    titulos: titulosPayload(prof, lang),
    avatar: (prof.avatar_url && prof.avatar_url !== 'none') ? prof.avatar_url : '',
    likes: 0, miLike: false,
  };
  return jsonOk({ ok: true, enModeracion: false, comentario });
};

export const config = { path: '/api/comentarios' };
