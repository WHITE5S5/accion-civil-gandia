// POST /api/contacto — formulario de contacto → email al partido vía Resend + bandeja del panel.
// Env: RESEND_API_KEY (obligatoria), CONTACT_INBOX, EMAIL_FROM, TURNSTILE_SECRET_KEY (opcional)
import { supa } from './lib/supa.mjs';

const hits = new Map(); // rate limit best-effort por instancia

const err = (status, code, message) =>
  new Response(JSON.stringify({ error: { code, message } }), {
    status, headers: { 'content-type': 'application/json' },
  });

export async function verifyTurnstile(token, ip) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true; // sin clave configurada no se exige (endurecer al configurar)
  if (!token) return false;
  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ secret, response: token, remoteip: ip }),
  });
  const d = await r.json().catch(() => ({}));
  return !!d.success;
}

export function rateLimited(ip, limit = 10) {
  const now = Date.now();
  const rec = hits.get(ip) || [];
  const recent = rec.filter((t) => now - t < 3600_000);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > limit;
}

export async function sendEmail({ to, subject, html, replyTo }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, unconfigured: true };
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || 'Acción Civil Gandia <onboarding@resend.dev>',
      to: [to], subject, html, ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  });
  return { ok: r.ok, status: r.status, body: await r.text() };
}


// Plantilla comun de emails: cabecera navy con logo + cuerpo + pie. Email-client-safe (estilos inline).
const LOGO_URL = 'https://accioncivilgandia.netlify.app/assets/icon-192.png';
export function emailShell({ title, body, lang = 'es', footerNote = '' }) {
  const es = lang !== 'va';
  return `<!doctype html><html><body style="margin:0;padding:0;background:#F0F4F9">
  <div style="max-width:560px;margin:0 auto;padding:26px 14px">
    <div style="background:#0A2A5E;border-radius:16px 16px 0 0;padding:20px 26px">
      <img src="${LOGO_URL}" width="42" height="42" alt="Acción Civil Gandia" style="vertical-align:middle;border-radius:10px;background:#ffffff">
      <span style="font-family:Arial,Helvetica,sans-serif;font-size:17px;font-weight:bold;color:#ffffff;margin-left:12px;vertical-align:middle">Acci&oacute;n Civil Gandia</span>
    </div>
    <div style="background:#ffffff;padding:28px 26px;border:1px solid #E4EBF2;border-top:none">
      ${title ? `<h2 style="font-family:Arial,Helvetica,sans-serif;color:#0A2A5E;font-size:20px;margin:0 0 14px">${title}</h2>` : ''}
      <div style="font-family:Arial,Helvetica,sans-serif;color:#33414F;font-size:15px;line-height:1.65">${body}</div>
    </div>
    <div style="background:#F7FAFD;border:1px solid #E4EBF2;border-top:none;border-radius:0 0 16px 16px;padding:14px 26px">
      <p style="font-family:Arial,Helvetica,sans-serif;color:#8A99A8;font-size:12px;line-height:1.5;margin:0">
        Acci&oacute;n Civil Gandia &middot; Gandia (Val&egrave;ncia)<br>${footerNote || (es ? 'Formaci\u00f3n pol\u00edtica local, ciudadana e independiente.' : 'Formaci\u00f3 pol\u00edtica local, ciutadana i independent.')}
      </p>
    </div>
  </div></body></html>`;
}
export function emailBtn(href, label) {
  return `<p style="margin:26px 0"><a href="${href}" style="background:#1563C4;color:#ffffff;padding:13px 28px;border-radius:11px;text-decoration:none;font-weight:bold;font-family:Arial,Helvetica,sans-serif;display:inline-block">${label}</a></p>`;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export default async (req, context) => {
  if (req.method !== 'POST') return err(405, 'method_not_allowed', 'Solo POST');
  const ip = context.ip || req.headers.get('x-nf-client-connection-ip') || '0.0.0.0';
  if (rateLimited(ip)) return err(429, 'rate_limited', 'Demasiadas peticiones, prueba en una hora');

  let b;
  try { b = await req.json(); } catch { return err(400, 'bad_json', 'Cuerpo inválido'); }
  if (b.hp) return new Response(JSON.stringify({ ok: true }), { status: 200 }); // honeypot

  const nombre = String(b.nombre || '').trim();
  const apellidos = String(b.apellidos || '').trim();
  const email = String(b.email || '').trim();
  const asunto = String(b.asunto || '').trim().slice(0, 120);
  const mensaje = String(b.mensaje || '').trim();
  if (nombre.length < 2 || nombre.length > 80) return err(400, 'invalid_nombre', 'Nombre entre 2 y 80 caracteres');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return err(400, 'invalid_email', 'Email no válido');
  if (mensaje.length < 10 || mensaje.length > 4000) return err(400, 'invalid_mensaje', 'Mensaje entre 10 y 4000 caracteres');
  if (!(await verifyTurnstile(b.turnstileToken, ip))) return err(403, 'turnstile_failed', 'Verificación anti-spam fallida');

  // Bandeja del panel: se guarda aunque el email falle (best-effort; si la tabla no existe aún, se ignora).
  try { await supa('POST', 'contact_messages', { nombre, apellidos: apellidos || null, email, asunto: asunto || null, mensaje }); } catch { /* noop */ }

  const r = await sendEmail({
    to: process.env.CONTACT_INBOX || 'accioncivilgandia@gmail.com',
    subject: `[Web] Contacto: ${asunto || '(sin asunto)'}`,
    replyTo: email,
    html: emailShell({ title: 'Nuevo mensaje desde la web', body: `
      <p style="margin:0 0 6px"><b>Nombre:</b> ${esc(nombre)} ${esc(apellidos)}</p>
      <p style="margin:0 0 6px"><b>Email:</b> <a href="mailto:${esc(email)}" style="color:#1563C4">${esc(email)}</a></p>
      <p style="margin:0 0 14px"><b>Asunto:</b> ${esc(asunto)}</p>
      <div style="background:#F4F7FB;border:1px solid #E9EEF4;border-radius:10px;padding:14px 16px">${esc(mensaje).replace(/\n/g, '<br>')}</div>
      <p style="color:#8A99A8;font-size:13px;margin:14px 0 0">Puedes responder directamente a este correo.</p>` }),
  });
  if (r.unconfigured) return err(503, 'service_unconfigured', 'Envío no configurado todavía');
  if (!r.ok) { console.error('resend fail', r.status, r.body); return err(502, 'send_failed', 'No se pudo enviar'); }
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
};

export const config = { path: '/api/contacto' };
