// Relay de alertas → Telegram. Recibe webhooks de Sentry (errores JS) y de UptimeRobot (caídas)
// y los reenvía formateados al chat del equipo. Un solo bot para todo.
// Env: TELEGRAM_BOT_TOKEN (de @BotFather), TELEGRAM_CHAT_ID (chat destino).
// Opcional: TELEGRAM_WEBHOOK_SECRET → exige ?s=<secret> en la URL (evita que un tercero dispare avisos).

async function enviar(texto) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return { ok: false, why: 'unconfigured' };
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text: texto, parse_mode: 'HTML', disable_web_page_preview: false }),
  }).catch(() => null);
  return { ok: !!(r && r.ok) };
}

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Da forma al mensaje según el origen del webhook.
function formatear(body, source) {
  // UptimeRobot: envía monitorFriendlyName, monitorURL, alertType (1=down, 2=up), alertDetails
  if (source === 'uptimerobot' || body.monitorFriendlyName || body.alertType) {
    const up = String(body.alertType) === '2';
    const nombre = esc(body.monitorFriendlyName || 'La web');
    const url = esc(body.monitorURL || 'accioncivilgandia.netlify.app');
    const det = esc(body.alertDetails || '');
    return up
      ? `✅ <b>${nombre} vuelve a estar operativa</b>\n${url}${det ? '\n' + det : ''}`
      : `🔴 <b>${nombre} está CAÍDA</b>\n${url}${det ? '\n' + det : ''}`;
  }
  // Sentry: el webhook de alertas trae data.event (o event) con title/web_url/culprit.
  const ev = (body.data && (body.data.event || body.data.issue)) || body.event || null;
  if (ev || body.culprit || body.message) {
    const titulo = esc((ev && (ev.title || ev.message)) || body.message || 'Error en la web');
    const url = esc((ev && (ev.web_url || ev.url)) || (body.data && body.data.web_url) || 'https://white-lab.sentry.io/issues/');
    const donde = esc((ev && ev.culprit) || body.culprit || '');
    return `🐞 <b>Error JS en la web</b>\n${titulo}${donde ? '\n<code>' + donde + '</code>' : ''}\n${url}`;
  }
  // Desconocido: manda un resumen crudo (recortado).
  return `🔔 <b>Aviso</b>\n<code>${esc(JSON.stringify(body).slice(0, 800))}</code>`;
}

export default async (req) => {
  const url = new URL(req.url);
  // Ping de prueba: GET ?test=1 → manda un mensaje de comprobación.
  if (req.method === 'GET' && url.searchParams.get('test')) {
    const r = await enviar('🔔 <b>Prueba de avisos</b>\nSi ves esto, Telegram está conectado. — Acción Civil Gandia');
    return new Response(JSON.stringify(r), { status: r.ok ? 200 : 503, headers: { 'content-type': 'application/json' } });
  }
  if (req.method !== 'POST') return new Response('Solo POST', { status: 405 });

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret && url.searchParams.get('s') !== secret) return new Response('forbidden', { status: 403 });

  let body = {};
  const ct = req.headers.get('content-type') || '';
  try {
    if (ct.includes('application/json')) body = await req.json();
    else { const t = await req.text(); body = Object.fromEntries(new URLSearchParams(t)); }
  } catch { body = {}; }

  const source = url.searchParams.get('source') || '';
  // Sentry (integración interna) manda action=created/resolved/assigned/ignored… solo avisamos de errores NUEVOS.
  if (body.action && !['created', 'triggered'].includes(body.action)) {
    return new Response(JSON.stringify({ ok: true, skipped: body.action }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  const r = await enviar(formatear(body, source));
  return new Response(JSON.stringify({ ok: r.ok }), { status: 200, headers: { 'content-type': 'application/json' } });
};

export const config = { path: '/api/alerta-telegram' };
