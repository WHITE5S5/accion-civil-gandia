// POST /api/contacto — formulario de contacto → email al partido vía Resend.
// Env: RESEND_API_KEY (obligatoria), CONTACT_INBOX, EMAIL_FROM, TURNSTILE_SECRET_KEY (opcional)

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

  const r = await sendEmail({
    to: process.env.CONTACT_INBOX || 'info@accioncivilgandia.org',
    subject: `[Web] Contacto: ${asunto || '(sin asunto)'}`,
    replyTo: email,
    html: `<h2>Mensaje desde la web</h2>
      <p><b>Nombre:</b> ${esc(nombre)} ${esc(apellidos)}</p>
      <p><b>Email:</b> ${esc(email)}</p>
      <p><b>Asunto:</b> ${esc(asunto)}</p>
      <p><b>Mensaje:</b></p><p>${esc(mensaje).replace(/\n/g, '<br>')}</p>`,
  });
  if (r.unconfigured) return err(503, 'service_unconfigured', 'Envío no configurado todavía');
  if (!r.ok) { console.error('resend fail', r.status, r.body); return err(502, 'send_failed', 'No se pudo enviar'); }
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
};

export const config = { path: '/api/contacto' };
