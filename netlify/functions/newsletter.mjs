// POST /api/newsletter — alta con double opt-in (RGPD).
// Envía email de confirmación con token HMAC; el alta real ocurre en /api/newsletter-confirm.
// Env: NEWSLETTER_SECRET (obligatoria), RESEND_API_KEY (obligatoria), APP_BASE_URL,
//      TURNSTILE_SECRET_KEY (opcional)
import { createHmac } from 'node:crypto';
import { verifyTurnstile, rateLimited, sendEmail } from './contacto.mjs';

const err = (status, code, message) =>
  new Response(JSON.stringify({ error: { code, message } }), {
    status, headers: { 'content-type': 'application/json' },
  });

export function signToken(payload, secret) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export function verifyToken(token, secret, maxAgeMs = 48 * 3600_000) {
  const [data, sig] = String(token || '').split('.');
  if (!data || !sig) return null;
  const good = createHmac('sha256', secret).update(data).digest('base64url');
  if (sig !== good) return null;
  try {
    const p = JSON.parse(Buffer.from(data, 'base64url').toString());
    if (!p.ts || Date.now() - p.ts > maxAgeMs) return null;
    return p;
  } catch { return null; }
}

export default async (req, context) => {
  if (req.method !== 'POST') return err(405, 'method_not_allowed', 'Solo POST');
  const ip = context.ip || req.headers.get('x-nf-client-connection-ip') || '0.0.0.0';
  if (rateLimited(ip)) return err(429, 'rate_limited', 'Demasiadas peticiones');

  let b;
  try { b = await req.json(); } catch { return err(400, 'bad_json', 'Cuerpo inválido'); }
  if (b.hp) return new Response(JSON.stringify({ ok: true }), { status: 200 });

  const email = String(b.email || '').trim().toLowerCase();
  const lang = b.lang === 'va' ? 'va' : 'es';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return err(400, 'invalid_email', 'Email no válido');
  if (!(await verifyTurnstile(b.turnstileToken, ip))) return err(403, 'turnstile_failed', 'Verificación anti-spam fallida');

  const secret = process.env.NEWSLETTER_SECRET;
  if (!secret) return err(503, 'service_unconfigured', 'Newsletter no configurada todavía');

  const base = process.env.APP_BASE_URL || new URL(req.url).origin;
  const url = `${base}/api/newsletter-confirm?t=${signToken({ email, lang, ts: Date.now() }, secret)}`;
  const es = lang === 'es';
  const r = await sendEmail({
    to: email,
    subject: es ? 'Confirma tu suscripción — Acción Civil Gandia' : 'Confirma la teua subscripció — Acció Civil Gandia',
    html: `<div style="font-family:sans-serif;max-width:520px">
      <h2 style="color:#0A2A5E">${es ? 'Confirma tu suscripción' : 'Confirma la teua subscripció'}</h2>
      <p>${es
        ? 'Has pedido recibir novedades de Acción Civil Gandia. Pulsa el botón para confirmar tu correo. Si no lo has pedido tú, ignora este mensaje.'
        : 'Has demanat rebre novetats d’Acció Civil Gandia. Prem el botó per confirmar el teu correu. Si no ho has demanat tu, ignora aquest missatge.'}</p>
      <p style="margin:28px 0"><a href="${url}" style="background:#1563C4;color:#fff;padding:13px 26px;border-radius:10px;text-decoration:none;font-weight:700">${es ? 'Confirmar suscripción' : 'Confirmar subscripció'}</a></p>
      <p style="color:#5C6B7A;font-size:13px">${es ? 'El enlace caduca en 48 horas.' : 'L’enllaç caduca en 48 hores.'}</p></div>`,
  });
  if (r.unconfigured) return err(503, 'service_unconfigured', 'Envío no configurado todavía');
  if (!r.ok) { console.error('resend fail', r.status, r.body); return err(502, 'send_failed', 'No se pudo enviar'); }
  return new Response(JSON.stringify({ ok: true, doubleOptIn: true }), { status: 200, headers: { 'content-type': 'application/json' } });
};

export const config = { path: '/api/newsletter' };
