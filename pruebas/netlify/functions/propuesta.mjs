// POST /api/propuesta — propuesta ciudadana.
// Fase 2: si Supabase está configurado, persiste en `proposals` con `pendiente_moderacion`.
// Si no lo está, mantiene el fallback por email para no romper el flujo.
// Env: RESEND_API_KEY, CONTACT_INBOX, TURNSTILE_SECRET_KEY (opcional),
//      SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (opcionales para persistencia)
import { verifyTurnstile, rateLimited, sendEmail } from './contacto.mjs';
import { supa, supaConfigured } from './lib/supa.mjs';

const err = (status, code, message) =>
  new Response(JSON.stringify({ error: { code, message } }), {
    status, headers: { 'content-type': 'application/json' },
  });

const CATEGORIAS = ['Urbanismo y vivienda','Movilidad y transporte','Medio ambiente','Cultura y fiestas','Educación','Sanidad','Servicios sociales','Seguridad ciudadana','Economía local','Deportes','Turismo','Servicios básicos','Otro'];
const BARRIOS = ['Toda la ciudad','Centro','Playa-Grao','Beniopa','Benipeixcar','Santa Anna','Corea','Marchuquera','Otro barrio'];
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const inList = (v, list) => list.some((x) => norm(x) === norm(v));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const BARRIO_SLUG = {
  centro: 'centro',
  'toda la ciudad': 'centro',
  'playa-grao': 'grao',
  beniopa: 'beniopa',
  benipeixcar: 'benipeixcar',
  'santa anna': 'centro',
  corea: 'corea',
  marchuquera: 'centro',
  'otro barrio': '',
};

export default async (req, context) => {
  if (req.method !== 'POST') return err(405, 'method_not_allowed', 'Solo POST');
  const ip = context.ip || req.headers.get('x-nf-client-connection-ip') || '0.0.0.0';
  if (rateLimited(ip, 5)) return err(429, 'rate_limited', 'Demasiadas propuestas seguidas');

  let b;
  try { b = await req.json(); } catch { return err(400, 'bad_json', 'Cuerpo inválido'); }
  if (b.hp) return new Response(JSON.stringify({ ok: true }), { status: 200 });

  const titulo = String(b.titulo || '').trim();
  const descripcion = String(b.descripcion || '').trim();
  const categoria = String(b.categoria || '').trim();
  const barrio = String(b.barrio || '').trim();
  const nombre = String(b.nombre || '').trim();
  const email = String(b.email || '').trim();
  const anonimo = !!b.anonimo;

  if (titulo.length < 5 || titulo.length > 140) return err(400, 'invalid_titulo', 'Título entre 5 y 140 caracteres');
  if (descripcion.length < 30 || descripcion.length > 5000) return err(400, 'invalid_descripcion', 'Descripción entre 30 y 5000 caracteres');
  if (!inList(categoria, CATEGORIAS)) return err(400, 'invalid_categoria', 'Categoría no válida');
  if (!inList(barrio, BARRIOS)) return err(400, 'invalid_barrio', 'Barrio no válido');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return err(400, 'invalid_email', 'Email no válido (necesario para responderte)');
  if (!anonimo && (nombre.length < 2 || nombre.length > 80)) return err(400, 'invalid_nombre', 'Nombre entre 2 y 80 caracteres (o marca "anónima")');
  if (!(await verifyTurnstile(b.turnstileToken, ip))) return err(403, 'turnstile_failed', 'Verificación anti-spam fallida');

  let stored = false;
  let proposalId = null;
  if (supaConfigured()) {
    let barrioId = null;
    const slug = BARRIO_SLUG[norm(barrio)] || '';
    if (slug) {
      const barrioLookup = await supa('GET', `barrios?select=id&slug=eq.${encodeURIComponent(slug)}&limit=1`);
      if (barrioLookup.ok && Array.isArray(barrioLookup.json) && barrioLookup.json[0]) barrioId = barrioLookup.json[0].id;
    }
    const insert = await supa('POST', 'proposals', {
      contacto_nombre: anonimo ? null : nombre,
      contacto_email: email,
      titulo,
      descripcion,
      categoria,
      barrio_id: barrioId,
      estado: 'pendiente_moderacion',
    });
    if (!insert.ok || !Array.isArray(insert.json) || !insert.json[0]?.id) {
      console.error('supabase proposals insert fail', insert.status, insert.text);
      return err(502, 'supabase_insert_failed', 'No se pudo guardar la propuesta');
    }
    stored = true;
    proposalId = insert.json[0].id;
  }

  const r = await sendEmail({
    to: process.env.CONTACT_INBOX || 'info@accioncivilgandia.org',
    subject: `[Web] Nueva propuesta ciudadana: ${titulo.slice(0, 80)}`,
    replyTo: email,
    html: `<h2>Nueva propuesta ciudadana (pendiente de moderación)</h2>
      <p><b>Título:</b> ${esc(titulo)}</p>
      <p><b>Categoría:</b> ${esc(categoria)} · <b>Barrio:</b> ${esc(barrio)}</p>
      <p><b>Autor/a:</b> ${anonimo ? '(pública como anónima)' : esc(nombre)} — ${esc(email)}</p>
      <p><b>Descripción:</b></p><p>${esc(descripcion).replace(/\n/g, '<br>')}</p>
      <p><b>Persistida en Supabase:</b> ${stored ? 'sí' : 'no'}</p>
      ${proposalId ? `<p><b>ID:</b> ${esc(proposalId)}</p>` : ''}
      <hr><p style="color:#888;font-size:12px">Fase 2: la propuesta queda almacenada en cola de moderación si Supabase ya está activo.</p>`,
  });
  if (!stored && r.unconfigured) return err(503, 'service_unconfigured', 'Envío no configurado todavía');
  if (!r.unconfigured && !r.ok) { console.error('resend fail', r.status, r.body); return err(502, 'send_failed', 'No se pudo enviar'); }
  return new Response(JSON.stringify({ ok: true, stored, notified: !r.unconfigured, proposalId }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

export const config = { path: '/api/propuesta' };
