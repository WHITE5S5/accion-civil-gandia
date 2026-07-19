// POST /api/propuesta — propuesta ciudadana.
// Fase 2: si Supabase está configurado, persiste en `proposals` con `pendiente_moderacion`.
// Si no lo está, mantiene el fallback por email para no romper el flujo.
// Env: RESEND_API_KEY, CONTACT_INBOX, TURNSTILE_SECRET_KEY (opcional),
//      SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (opcionales para persistencia)
import { verifyTurnstile, rateLimited, sendEmail, emailShell } from './contacto.mjs';
import { supa, supaConfigured } from './lib/supa.mjs';
import { getUser } from './lib/auth.mjs';

const err = (status, code, message) =>
  new Response(JSON.stringify({ error: { code, message } }), {
    status, headers: { 'content-type': 'application/json' },
  });

const CATEGORIAS = ['Urbanismo y vivienda','Movilidad y transporte','Medio ambiente','Cultura y fiestas','Educación','Sanidad','Servicios sociales','Seguridad ciudadana','Economía local','Deportes','Turismo','Servicios básicos','Otro'];
// Barrios/distritos reales de Gandia (Juntas de Distrito + barrios populares) + nombres antiguos por compatibilidad.
const BARRIOS = [
  'Toda la ciudad','Centro Histórico','El Raval – El Prado','Germanies – Els Jardinets',
  'Pl. El·líptica – Rep. Argentina','Corea','Santa Anna','Beniopa – Sant Pere','Benipeixcar',
  'Grau – Venècia – Rafalcaid','Playa de Gandia','Marxuquera','Otro barrio',
  'Centro','Playa-Grao','Beniopa','Marchuquera',
];
// norm: sin acentos, minúsculas y SOLO letras/números/espacios/punto/guión (fuera emojis, guiones largos, punto volado…)
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^\p{L}\p{N} .-]/gu, ' ').replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ').trim();
const inList = (v, list) => list.some((x) => norm(x) === norm(v));
// El formulario bilingüe envía los literales en valenciano: se canonicalizan al ES del listado.
const VA_ES = {
  'urbanisme i habitatge': 'Urbanismo y vivienda', 'mobilitat i transport': 'Movilidad y transporte',
  'medi ambient': 'Medio ambiente', 'cultura i festes': 'Cultura y fiestas', 'educacio': 'Educación',
  'sanitat': 'Sanidad', 'serveis socials': 'Servicios sociales', 'seguretat ciutadana': 'Seguridad ciudadana',
  'economia local': 'Economía local', 'esports': 'Deportes', 'turisme': 'Turismo',
  'serveis basics': 'Servicios básicos', 'altre': 'Otro',
  'tota la ciutat': 'Toda la ciudad', 'centre': 'Centro', 'platja-grau': 'Playa-Grao',
  'centre historic': 'Centro Histórico', 'platja de gandia': 'Playa de Gandia',
  'altre barri': 'Otro barrio',
};
const canon = (v, list) => {
  const n = norm(v);
  if (VA_ES[n]) return VA_ES[n];
  return list.find((x) => norm(x) === n) || null;
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const BARRIO_SLUG = {
  centro: 'centro',
  'toda la ciudad': '',
  'playa-grao': 'grao',
  beniopa: 'beniopa',
  benipeixcar: 'benipeixcar',
  'santa anna': 'santa-anna',
  corea: 'corea',
  marchuquera: 'marchuquera',
  'otro barrio': '',
  // distritos nuevos (claves ya normalizadas con norm(); el guión largo se convierte en espacio)
  'centro historico': 'centro',
  'el raval el prado': 'raval',
  'germanies els jardinets': 'germanies',
  'pl. el liptica rep. argentina': 'republica-argentina',
  'beniopa sant pere': 'beniopa',
  'grau venecia rafalcaid': 'grao',
  'playa de gandia': 'playa',
  'marxuquera': 'marchuquera',
};

export default async (req, context) => {
  if (req.method !== 'POST') return err(405, 'method_not_allowed', 'Solo POST');
  const ip = req.headers.get('cf-connecting-ip') || context.ip || req.headers.get('x-nf-client-connection-ip') || '0.0.0.0';
  if (rateLimited(ip, 5)) return err(429, 'rate_limited', 'Demasiadas propuestas seguidas');

  let b;
  try { b = await req.json(); } catch { return err(400, 'bad_json', 'Cuerpo inválido'); }
  if (b.hp) return new Response(JSON.stringify({ ok: true }), { status: 200 });

  const titulo = String(b.titulo || '').trim();
  const descripcion = String(b.descripcion || '').trim();
  const categoria = canon(String(b.categoria || '').trim(), CATEGORIAS);
  const barrio = canon(String(b.barrio || '').trim(), BARRIOS);
  const nombre = String(b.nombre || '').trim();
  const email = String(b.email || '').trim();
  const anonimo = !!b.anonimo;

  if (titulo.length < 5 || titulo.length > 140) return err(400, 'invalid_titulo', 'Título entre 5 y 140 caracteres');
  if (descripcion.length < 30 || descripcion.length > 5000) return err(400, 'invalid_descripcion', 'Descripción entre 30 y 5000 caracteres');
  if (!categoria) return err(400, 'invalid_categoria', 'Elige una categoría de la lista');
  if (!barrio) return err(400, 'invalid_barrio', 'Elige un barrio de la lista');
  const user = await getUser(req);      // Fase 3: proponer exige cuenta (coherencia con votar/comentar)
  if (!user) return err(401, 'login_required', 'Debes iniciar sesión para crear una propuesta');
  let perfilNombre = '';
  if (supaConfigured()) {               // cuenta bloqueada: no puede proponer + nombre público de la cuenta
    const pb = await supa('GET', `profiles?id=eq.${user.id}&select=bloqueado,nombre`);
    if (pb.json && pb.json[0]) {
      if (pb.json[0].bloqueado) return err(403, 'blocked', 'Tu cuenta ha sido bloqueada; no puedes crear propuestas hasta nuevo aviso.');
      perfilNombre = String(pb.json[0].nombre || '').trim();
    }
  }
  if (!(await verifyTurnstile(b.turnstileToken, ip))) return err(403, 'turnstile_failed', 'Verificación anti-spam fallida');

  let stored = false;
  let proposalId = null;
  // Fotos adjuntas (máx. 3, dataURL comprimidas por el navegador) → bucket media
  const imagenes = [];
  if (supaConfigured() && Array.isArray(b.imagenes)) {
    const lote = b.imagenes.slice(0, 3);
    for (let i = 0; i < lote.length; i++) {
      const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(lote[i] || ''));
      if (!m || m[2].length > 2_400_000) continue;         // ~1,8 MB máx por foto
      const nombreF = `propuestas/p-${Date.now()}-${i}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
      const up = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/media/${nombreF}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': `image/${m[1]}` },
        body: Buffer.from(m[2], 'base64'),
      }).catch(() => null);
      if (up && up.ok) imagenes.push(`${process.env.SUPABASE_URL}/storage/v1/object/public/media/${nombreF}`);
    }
  }

  if (supaConfigured()) {
    let barrioId = null;
    const slug = BARRIO_SLUG[norm(barrio)] || '';
    if (slug) {
      const barrioLookup = await supa('GET', `barrios?select=id&slug=eq.${encodeURIComponent(slug)}&limit=1`);
      if (barrioLookup.ok && Array.isArray(barrioLookup.json) && barrioLookup.json[0]) barrioId = barrioLookup.json[0].id;
    }
    const _lat = Number(b.lat), _lng = Number(b.lng);
    const _coordOk = Number.isFinite(_lat) && _lat >= 38 && _lat <= 40 && Number.isFinite(_lng) && _lng >= -1.5 && _lng <= 0.5;
    const insert = await supa('POST', 'proposals', {
      user_id: user.id,
      titulo,
      descripcion,
      categoria,
      barrio_id: barrioId,
      estado: 'pendiente_moderacion',
      imagenes,
      lat: _coordOk ? _lat : null,
      lng: _coordOk ? _lng : null,
      contacto_nombre: anonimo ? null : ((perfilNombre || nombre || '').slice(0, 80) || null),   // nombre de la cuenta (salvo anónimo)
      contacto_email: (user.email || email || '').slice(0, 120) || null,   // correo de la cuenta (ya no se pide en el form)
    });
    if (!insert.ok || !Array.isArray(insert.json) || !insert.json[0]?.id) {
      console.error('supabase proposals insert fail', insert.status, insert.text);
      return err(502, 'supabase_insert_failed', 'No se pudo guardar la propuesta');
    }
    stored = true;
    proposalId = insert.json[0].id;
  }

  // Opt-in al boletín desde la casilla discreta del formulario (RGPD: solo si el usuario la marcó; usa el email de la cuenta).
  if (b.newsletter && user && user.email) {
    const em = String(user.email).toLowerCase();
    const ya = await supa('GET', `consents?email=eq.${encodeURIComponent(em)}&tipo=eq.marketing&select=id&limit=1`);
    if (!(ya.json && ya.json.length)) await supa('POST', 'consents', { email: em, tipo: 'marketing', texto_version: 'marketing-propuesta-v2026-07', ip }).catch(() => {});
  }

  const r = await sendEmail({
    to: process.env.CONTACT_INBOX || 'accioncivilgandia@gmail.com',
    subject: `[Web] Nueva propuesta ciudadana: ${titulo.slice(0, 80)}`,
    replyTo: user.email,
    html: emailShell({ title: 'Nueva propuesta ciudadana (pendiente de moderación)', body: `
      <p><b>Título:</b> ${esc(titulo)}</p>
      <p><b>Categoría:</b> ${esc(categoria)} · <b>Barrio:</b> ${esc(barrio)}</p>
      <p><b>Autor/a:</b> ${esc(user.email)} (cuenta verificada)</p>
      <p><b>Descripción:</b></p><p>${esc(descripcion).replace(/\n/g, '<br>')}</p>
      <p><b>Persistida en Supabase:</b> ${stored ? 'sí' : 'no'}</p>
      ${proposalId ? `<p><b>ID:</b> ${esc(proposalId)}</p>` : ''}
      <hr><p style="color:#888;font-size:12px">Fase 2: la propuesta queda almacenada en cola de moderación si Supabase ya está activo.</p>` }),
  });
  if (!stored && r.unconfigured) return err(503, 'service_unconfigured', 'Envío no configurado todavía');
  if (!r.unconfigured && !r.ok) { console.error('resend fail', r.status, r.body); return err(502, 'send_failed', 'No se pudo enviar'); }
  return new Response(JSON.stringify({ ok: true, stored, notified: !r.unconfigured, proposalId }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

export const config = { path: '/api/propuesta' };
