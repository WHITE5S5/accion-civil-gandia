import { cacheHeaders, getHome } from './lib/content-api.mjs';
import { supa, supaConfigured } from './lib/supa.mjs';

// Estadísticas públicas reales (afiliados activos, propuestas recibidas, barrios con actividad)
async function statsReales() {
  if (!supaConfigured()) return null;
  try {
    const count = async (q) => {
      const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${q}`, {
        method: 'HEAD',
        headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, prefer: 'count=exact' },
      });
      return Number((r.headers.get('content-range') || '').split('/')[1]) || 0;
    };
    // Afiliados REALES = suscripciones activas de Stripe (mismo criterio que el panel /admin:
    // estado 'active' o 'baja_fin'). La tabla legacy `afiliados` son históricos pendientes de
    // reafiliación, no socios al día → no se cuentan aquí.
    const afiliadosStripe = async () => {
      const sk = process.env.STRIPE_SECRET_KEY;
      if (!sk) return count('afiliados?estado=eq.activo&select=id'); // sin Stripe (dev): respaldo legacy
      try {
        const r = await fetch('https://api.stripe.com/v1/subscriptions?status=all&limit=100', {
          headers: { authorization: 'Bearer ' + sk },
        }).then((x) => x.json());
        const subs = (r.data || []).filter((s) => !['canceled', 'incomplete_expired', 'incomplete'].includes(s.status));
        return subs.filter((s) => {
          const estado = s.pause_collection ? 'pausado' : (s.cancel_at_period_end ? 'baja_fin' : s.status);
          return estado === 'active' || estado === 'baja_fin';
        }).length;
      } catch { return count('afiliados?estado=eq.activo&select=id'); }
    };
    const [afiliados, propuestas, barrios] = await Promise.all([
      afiliadosStripe(),
      count('proposals?select=id'),
      count('barrios?select=id'),
    ]);
    return { afiliados: Number(afiliados) || 0, propuestas, barrios, fundacion: 2022 };
  } catch { return null; }
}

export default async (req) => {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: { code: 'method_not_allowed', message: 'Solo GET' } }), {
      status: 405,
      headers: cacheHeaders(0),
    });
  }
  const [data, stats] = await Promise.all([
    getHome(Object.fromEntries(new URL(req.url).searchParams.entries())),
    statsReales(),
  ]);
  if (stats) data.stats = stats;
  return new Response(JSON.stringify(data), { status: 200, headers: cacheHeaders() });
};

export const config = { path: '/api/home' };
