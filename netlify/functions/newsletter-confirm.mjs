// GET /api/newsletter-confirm?t=<token> — confirma el double opt-in y da de alta en Brevo.
// Env: NEWSLETTER_SECRET, BREVO_API_KEY, BREVO_LIST_ID_ES, BREVO_LIST_ID_VA
import { verifyToken } from './newsletter.mjs';

const page = (title, body, ok) => new Response(`<!doctype html><html lang="es"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${title} — Acción Civil Gandia</title>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@800&family=Public+Sans:wght@400;600&display=swap" rel="stylesheet"></head>
<body style="margin:0;font-family:Public Sans,sans-serif;background:#F4F7FB;display:flex;align-items:center;justify-content:center;min-height:100vh">
<div style="background:#fff;border:1px solid #E9EEF4;border-radius:20px;padding:44px 40px;max-width:440px;text-align:center;margin:20px">
<div style="width:56px;height:56px;border-radius:50%;background:${ok ? '#E7F6EE' : '#FDEDEA'};display:flex;align-items:center;justify-content:center;margin:0 auto 18px;font-size:26px">${ok ? '✓' : '✕'}</div>
<h1 style="font-family:Bricolage Grotesque,sans-serif;font-size:26px;color:#0A2A5E;margin:0 0 10px">${title}</h1>
<p style="color:#5C6B7A;font-size:15px;line-height:1.6;margin:0 0 26px">${body}</p>
<a href="/" style="background:#1563C4;color:#fff;padding:12px 24px;border-radius:11px;text-decoration:none;font-weight:600;font-size:14.5px">Volver a la web</a>
</div></body></html>`, { status: ok ? 200 : 400, headers: { 'content-type': 'text/html; charset=utf-8' } });

export default async (req) => {
  const secret = process.env.NEWSLETTER_SECRET;
  const t = new URL(req.url).searchParams.get('t');
  const p = secret ? verifyToken(t, secret) : null;
  if (!p) return page('Enlace no válido', 'El enlace ha caducado o no es correcto. Vuelve a suscribirte desde el pie de cualquier página.', false);

  const key = process.env.BREVO_API_KEY;
  if (!key) return page('Casi listo', 'Tu confirmación es válida pero el alta automática aún no está configurada. Escríbenos a info@accioncivilgandia.org.', false);

  const listId = Number(p.lang === 'va' ? process.env.BREVO_LIST_ID_VA : process.env.BREVO_LIST_ID_ES) || undefined;
  const r = await fetch('https://api.brevo.com/v3/contacts', {
    method: 'POST',
    headers: { 'api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify({
      email: p.email, updateEnabled: true,
      attributes: { LANG: p.lang, CONSENT_TS: new Date().toISOString(), CONSENT_SOURCE: 'web-double-optin' },
      ...(listId ? { listIds: [listId] } : {}),
    }),
  });
  if (!r.ok && r.status !== 204) {
    console.error('brevo fail', r.status, await r.text());
    return page('Algo ha fallado', 'No hemos podido completar el alta. Inténtalo más tarde o escríbenos a info@accioncivilgandia.org.', false);
  }
  const es = p.lang !== 'va';
  return page(es ? '¡Suscripción confirmada!' : 'Subscripció confirmada!',
    es ? 'Recibirás propuestas, campañas y actos de Acción Civil Gandia en tu correo. Puedes darte de baja en cualquier momento desde el propio boletín.'
       : 'Rebràs propostes, campanyes i actes d’Acció Civil Gandia al teu correu. Pots donar-te de baixa en qualsevol moment des del propi butlletí.', true);
};

export const config = { path: '/api/newsletter-confirm' };
