// GET /api/tesoreria — agregado público de tesorería para la página Transparencia.
// Agrupa por categoría los movimientos del ejercicio (o del indicado con ?ejercicio=).
// ?lang=va traduce las categorías. ?format=csv descarga el libro de movimientos completo.
import { supa, supaConfigured } from './lib/supa.mjs';
import { cacheHeaders } from './lib/content-api.mjs';

const EUR = (c) => (c / 100).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

// Traducción de categorías al valenciano (las categorías viven en ES en la BBDD)
const CAT_VA = {
  'Cuotas': 'Quotes', 'Cuotas afiliados': 'Quotes d’afiliats', 'Donaciones': 'Donacions',
  'Material': 'Material', 'Eventos': 'Esdeveniments', 'Actos': 'Actes', 'Administración': 'Administració',
  'Gestoría': 'Gestoria', 'Publicidad': 'Publicitat', 'Imprenta': 'Impremta', 'Web': 'Web',
  'Local': 'Local', 'Alquiler': 'Lloguer', 'Comisiones bancarias': 'Comissions bancàries',
  'Banco': 'Banc', 'Seguros': 'Assegurances', 'Transporte': 'Transport', 'Otros': 'Altres', 'Otro': 'Altre', 'Otros ingresos': 'Altres ingressos', 'Otros gastos': 'Altres despeses',
};
const traduce = (label, va) => (va && CAT_VA[label]) || label;

export default async (req) => {
  if (req.method !== 'GET')
    return new Response(JSON.stringify({ error: { code: 'method_not_allowed' } }), { status: 405 });
  const url = new URL(req.url);
  const va = url.searchParams.get('lang') === 'va';
  const empty = { ok: true, movimientos: 0, ingresos: [], gastos: [], saldo: '0 €', totalIngresos: '0 €', totalGastos: '0 €' };
  if (!supaConfigured())
    return new Response(JSON.stringify(empty), { status: 200, headers: cacheHeaders(60) });

  // ---- CSV descargable: libro completo de movimientos (transparencia real) ----
  if (url.searchParams.get('format') === 'csv') {
    const r = await supa('GET', 'tesoreria?select=fecha,tipo,categoria,concepto,importe_cents,ejercicio&order=fecha.asc&limit=5000');
    const rows = Array.isArray(r.json) ? r.json : [];
    const NL = String.fromCharCode(10);
    const csvCell = (x) => '"' + String(x == null ? '' : x).replace(/"/g, '""') + '"';
    let saldo = 0;
    const lineas = rows.map((x) => {
      saldo += x.tipo === 'ingreso' ? x.importe_cents : -x.importe_cents;
      return [x.fecha, x.tipo, x.categoria, x.concepto || '', (x.importe_cents / 100).toFixed(2).replace('.', ','), (saldo / 100).toFixed(2).replace('.', ',')].map(csvCell).join(';');
    });
    const cab = ['Fecha', 'Tipo', 'Categoría', 'Concepto', 'Importe (EUR)', 'Saldo acumulado (EUR)'].map(csvCell).join(';');
    const csv = '﻿' + cab + NL + lineas.join(NL);
    return new Response(csv, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="cuentas-accion-civil-gandia.csv"',
        ...cacheHeaders(60),
      },
    });
  }

  // Libro histórico: agregamos TODOS los movimientos → el saldo es el real acumulado de la cuenta.
  // (Se puede acotar a un año con ?ejercicio=YYYY, pero por defecto se muestra el total.)
  const ej = Number(url.searchParams.get('ejercicio'));
  const filtro = ej ? `ejercicio=eq.${ej}&` : '';
  const r = await supa('GET', `tesoreria?${filtro}select=tipo,categoria,importe_cents,ejercicio&order=fecha.asc&limit=5000`);
  if (!r.ok || !Array.isArray(r.json))
    return new Response(JSON.stringify(empty), { status: 200, headers: cacheHeaders(60) });
  const anios = [...new Set(r.json.map((x) => x.ejercicio))].filter(Boolean).sort();
  const ejercicio = ej || (anios.length ? `${anios[0]}–${anios[anios.length - 1]}` : new Date().getFullYear());

  const group = (tipo) => {
    const m = new Map();
    for (const x of r.json.filter((x) => x.tipo === tipo))
      m.set(x.categoria, (m.get(x.categoria) || 0) + x.importe_cents);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([label, cents]) => ({ label: traduce(label, va), value: EUR(cents), cents }));
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
