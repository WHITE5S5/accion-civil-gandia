// Chat de miembros (Comunidad) — requiere sesión.
// GET  /api/chat?before=<iso>&limit=50 — historial (más recientes primero)
// POST /api/chat {texto} — publica mensaje
// POST /api/chat {action:'ocultar', id} — moderación (moderador/admin)
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { getUser } from './lib/auth.mjs';
import { supa, supaConfigured, jsonErr, jsonOk } from './lib/supa.mjs';
import { rateLimited } from './contacto.mjs';
import { splitCargo } from './lib/names.mjs';
import { titulosPayload } from './lib/titulos.mjs';

async function rolDe(userId) {
  const r = await supa('GET', `profiles?id=eq.${userId}&select=rol,nombre,bloqueado`);
  return r.json?.[0] || {};
}

export default async (req, context) => {
  if (!supaConfigured()) return jsonErr(503, 'unconfigured', 'El chat aún no está activo');
  const user = await getUser(req);
  if (!user) return jsonErr(401, 'login_required', 'Inicia sesión para usar el chat');

  if (req.method === 'GET') {
    const url = new URL(req.url);
    const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 100);
    const before = String(url.searchParams.get('before') || '');
    const lang = url.searchParams.get('lang') === 'va' ? 'va' : 'es';
    let q = `messages?estado=eq.publicado&select=id,texto,created_at,user_id,profiles(nombre,avatar_url,es_donante,es_afiliado,voluntariado)&order=created_at.desc&limit=${limit}`;
    if (/^\d{4}-\d{2}-\d{2}T[\d:.]+Z?$/.test(before)) q += `&created_at=lt.${encodeURIComponent(before)}`;
    const r = await supa('GET', q);
    if (!r.ok) return jsonErr(502, 'db_error', 'No se pudo cargar el chat');
    const items = (r.json || []).map(m => {
      const sc = splitCargo(m.profiles?.nombre || 'Vecino/a');
      return {
        id: m.id, texto: m.texto, at: m.created_at,
        autor: sc.nombre, cargo: sc.cargo,
        titulos: titulosPayload(m.profiles || {}, lang),
        avatar: (m.profiles?.avatar_url && m.profiles.avatar_url !== 'none') ? m.profiles.avatar_url : '', mio: m.user_id === user.id,
      };
    });
    return jsonOk({ ok: true, items });
  }

  if (req.method !== 'POST') return jsonErr(405, 'method_not_allowed', 'Método no permitido');
  let b;
  try { b = await req.json(); } catch { return jsonErr(400, 'bad_json', 'Cuerpo inválido'); }

  if (b.action === 'ocultar') {
    const perfil = await rolDe(user.id);
    if (!['moderador', 'admin'].includes(perfil.rol)) return jsonErr(403, 'forbidden', 'Solo moderación');
    const id = String(b.id || '');
    if (!/^[0-9a-f-]{36}$/.test(id)) return jsonErr(400, 'bad_id', 'Id no válido');
    const r = await supa('PATCH', `messages?id=eq.${id}`, { estado: 'oculto' });
    if (!r.ok) return jsonErr(502, 'db_error', 'No se pudo ocultar');
    await supa('POST', 'audit_log', { accion: 'ocultar_mensaje', tabla: 'messages', registro_id: id, user_id: user.id, detalle: {} }).catch(() => {});
    return jsonOk();
  }

  const ip = context.ip || '0.0.0.0';
  if (rateLimited('chat:' + user.id, 15)) return jsonErr(429, 'rate_limited', 'Vas muy rápido — espera un momento');
  const perfil = await rolDe(user.id);
  if (perfil.bloqueado) return jsonErr(403, 'blocked', 'Tu cuenta ha sido bloqueada y no puede publicar en la comunidad.');
  const texto = String(b.texto || '').trim().slice(0, 1000);
  if (texto.length < 1) return jsonErr(400, 'empty', 'El mensaje está vacío');
  const r = await supa('POST', 'messages', { user_id: user.id, texto });
  if (!r.ok) return jsonErr(502, 'db_error', 'No se pudo enviar');
  return jsonOk({ ok: true });
};

export const config = { path: '/api/chat' };
