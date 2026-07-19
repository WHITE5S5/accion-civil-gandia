// Función PROGRAMADA (diaria, 20:00 UTC ≈ 22:00 Madrid): envía al Telegram del equipo
// un resumen del día — visitas, participación (propuestas/comentarios/votos), donaciones,
// denuncias, chat, top páginas y fuentes de tráfico. Un vistazo rápido sin abrir el panel.
// GET ?test=1 → dispara el envío al instante (para probar). Env: TELEGRAM_BOT_TOKEN/CHAT_ID.
import { supaConfigured } from './lib/supa.mjs';

const SUPA = () => process.env.SUPABASE_URL;
const KEY = () => process.env.SUPABASE_SERVICE_ROLE_KEY;

// Cuenta filas SIN traerlas: usa Prefer: count=exact y lee la cabecera Content-Range (…/<total>).
async function cnt(pathAndFilter) {
  try {
    const r = await fetch(`${SUPA()}/rest/v1/${pathAndFilter}&select=id&limit=1`, {
      headers: { apikey: KEY(), authorization: `Bearer ${KEY()}`, prefer: 'count=exact' },
    });
    const cr = r.headers.get('content-range') || '*/0';
    const total = Number(cr.split('/')[1] || 0);
    return Number.isFinite(total) ? total : 0;
  } catch { return 0; }
}
// Trae filas (para tallies como top páginas / fuentes). Cap de 1000 (suficiente para 1 día).
async function rows(pathAndFilter) {
  try {
    const r = await fetch(`${SUPA()}/rest/v1/${pathAndFilter}&limit=1000`, {
      headers: { apikey: KEY(), authorization: `Bearer ${KEY()}` },
    });
    return (await r.json().catch(() => [])) || [];
  } catch { return []; }
}
async function sumCents(pathAndFilter, campo) {
  const rs = await rows(`${pathAndFilter}&select=${campo}`);
  return rs.reduce((a, x) => a + (Number(x[campo]) || 0), 0);
}

// Inicio del día en Madrid, como timestamptz ISO con offset real (DST-safe).
function inicioDiaMadrid() {
  const now = new Date();
  const fecha = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const utc = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
  const mad = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Madrid' }));
  const offH = Math.round((mad - utc) / 3600000);
  const off = (offH >= 0 ? '+' : '-') + String(Math.abs(offH)).padStart(2, '0') + ':00';
  return { fecha, iso: `${fecha}T00:00:00${off}` };
}

async function enviarTelegram(texto) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return { ok: false, why: 'unconfigured' };
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text: texto, parse_mode: 'HTML', disable_web_page_preview: true }),
  }).catch(() => null);
  return { ok: !!(r && r.ok) };
}

const NOMBRES = {
  '/': 'Inicio', '/participacion': 'Participación', '/propuestas': 'Propuestas',
  '/actualidad': 'Actualidad', '/agenda': 'Agenda', '/campanas': 'Campañas',
  '/transparencia': 'Transparencia', '/conocenos': 'Conócenos', '/equipo': 'Equipo',
  '/programa-electoral': 'Programa', '/tienda': 'Tienda', '/contacto': 'Contacto',
  '/crear-propuesta': 'Crear propuesta', '/cuenta': 'Mi cuenta',
};
const bonito = (p) => NOMBRES[p] || (p || '/').replace(/^\//, '').replace(/-/g, ' ').slice(0, 24) || 'Inicio';

async function construir() {
  const { fecha, iso } = inicioDiaMadrid();
  const desde = `created_at=gte.${encodeURIComponent(iso)}`;

  const [visitas, propuestas, comentarios, votos, denuncias, chat, contacto, inscripciones, donCents, pvRows] = await Promise.all([
    cnt(`analytics_events?tipo=eq.pageview&${desde}`),
    cnt(`proposals?${desde}`),
    cnt(`comments?${desde}`),
    cnt(`votes?${desde}`),
    cnt(`denuncias?${desde}`),
    cnt(`messages?${desde}`),
    cnt(`contact_messages?${desde}`),
    cnt(`event_inscripciones?${desde}`),
    sumCents(`donations?estado=eq.pagada&${desde}`, 'importe_cents'),
    rows(`analytics_events?tipo=eq.pageview&${desde}&select=path,sid,red`),
  ]);

  const visitantes = new Set(pvRows.map((r) => r.sid).filter(Boolean)).size;
  const paginas = {}; const fuentes = {};
  for (const r of pvRows) {
    const p = r.path || '/'; paginas[p] = (paginas[p] || 0) + 1;
    if (r.red) fuentes[r.red] = (fuentes[r.red] || 0) + 1;
  }
  const topPag = Object.entries(paginas).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const topRed = Object.entries(fuentes).sort((a, b) => b[1] - a[1]).slice(0, 4);

  const L = [];
  L.push(`📊 <b>Resumen de hoy — ${fecha}</b>`);
  L.push('');
  L.push(`👁 <b>${visitas}</b> visitas · <b>${visitantes}</b> visitantes`);
  L.push(`✍️ ${propuestas} propuestas · 💬 ${comentarios} comentarios · 👍 ${votos} votos`);
  const linea4 = [];
  if (donCents) linea4.push(`💶 ${(donCents / 100).toFixed(0)} € donados`);
  if (inscripciones) linea4.push(`🎟 ${inscripciones} inscripciones`);
  if (chat) linea4.push(`🗨 ${chat} chat`);
  if (denuncias) linea4.push(`🚨 ${denuncias} denuncias`);
  if (contacto) linea4.push(`✉️ ${contacto} contacto`);
  if (linea4.length) L.push(linea4.join(' · '));
  if (topPag.length) {
    L.push('');
    L.push('<b>Páginas más vistas</b>');
    for (const [p, n] of topPag) L.push(`· ${bonito(p)} — ${n}`);
  }
  if (topRed.length) {
    L.push('');
    L.push('<b>De dónde llegan</b>');
    for (const [r, n] of topRed) L.push(`· ${r} — ${n}`);
  }
  if (!visitas && !propuestas && !comentarios) L.push('\n<i>Día tranquilo, sin actividad registrada.</i>');
  L.push('');
  L.push('<a href="https://accioncivilgandia.es/admin">Abrir panel completo →</a>');
  return L.join('\n');
}

export default async (req) => {
  if (!supaConfigured()) return new Response('unconfigured', { status: 200 });
  const texto = await construir();
  const r = await enviarTelegram(texto);
  // GET ?test=1 → responde el propio texto para depurar sin mirar Telegram
  try {
    const isTest = req && req.url && new URL(req.url).searchParams.get('test');
    if (isTest) return new Response(JSON.stringify({ ok: r.ok, preview: texto }), { status: 200, headers: { 'content-type': 'application/json' } });
  } catch {}
  return new Response(JSON.stringify({ ok: r.ok }), { status: 200, headers: { 'content-type': 'application/json' } });
};

// 20:00 UTC ≈ 22:00 Madrid (verano). Resumen de cierre del día.
export const config = { schedule: '0 20 * * *' };
