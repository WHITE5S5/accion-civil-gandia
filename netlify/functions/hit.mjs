// POST /api/hit — registra un evento de analítica propia (pageview / click a red social).
// Lo llama support.js vía sendBeacon; escribe con service_role (la tabla no tiene políticas públicas).
import { supa, supaConfigured } from './lib/supa.mjs';

const TIPOS = { pv: 'pageview', social: 'social', cta: 'cta' };
const s = (v, max) => (typeof v === 'string' ? v.slice(0, max) : null);

export default async (req) => {
  if (req.method !== 'POST') return new Response(null, { status: 405 });
  if (!supaConfigured()) return new Response(null, { status: 204 });
  let b;
  try { b = JSON.parse(await req.text()); } catch { return new Response(null, { status: 204 }); }
  const tipo = TIPOS[b.t];
  if (!tipo) return new Response(null, { status: 204 });
  const path = s(b.p, 200) || '/';
  if (path.startsWith('/admin')) return new Response(null, { status: 204 });
  await supa('POST', 'analytics_events', {
    tipo, path,
    red: s(b.red, 30),
    sid: s(b.sid, 40),
    lang: s(b.l, 5),
    ref: s(b.r, 300) || null,
  }, { prefer: 'return=minimal' }).catch(() => {});
  return new Response(null, { status: 204 });
};

export const config = { path: '/api/hit' };
