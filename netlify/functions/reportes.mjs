// POST /api/reportes {proposalId, motivo, nota} — denunciar una propuesta ciudadana (requiere sesión).
// Se registra para revisión manual en el admin (no auto-oculta). 1 usuario = 1 denuncia por propuesta.
import { getUser } from './lib/auth.mjs';
import { supa, supaConfigured, jsonErr, jsonOk } from './lib/supa.mjs';
import { rateLimited } from './contacto.mjs';

const MOTIVOS = ['spam', 'ofensivo', 'falso', 'duplicado', 'otro'];

export default async (req, context) => {
  if (!supaConfigured()) return jsonErr(503, 'unconfigured', 'No disponible todavía');
  if (req.method !== 'POST') return jsonErr(405, 'method_not_allowed', 'Método no permitido');
  const ip = req.headers.get('cf-connecting-ip') || context.ip || req.headers.get('x-nf-client-connection-ip') || '0.0.0.0';
  if (rateLimited('report:' + ip, 15)) return jsonErr(429, 'rate_limited', 'Demasiadas denuncias seguidas');

  const user = await getUser(req);
  if (!user) return jsonErr(401, 'login_required', 'Inicia sesión para denunciar');

  let b;
  try { b = await req.json(); } catch { return jsonErr(400, 'bad_json', 'Cuerpo inválido'); }
  const proposalId = String(b.proposalId || '');
  const motivo = String(b.motivo || '');
  const nota = String(b.nota || '').trim().slice(0, 500);
  if (!/^[0-9a-f-]{36}$/.test(proposalId)) return jsonErr(400, 'bad_id', 'Propuesta no válida');
  if (!MOTIVOS.includes(motivo)) return jsonErr(400, 'bad_motivo', 'Motivo no válido');

  const exists = await supa('GET', `proposals?id=eq.${proposalId}&select=id`);
  if (!(exists.json || []).length) return jsonErr(404, 'not_found', 'Propuesta no encontrada');

  // upsert: si ya había denunciado, actualiza el motivo/nota en vez de duplicar
  const r = await supa('POST', 'proposal_reports?on_conflict=proposal_id,user_id',
    { proposal_id: proposalId, user_id: user.id, motivo, nota: nota || null, estado: 'pendiente' },
    { prefer: 'resolution=merge-duplicates,return=representation' });
  if (!r.ok) { console.error('report fail', r.status, r.text); return jsonErr(502, 'db_error', 'No se pudo registrar'); }
  return jsonOk({ ok: true });
};

export const config = { path: '/api/reportes' };
