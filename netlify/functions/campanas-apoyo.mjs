// Apoyos a campañas del partido (1 vecino registrado = 1 apoyo, retirable).
// GET  /api/campanas-apoyo?slug=x[,y,z]  → { counts: {slug: n}, mios: [slugs] (con sesión) }
// POST /api/campanas-apoyo {slug}        → toggle (requiere sesión) → { apoyos, miApoyo }
import { getUser } from './lib/auth.mjs';
import { supa, supaConfigured, jsonErr, jsonOk } from './lib/supa.mjs';
import { rateLimited } from './contacto.mjs';

const SLUG_RE = /^[a-z0-9-]{2,80}$/;

export default async (req, context) => {
  if (!supaConfigured()) return jsonErr(503, 'unconfigured', 'No disponible todavía');
  const url = new URL(req.url);

  if (req.method === 'GET') {
    const slugs = String(url.searchParams.get('slug') || '').split(',').filter((s) => SLUG_RE.test(s)).slice(0, 20);
    if (!slugs.length) return jsonErr(400, 'bad_slug', 'Campaña no válida');
    const r = await supa('GET', `campaign_supports?campaign_slug=in.(${slugs.join(',')})&select=campaign_slug,user_id`);
    const counts = {}; for (const s of slugs) counts[s] = 0;
    const user = await getUser(req);
    const mios = [];
    for (const row of r.json || []) {
      counts[row.campaign_slug] = (counts[row.campaign_slug] || 0) + 1;
      if (user && row.user_id === user.id) mios.push(row.campaign_slug);
    }
    return jsonOk({ ok: true, counts, mios });
  }

  if (req.method !== 'POST') return jsonErr(405, 'method_not_allowed', 'Método no permitido');
  const ip = req.headers.get('cf-connecting-ip') || context.ip || req.headers.get('x-nf-client-connection-ip') || '0.0.0.0';
  if (rateLimited('campapoyo:' + ip, 30)) return jsonErr(429, 'rate_limited', 'Demasiadas peticiones');
  const user = await getUser(req);
  if (!user) return jsonErr(401, 'login_required', 'Inicia sesión para apoyar la campaña');

  let b; try { b = await req.json(); } catch { return jsonErr(400, 'bad_json', 'Cuerpo inválido'); }
  const slug = String(b.slug || '');
  if (!SLUG_RE.test(slug)) return jsonErr(400, 'bad_slug', 'Campaña no válida');
  const c = await supa('GET', `campaigns?slug=eq.${slug}&select=id&limit=1`);
  if (!(c.json || []).length) return jsonErr(404, 'not_found', 'Campaña no encontrada');

  const ya = await supa('GET', `campaign_supports?campaign_slug=eq.${slug}&user_id=eq.${user.id}&select=campaign_slug`);
  let miApoyo;
  if ((ya.json || []).length) {
    await supa('DELETE', `campaign_supports?campaign_slug=eq.${slug}&user_id=eq.${user.id}`);
    miApoyo = false;
  } else {
    const ins = await supa('POST', 'campaign_supports', { campaign_slug: slug, user_id: user.id });
    if (!ins.ok) return jsonErr(502, 'db_error', 'No se pudo registrar');
    miApoyo = true;
  }
  const n = await supa('GET', `campaign_supports?campaign_slug=eq.${slug}&select=campaign_slug`);
  return jsonOk({ ok: true, apoyos: (n.json || []).length, miApoyo });
};

export const config = { path: '/api/campanas-apoyo' };
