// GET /api/tesoreria — agregado público de tesorería para la página Transparencia.
// Agrupa por categoría los movimientos del ejercicio (o del indicado con ?ejercicio=).
import { supa, supaConfigured } from './lib/supa.mjs';
import { cacheHeaders } from './lib/content-api.mjs';

const EUR = (c) => (c / 100).toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' €';

export default async (req) => {
  if (req.method !== 'GET')
    return new Response(JSON.stringify({ error: { code: 'method_not_allowed' } }), { status: 405 });
  const empty = { ok: true, movimientos: 0, ingresos: [], gastos: [], saldo: '0 €', totalIngresos: '0 €', totalGastos: '0 €' };
  if (!supaConfigured())
    return new Response(JSON.stringify(empty), { status: 200, headers: cacheHeaders(60) });

  const url = new URL(req.url);
  const ejercicio = Number(url.searchParams.get('ejercicio')) || new Date().getFullYear();
  const r = await supa('GET', `tesoreria?ejercicio=eq.${ejercicio}&select=tipo,categoria,importe_cents&limit=2000`);
  if (!r.ok || !Array.isArray(r.json))
    return new Response(JSON.stringify(empty), { status: 200, headers: cacheHeaders(60) });

  const group = (tipo) => {
    const m = new Map();
    for (const x of r.json.filter((x) => x.tipo === tipo))
      m.set(x.categoria, (m.get(x.categoria) || 0) + x.importe_cents);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([label, cents]) => ({ label, value: EUR(cents), cents }));
  };
  const ingresos = group('ingreso'), gastos = group('gasto');
  const ti = ingresos.reduce((s, x) => s + x.cents, 0), tg = gastos.reduce((s, x) => s + x.cents, 0);
  return new Response(JSON.stringify({
    ok: true, ejercicio, movimientos: r.json.length,
    ingresos, gastos,
    totalIngresos: EUR(ti), totalGastos: EUR(tg), saldo: EUR(ti - tg),
  }), { status: 200, headers: cacheHeaders(120) });
};

export const config = { path: '/api/tesoreria' };
