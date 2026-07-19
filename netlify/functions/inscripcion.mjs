// Inscripciones a actos de la agenda.
// POST /api/inscripcion {eventSlug, nombre?, email?} — con sesión usa el email de la cuenta.
//   → guarda la inscripción (dedupe por evento+email) y envía email de confirmación.
// GET  /api/inscripcion?slug= — nº de inscritos + si el evento admite inscripción (+ miInscripcion con sesión).
import { getUser } from './lib/auth.mjs';
import { supa, supaConfigured, jsonErr, jsonOk } from './lib/supa.mjs';
import { rateLimited, sendEmail } from './contacto.mjs';

const SLUG_RE = /^[a-z0-9-]{2,80}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const fmtFecha = (iso, va) => new Date(iso + 'T12:00:00').toLocaleDateString(va ? 'ca-ES' : 'es-ES', { weekday: 'long', day: 'numeric', month: 'long' });

export default async (req, context) => {
  if (!supaConfigured()) return jsonErr(503, 'unconfigured', 'No disponible todavía');
  const url = new URL(req.url);

  if (req.method === 'GET') {
    const slug = String(url.searchParams.get('slug') || '');
    if (!SLUG_RE.test(slug)) return jsonErr(400, 'bad_slug', 'Evento no válido');
    const [ev, insc] = await Promise.all([
      supa('GET', `events?slug=eq.${slug}&select=inscribible,fecha&limit=1`),
      supa('GET', `event_inscripciones?event_slug=eq.${slug}&select=email`),
    ]);
    const e = ev.json?.[0];
    if (!e) return jsonErr(404, 'not_found', 'Evento no encontrado');
    const user = await getUser(req);
    const emails = (insc.json || []).map((x) => x.email);
    return jsonOk({
      ok: true, inscribible: !!e.inscribible, inscritos: emails.length,
      miInscripcion: !!(user && emails.includes(String(user.email).toLowerCase())),
    });
  }

  if (req.method !== 'POST') return jsonErr(405, 'method_not_allowed', 'Método no permitido');
  const ip = req.headers.get('cf-connecting-ip') || context.ip || req.headers.get('x-nf-client-connection-ip') || '0.0.0.0';
  if (rateLimited('insc:' + ip, 10)) return jsonErr(429, 'rate_limited', 'Demasiadas peticiones');

  let b; try { b = await req.json(); } catch { return jsonErr(400, 'bad_json', 'Cuerpo inválido'); }
  const slug = String(b.eventSlug || b.slug || '');
  const va = b.lang === 'va';
  if (!SLUG_RE.test(slug)) return jsonErr(400, 'bad_slug', 'Evento no válido');

  const ev = await supa('GET', `events?slug=eq.${slug}&select=titulo_es,titulo_va,fecha,hora_inicio,lugar,inscribible&limit=1`);
  const e = ev.json?.[0];
  if (!e) return jsonErr(404, 'not_found', 'Evento no encontrado');
  if (!e.inscribible) return jsonErr(403, 'no_inscribible', va ? 'Este acte no requerix inscripció' : 'Este acto no requiere inscripción');

  const user = await getUser(req);
  const email = String((user && user.email) || b.email || '').trim().toLowerCase();
  const nombre = String(b.nombre || (user && user.user_metadata && user.user_metadata.nombre) || '').trim().slice(0, 80);
  if (!EMAIL_RE.test(email)) return jsonErr(400, 'invalid_email', 'Escribe un correo válido');

  const ins = await supa('POST', 'event_inscripciones?on_conflict=event_slug,email',
    { event_slug: slug, nombre: nombre || null, email, user_id: user ? user.id : null },
    { prefer: 'resolution=merge-duplicates,return=minimal' });
  if (!ins.ok) { console.error('insc fail', ins.status, ins.text); return jsonErr(502, 'db_error', 'No se pudo registrar'); }

  const titulo = va ? (e.titulo_va || e.titulo_es) : e.titulo_es;
  const cuando = fmtFecha(e.fecha, va) + (e.hora_inicio ? ' · ' + String(e.hora_inicio).slice(0, 5) : '');
  sendEmail({
    to: email,
    subject: va ? `Inscripció confirmada: ${titulo}` : `Inscripción confirmada: ${titulo}`,
    html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto">
      <div style="background:#0A2A5E;color:#fff;padding:18px 22px;border-radius:12px 12px 0 0"><b>Acción Civil Gandia</b></div>
      <div style="border:1px solid #E4EBF2;border-top:none;border-radius:0 0 12px 12px;padding:22px">
        <h2 style="color:#0A2A5E;margin:0 0 10px">${va ? 'Estàs apuntat/da ✓' : 'Estás apuntado/a ✓'}</h2>
        <p style="color:#33414F;line-height:1.6;margin:0 0 14px"><b>${titulo}</b><br>${cuando}${e.lugar ? '<br>📍 ' + e.lugar : ''}</p>
        <p style="color:#5C6B7A;font-size:13px;line-height:1.5">${va
          ? 'T’enviarem un recordatori el dia abans. Si no pots vindre, simplement ignora este correu.'
          : 'Te enviaremos un recordatorio el día antes. Si no puedes venir, simplemente ignora este correo.'}</p>
      </div></div>`,
  }).catch(() => {});

  const n = await supa('GET', `event_inscripciones?event_slug=eq.${slug}&select=id`);
  return jsonOk({ ok: true, inscrito: true, inscritos: (n.json || []).length });
};

export const config = { path: '/api/inscripcion' };
