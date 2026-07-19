// Panel de administración — GET /admin (app) + POST /api/admin (acciones JSON).
// Acceso por contraseña (env ADMIN_PASSWORD) con token HMAC de 12 h.
// Todas las escrituras van con service_role y quedan en audit_log.
// v1: contraseña compartida (sin atribución individual — llegará con Fase 3).
// Env: ADMIN_PASSWORD, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { createHmac, timingSafeEqual } from 'node:crypto';
import { rateLimited, sendEmail, emailShell, emailBtn } from './contacto.mjs';
import { supa, supaConfigured, jsonErr, jsonOk } from './lib/supa.mjs';

// Cuenta oficial de sistema "Acción Civil" (profile creado vía scripts/ensure_system_account.mjs)
// con la que el equipo publica en el chat de la comunidad desde este panel.
const SYSTEM_CHAT_ID = '4d785f4a-e5c8-4a21-b47d-c7c43ef53f76';

// ---------- auth ----------
const sign = (exp, key) => createHmac('sha256', key).update(String(exp)).digest('base64url');
function makeToken(key) { const exp = Date.now() + 12 * 3600_000; return `${exp}.${sign(exp, key)}`; }
function checkToken(token, key) {
  const [exp, sig] = String(token || '').split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const good = Buffer.from(sign(exp, key)), got = Buffer.from(sig);
  return good.length === got.length && timingSafeEqual(good, got);
}
function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

// ---------- 2FA (TOTP, RFC 6238) ----------
function base32Decode(s) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, val = 0; const out = [];
  for (const ch of String(s).toUpperCase().replace(/=+$/, '').replace(/\s/g, '')) {
    const i = A.indexOf(ch); if (i < 0) continue;
    val = (val << 5) | i; bits += 5;
    if (bits >= 8) { bits -= 8; out.push((val >>> bits) & 0xff); }
  }
  return Buffer.from(out);
}
function totpAt(secretBuf, counter) {
  const msg = Buffer.alloc(8);
  msg.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  msg.writeUInt32BE(counter >>> 0, 4);
  const h = createHmac('sha1', secretBuf).update(msg).digest();
  const off = h[h.length - 1] & 0xf;
  const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(bin % 1000000).padStart(6, '0');
}
// Verifica un código de 6 dígitos con ventana ±1 (tolerancia de reloj de 30 s).
function verifyTotp(secret, code) {
  const c = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return false;
  const buf = base32Decode(secret); if (!buf.length) return false;
  const step = Math.floor(Date.now() / 1000 / 30);
  for (let w = -1; w <= 1; w++) { if (safeEqual(totpAt(buf, step + w), c)) return true; }
  return false;
}
export { base32Decode, totpAt, verifyTotp };

// ---------- tablas permitidas ----------
const slugify = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'sin-titulo';

const TABLAS = {
  posts: {
    select: 'id,slug,tipo,titulo_es,titulo_va,extracto_es,extracto_va,cuerpo_es,cuerpo_va,imagen,imagen_vertical,video_url,estado,publicado_at,created_at',
    campos: ['slug', 'tipo', 'titulo_es', 'titulo_va', 'extracto_es', 'extracto_va', 'cuerpo_es', 'cuerpo_va', 'imagen', 'imagen_vertical', 'video_url', 'estado', 'publicado_at'],
    orden: 'created_at.desc', borrable: true, slugDe: 'titulo_es',
  },
  events: {
    select: 'id,slug,titulo_es,titulo_va,descripcion_es,descripcion_va,fecha,hora_inicio,hora_fin,lugar,direccion,barrio_id,estado,inscribible,created_at',
    campos: ['slug', 'titulo_es', 'titulo_va', 'descripcion_es', 'descripcion_va', 'fecha', 'hora_inicio', 'hora_fin', 'lugar', 'direccion', 'barrio_id', 'estado', 'inscribible'],
    orden: 'fecha.desc', borrable: true, slugDe: 'titulo_es',
  },
  campaigns: {
    select: 'id,slug,titulo_es,titulo_va,descripcion_es,descripcion_va,imagen,destacada,progreso,estado,objetivos,cronologia,docs,created_at',
    campos: ['slug', 'titulo_es', 'titulo_va', 'descripcion_es', 'descripcion_va', 'imagen', 'destacada', 'progreso', 'estado', 'objetivos', 'cronologia', 'docs'],
    orden: 'created_at.desc', borrable: true, slugDe: 'titulo_es',
  },
  actuaciones: {
    select: 'id,slug,titulo_es,titulo_va,descripcion_es,descripcion_va,barrio_id,estado,lat,lng,cronologia,created_at',
    campos: ['slug', 'titulo_es', 'titulo_va', 'descripcion_es', 'descripcion_va', 'barrio_id', 'estado', 'lat', 'lng', 'cronologia'],
    orden: 'created_at.desc', borrable: true, slugDe: 'titulo_es',
  },
  equipo: {
    select: 'id,slug,nombre,cargo_es,cargo_va,bio_es,bio_va,foto,orden,activo',
    campos: ['slug', 'nombre', 'cargo_es', 'cargo_va', 'bio_es', 'bio_va', 'foto', 'orden', 'activo'],
    orden: 'orden.asc', borrable: true, slugDe: 'nombre',
  },
  voluntarios: {
    select: 'id,nombre,barrio_id,foto,tipo,user_id,orden,activo,created_at',
    campos: ['nombre', 'barrio_id', 'foto', 'tipo', 'orden', 'activo'],
    orden: 'orden.asc,created_at.asc', borrable: true,
  },
  tesoreria: {
    select: 'id,fecha,tipo,categoria,concepto,importe_cents,ejercicio,created_at',
    campos: ['fecha', 'tipo', 'categoria', 'concepto', 'importe_cents'],
    orden: 'fecha.desc,created_at.desc', borrable: true,
  },
  proposals: {
    select: 'id,titulo,descripcion,categoria,estado,motivo_rechazo,contacto_nombre,contacto_email,user_id,imagenes,lat,lng,recorrido,umbrales,destacada,created_at',
    campos: ['estado', 'motivo_rechazo', 'lat', 'lng', 'recorrido', 'umbrales', 'destacada'], soloEditar: true, orden: 'created_at.desc',
  },
  denuncias: {
    select: 'id,codigo,categoria,texto,contacto,estado,respuesta,created_at',
    campos: ['estado', 'respuesta'], soloEditar: true, orden: 'created_at.desc',
  },
  comments: {
    select: 'id,texto,estado,created_at,proposal_id',
    campos: ['estado'], soloEditar: true, orden: 'created_at.desc',
  },
  members_inbox: {
    select: 'id,nombre,apellidos,cuota_tipo,estado,stripe_customer_id,created_at',
    campos: [], soloLeer: true, orden: 'created_at.desc',
  },
  afiliados: {
    select: 'id,numero,nombre,apellidos,dni,telefono,cuota,total,estado,notas,created_at',
    campos: ['numero', 'nombre', 'apellidos', 'dni', 'telefono', 'cuota', 'total', 'estado', 'notas'],
    orden: 'numero.asc', borrable: true,
  },
  donations: {
    select: 'id,donor_nombre,donor_apellidos,donor_email,importe_cents,ejercicio,estado,created_at',
    campos: [], soloLeer: true, orden: 'created_at.desc',
  },
};

// Traducción ES<->VA vía Apertium (libre, sin clave). Best-effort: si falla, se copia el original.
async function apertium(q, dir) {
  try {
    const lp = dir === 'va2es' ? 'cat|spa' : 'spa|cat_valencia';
    const r = await fetch('https://apertium.org/apy/translate', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ langpair: lp, q }),
      signal: AbortSignal.timeout(9000),
    });
    const j = await r.json();
    const t = j && j.responseData && j.responseData.translatedText;
    return t ? t.replace(/[#*@](?=\S)/g, '') : null;   // quita marcadores de palabra desconocida
  } catch { return null; }
}
// Rellena automáticamente el idioma que falte en pares campo_es/campo_va
async function autotraducir(row) {
  const bases = new Set(Object.keys(row).filter(k => /_es$|_va$/.test(k)).map(k => k.slice(0, -3)));
  for (const b of bases) {
    const es = row[b + '_es'], va = row[b + '_va'];
    if (es && !va) row[b + '_va'] = (await apertium(es, 'es2va')) || es;
    else if (va && !es) row[b + '_es'] = (await apertium(va, 'va2es')) || va;
  }
}

const audit = (accion, tabla, id, detalle) =>
  supa('POST', 'audit_log', { accion, tabla, registro_id: String(id || ''), detalle: { ...detalle, actor: 'admin-panel' } }).catch(() => {});

// Busca una cuenta registrada por email (auth admin API). null si no existe.
async function authUserByEmail(email) {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const e = String(email || '').trim().toLowerCase();
  if (!e) return null;
  try {
    const r = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(e)}`, { headers: { apikey: k, authorization: `Bearer ${k}` } });
    const j = await r.json().catch(() => ({}));
    const us = j.users || [];
    return us.find((u) => String(u.email || '').toLowerCase() === e) || null;
  } catch { return null; }
}
// Guarda un voluntario ligado a una cuenta real: snapshot de nombre/foto + marca el título en su perfil.
async function guardarVoluntario(b) {
  const row = b.row || {};
  const tipo = row.tipo === 'colaborador' ? 'colaborador' : 'voluntario';
  const activo = !(row.activo === false || row.activo === 'false' || row.activo === 0);
  const patch = { tipo, barrio_id: row.barrio_id || null, orden: Number(row.orden) || 0, activo };
  let userId = null;
  const email = String(row.email || '').trim().toLowerCase();
  if (email) {
    const u = await authUserByEmail(email);
    if (!u) return jsonErr(404, 'no_user', 'No hay ninguna cuenta registrada con ese correo. La persona debe registrarse primero en la web.');
    userId = u.id;
    const pr = await supa('GET', `profiles?id=eq.${userId}&select=nombre,avatar_url`);
    const prof = (pr.json && pr.json[0]) || {};
    patch.user_id = userId;
    patch.nombre = prof.nombre || u.email.split('@')[0];
    patch.foto = (prof.avatar_url && prof.avatar_url !== 'none') ? prof.avatar_url : null;
  }
  let vid = b.row.id;
  if (vid) {
    const res = await supa('PATCH', `voluntarios?id=eq.${vid}`, patch);
    if (!res.ok) return jsonErr(502, 'db_error', 'No se pudo guardar: ' + (res.text || '').slice(0, 140));
    if (!userId) userId = ((await supa('GET', `voluntarios?id=eq.${vid}&select=user_id`)).json || [])[0]?.user_id || null;
  } else {
    if (!userId) return jsonErr(400, 'need_email', 'Escribe el correo de una cuenta registrada para asignar el voluntario.');
    const res = await supa('POST', 'voluntarios', patch);
    if (!res.ok) return jsonErr(502, 'db_error', 'No se pudo crear: ' + (res.text || '').slice(0, 140));
    vid = res.json?.[0]?.id;
  }
  // Marca (o retira) el título en la cuenta de la persona.
  if (userId) await supa('PATCH', `profiles?id=eq.${userId}`, { voluntariado: activo ? tipo : null }).catch(() => {});
  await audit(vid && b.row.id ? 'editar' : 'crear', 'voluntarios', vid, { tipo, user_id: userId });
  return jsonOk({ ok: true });
}

// Conteo exacto sin traer filas (HEAD + Prefer: count=exact)
async function supaCount(pathQ) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/${pathQ}`;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const r = await fetch(url, { method: 'HEAD', headers: { apikey: key, authorization: `Bearer ${key}`, prefer: 'count=exact' } });
    const total = Number((r.headers.get('content-range') || '').split('/')[1]);
    return Number.isFinite(total) ? total : 0;
  } catch { return 0; }
}
// Medianoche de hace `diasAtras` días en Madrid, como ISO UTC (para filtros "hoy" / series)
function madridDayStart(diasAtras = 0) {
  const now = new Date();
  const offMs = now - new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Madrid' }));
  const ymd = now.toLocaleDateString('sv', { timeZone: 'Europe/Madrid' });
  return new Date(new Date(`${ymd}T00:00:00Z`).getTime() + offMs - diasAtras * 864e5).toISOString();
}
// Lista de exclusiones del boletín en Brevo (se crea la primera vez que hace falta)
const EXCL_LIST_NAME = 'Exclusiones panel';
async function brevoExclusionList(key, crear) {
  const bh = { 'api-key': key, accept: 'application/json', 'content-type': 'application/json' };
  const r = await fetch('https://api.brevo.com/v3/contacts/lists?limit=50', { headers: bh });
  const j = await r.json().catch(() => ({}));
  const found = (j.lists || []).find((l) => l.name === EXCL_LIST_NAME);
  if (found) return found.id;
  if (!crear) return null;
  const fr = await fetch('https://api.brevo.com/v3/contacts/folders?limit=1', { headers: bh });
  const fj = await fr.json().catch(() => ({}));
  const folderId = (fj.folders && fj.folders[0] && fj.folders[0].id) || 1;
  const cr = await fetch('https://api.brevo.com/v3/contacts/lists', {
    method: 'POST', headers: bh, body: JSON.stringify({ name: EXCL_LIST_NAME, folderId }),
  });
  const cj = await cr.json().catch(() => ({}));
  return cj.id || null;
}

// ---------- API ----------
async function api(req, context) {
  const key = process.env.ADMIN_PASSWORD;
  if (!key || !supaConfigured()) return jsonErr(503, 'unconfigured', 'Panel no configurado (falta ADMIN_PASSWORD)');
  let b;
  try { b = await req.json(); } catch { return jsonErr(400, 'bad_json', 'Cuerpo inválido'); }

  if (b.action === 'login') {
    const ip = req.headers.get('cf-connecting-ip') || context.ip || req.headers.get('x-nf-client-connection-ip') || '0.0.0.0';
    if (rateLimited('admin:' + ip, 8)) return jsonErr(429, 'rate_limited', 'Demasiados intentos, espera una hora');
    if (!safeEqual(b.password || '', key)) return jsonErr(401, 'bad_password', 'Contraseña incorrecta');
    const totp = process.env.ADMIN_TOTP_SECRET;
    if (totp) {
      if (!b.code) return jsonErr(401, 'totp_required', 'Introduce el código de tu app de autenticación');
      if (!verifyTotp(totp, b.code)) return jsonErr(401, 'bad_totp', 'Código 2FA incorrecto o caducado');
    }
    return jsonOk({ ok: true, token: makeToken(key) });
  }

  const token = (req.headers.get('authorization') || '').replace('Bearer ', '');
  if (!checkToken(token, key)) return jsonErr(401, 'unauthorized', 'Sesión caducada — vuelve a entrar');

  if (b.action === 'upload') {                       // subida de imagen a Supabase Storage (bucket media)
    const data = String(b.data || '');
    if (data.length > 6_500_000) return jsonErr(413, 'too_big', 'Imagen demasiado grande (máx ~4,5 MB)');
    const buf = Buffer.from(data, 'base64');
    if (!buf.length) return jsonErr(400, 'bad_data', 'Imagen vacía');
    const EXTS = { 'image/png': 'png', 'image/gif': 'gif', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'application/pdf': 'pdf', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };
    const ext = EXTS[b.tipo] || 'webp';
    const path = 'uploads/' + slugify(String(b.nombre || 'img').replace(/\.[a-z0-9]+$/i, '')).slice(0, 40)
      + '-' + Date.now().toString(36) + '.' + ext;
    const r = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/media/${path}`, {
      method: 'POST',
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        'content-type': b.tipo || 'image/webp',
      },
      body: buf,
    });
    if (!r.ok) return jsonErr(502, 'storage_error', 'No se pudo subir: ' + (await r.text()).slice(0, 120));
    await audit('subir_imagen', 'storage', path, {});
    return jsonOk({ ok: true, url: `${process.env.SUPABASE_URL}/storage/v1/object/public/media/${path}` });
  }

  if (b.action === 'sign-upload') {                  // URL firmada → subida DIRECTA a Storage (vídeos, evita el límite ~4,5 MB de la función)
    const EXTS = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'video/ogg': 'ogv', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'application/pdf': 'pdf' };
    const ext = EXTS[b.tipo] || (String(b.nombre || '').match(/\.([a-z0-9]+)$/i) || [])[1] || 'mp4';
    const path = 'uploads/' + slugify(String(b.nombre || 'vid').replace(/\.[a-z0-9]+$/i, '')).slice(0, 40)
      + '-' + Date.now().toString(36) + '.' + ext;
    const r = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/upload/sign/media/${path}`, {
      method: 'POST',
      headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json' },
      body: '{}',
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.url) return jsonErr(502, 'storage_error', 'No se pudo preparar la subida');
    await audit('firmar_subida', 'storage', path, {});
    return jsonOk({ ok: true, signedUrl: `${process.env.SUPABASE_URL}/storage/v1${j.url}`, publicUrl: `${process.env.SUPABASE_URL}/storage/v1/object/public/media/${path}` });
  }

  // ---- Panel de inicio (resumen) ----
  if (b.action === 'dashboard') {
    const list = async (p) => { const r = await supa('GET', p); return Array.isArray(r.json) ? r.json : []; };
    const [prop, com, den, tes, msg, rep] = await Promise.all([
      list('proposals?estado=eq.pendiente_moderacion&select=id'),
      list('comments?estado=eq.pendiente&select=id'),
      list('denuncias?estado=in.(nueva,en_tramite)&select=id'),
      list('tesoreria?select=tipo,importe_cents'),
      list('messages?estado=eq.publicado&select=id'),
      list('proposal_reports?estado=eq.pendiente&select=id'),
    ]);
    let ing = 0, gas = 0;
    for (const m of tes) { if (m.tipo === 'ingreso') ing += m.importe_cents; else gas += m.importe_cents; }
    const contactosNuevos = await supaCount('contact_messages?estado=eq.nuevo&select=id');
    const apelacionesPendientes = await supaCount('profiles?bloqueado=eq.true&apelacion_texto=not.is.null&select=id');
    // Afiliaciones nuevas: suscripciones de Stripe creadas en las últimas 48 h (mismo filtro que la
    // lista de Afiliados — se excluyen canceladas/incompletas). afiliadoMaxTs = alta más reciente
    // (epoch en segundos) para que el cliente pueda marcar el badge como "visto" al abrir la pestaña.
    let afiliadosNuevos = 0, afiliadoMaxTs = 0;
    const skDash = process.env.STRIPE_SECRET_KEY;
    if (skDash) {
      const desde48 = Math.floor(Date.now() / 1000) - 48 * 3600;
      const sr = await fetch('https://api.stripe.com/v1/subscriptions?status=all&limit=100&created[gte]=' + desde48, { headers: { authorization: 'Bearer ' + skDash } }).then((x) => x.json()).catch(() => ({}));
      const nuevas = (sr.data || []).filter((s) => !['canceled', 'incomplete_expired', 'incomplete'].includes(s.status));
      afiliadosNuevos = nuevas.length;
      afiliadoMaxTs = nuevas.reduce((m, s) => Math.max(m, s.created || 0), 0);
    }
    return jsonOk({ ok: true, data: {
      propuestasPendientes: prop.length, comentariosPendientes: com.length,
      denunciasAbiertas: den.length, reportesPendientes: rep.length, mensajesChat: msg.length, contactosNuevos, apelacionesPendientes,
      saldoCents: ing - gas, ingresosCents: ing, gastosCents: gas,
      afiliadosNuevos, afiliadoMaxTs,
    } });
  }

  // ---- Analítica real (visitas, redes, registros, newsletter, donaciones, interacciones) ----
  if (b.action === 'analytics') {
    const hoy = madridDayStart(0);
    const hace7 = madridDayStart(6);
    const ymdHoy = new Date().toLocaleDateString('sv', { timeZone: 'Europe/Madrid' });
    const rows = async (q) => { const r = await supa('GET', q); return Array.isArray(r.json) ? r.json : []; };
    // Lectura paginada: PostgREST corta a 1000 filas por página; sin esto (y con order desc) se perdían
    // las filas MÁS RECIENTES → hoy/ayer salían a 0 en la serie de visitas y en el gráfico horario.
    const rowsPaged = async (baseQ) => {
      const out = [];
      for (let off = 0; off < 60000; off += 1000) {
        const page = await rows(`${baseQ}&order=created_at.desc&limit=1000&offset=${off}`);
        out.push(...page);
        if (page.length < 1000) break;
      }
      return out;
    };
    // Usuarios REALES: fuera semillas (@seed.acg) y la cuenta de sistema.
    const usuariosReales = async () => {
      try {
        const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
        const out = []; const seedIds = [];
        for (let page = 1; page <= 10; page++) {
          const r = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=100`, { headers: { apikey: k, authorization: `Bearer ${k}` } });
          const j = await r.json().catch(() => ({}));
          const us = j.users || [];
          for (const u of us) {
            const em = String(u.email || '').toLowerCase();
            // Cuentas técnicas (semillas/pruebas/sistema) → no cuentan como personas.
            // Incluye @acg-test.local y test_* (antes se colaban e inflaban el contador de miembros).
            const sys = em.endsWith('@seed.acg') || em.endsWith('@acgtest.local') || em.endsWith('@acg-test.local')
              || em.endsWith('@acg.test') || em.startsWith('sistema-oficial@') || em.startsWith('moderacion-test@') || em.startsWith('test_');
            if (sys) seedIds.push(u.id);
            else out.push(u);
          }
          if (us.length < 100) break;
        }
        return { total: out.length, hoy: out.filter((u) => String(u.created_at) >= hoy).length, seedIds };
      } catch { return { total: 0, hoy: 0, seedIds: [] }; }
    };
    const brevo = async () => {
      const k = process.env.BREVO_API_KEY;
      if (!k) return { total: 0, hoy: 0 };
      try {
        const r = await fetch('https://api.brevo.com/v3/contacts?limit=500&sort=desc', { headers: { 'api-key': k, accept: 'application/json' } });
        const j = await r.json();
        return {
          total: j.count != null ? j.count : (j.contacts || []).length,
          hoy: (j.contacts || []).filter((c) => String(c.createdAt || '').slice(0, 10) === ymdHoy && !c.emailBlacklisted).length,
        };
      } catch { return { total: 0, hoy: 0 }; }
    };
    const ayer = madridDayStart(1);
    // Serie de 30 días en UNA query (bucket por día de Madrid en JS)
    const serie30q = async () => {
      const desde = madridDayStart(29);
      const xs = await rowsPaged(`analytics_events?select=created_at&tipo=eq.pageview&created_at=gte.${desde}`);
      const buckets = {};
      for (const x of xs) {
        const d = new Date(x.created_at).toLocaleDateString('sv', { timeZone: 'Europe/Madrid' });
        buckets[d] = (buckets[d] || 0) + 1;
      }
      const out = [];
      for (let i = 29; i >= 0; i--) {
        const d = new Date(Date.now() - i * 864e5).toLocaleDateString('sv', { timeZone: 'Europe/Madrid' });
        out.push({ d, n: buckets[d] || 0 });
      }
      return out;
    };
    const [pvHoy, pvAyer, pvRows, socRows, serie30, reg, news, don, propTotal, propHoy, chatHoy, contNuevos, afiliadosAct] = await Promise.all([
      supaCount(`analytics_events?tipo=eq.pageview&created_at=gte.${hoy}&select=id`),
      supaCount(`analytics_events?tipo=eq.pageview&created_at=gte.${ayer}&created_at=lt.${hoy}&select=id`),
      rows(`analytics_events?select=sid,path,ref,lang&tipo=eq.pageview&created_at=gte.${hoy}&limit=1000`),
      rows(`analytics_events?select=red,created_at&tipo=eq.social&created_at=gte.${hace7}&limit=1000`),
      serie30q(),
      usuariosReales(),
      brevo(),
      rows('donations?select=importe_cents,estado,created_at,liquidada_at,donor_nombre&order=created_at.desc&limit=1000'),
      supaCount('proposals?select=id'),
      supaCount(`proposals?created_at=gte.${hoy}&select=id`),
      supaCount(`messages?created_at=gte.${hoy}&select=id`),
      supaCount('contact_messages?estado=eq.nuevo&select=id'),
      supaCount('afiliados?estado=eq.activo&select=id'),
    ]);
    // Votos reales: sin los de usuarios semilla
    const notSeed = reg.seedIds.length ? `&user_id=not.in.(${reg.seedIds.join(',')})` : '';
    const [votTotal, votHoy] = await Promise.all([
      supaCount(`votes?select=id${notSeed}`),
      supaCount(`votes?created_at=gte.${hoy}&select=id${notSeed}`),
    ]);
    // Visitas por hora (Madrid) de hoy y de ayer, para el gráfico comparativo
    const hace8 = madridDayStart(7);
    const horaRows = await rowsPaged(`analytics_events?select=created_at&tipo=eq.pageview&created_at=gte.${hace8}`);
    // horas8[0]=hoy, horas8[1]=ayer, ... horas8[7]=hace 7 dias (24 huecos cada uno, hora de Madrid)
    const horas8 = [...Array(8)].map(() => Array(24).fill(0));
    const diaISO = (iso) => new Date(iso).toLocaleDateString('sv', { timeZone: 'Europe/Madrid' });
    const dias8 = [...Array(8)].map((_, i) => new Date(Date.now() - i * 864e5).toLocaleDateString('sv', { timeZone: 'Europe/Madrid' }));
    for (const x of horaRows) {
      const idx = dias8.indexOf(diaISO(x.created_at));
      if (idx === -1) continue;
      const h9 = Number(new Date(x.created_at).toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Europe/Madrid' })) % 24;
      horas8[idx][h9]++;
    }
    const hoyH = horas8[0], ayerH = horas8[1];
    for (const x of []) {
      const h = Number(new Date(x.created_at).toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Europe/Madrid' })) % 24;
      if (x.created_at >= hoy) hoyH[h]++; else ayerH[h]++;
    }
    const horaActual = Number(new Date().toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Europe/Madrid' })) % 24;
    const unicosHoy = new Set(pvRows.map((x) => x.sid).filter(Boolean)).size;
    const paths = {};
    for (const x of pvRows) paths[x.path || '/'] = (paths[x.path || '/'] || 0) + 1;
    const topPaginas = Object.entries(paths).sort((a, b2) => b2[1] - a[1]).slice(0, 6);
    // Fuentes de tráfico de hoy (hostname del referrer; vacío = directo; se ignora el propio dominio)
    const fuentes = {};
    for (const x of pvRows) {
      let f = 'Directo';
      try {
        if (x.ref) {
          const hn = new URL(x.ref).hostname.replace(/^www\./, '');
          if (/accioncivilgandia/.test(hn)) continue;
          f = hn || 'Directo';
        }
      } catch { f = 'Directo'; }
      fuentes[f] = (fuentes[f] || 0) + 1;
    }
    const topFuentes = Object.entries(fuentes).sort((a, b2) => b2[1] - a[1]).slice(0, 6);
    const langsHoy = { es: 0, va: 0 };
    for (const x of pvRows) { if (x.lang === 'va') langsHoy.va++; else langsHoy.es++; }
    const redes = {};
    let socialHoy = 0;
    for (const x of socRows) {
      const r = x.red || 'otra';
      redes[r] = redes[r] || { hoy: 0, semana: 0 };
      redes[r].semana++;
      if (x.created_at >= hoy) { redes[r].hoy++; socialHoy++; }
    }
    // Visitas que ENTRAN desde redes (pageviews con red=origen, via referrer/utm en support.js)
    const inRows = await rowsPaged(`analytics_events?select=red,created_at&tipo=eq.pageview&red=not.is.null&created_at=gte.${hace7}`);
    const redesIn = {};
    for (const x of inRows) {
      const rN = x.red || 'otra';
      redesIn[rN] = redesIn[rN] || { hoy: 0, semana: 0 };
      redesIn[rN].semana++;
      if (x.created_at >= hoy) redesIn[rN].hoy++;
    }
    const donPag = don.filter((d) => !d.estado || ['pagada', 'succeeded', 'completada'].includes(d.estado));
    const donTotalCents = donPag.reduce((s2, d) => s2 + (d.importe_cents || 0), 0);
    const donHoy = donPag.filter((d) => String(d.created_at) >= hoy);
    // Pendientes de ingreso: cobradas pero que Stripe aún no ha liquidado al banco (se reinician cada payout mensual)
    const donPend = donPag.filter((d) => !d.liquidada_at);
    const donPendCents = donPend.reduce((s2, d) => s2 + (d.importe_cents || 0), 0);
    const donLista = donPag.slice(0, 12).map((d) => ({ nombre: d.donor_nombre || '—', cents: d.importe_cents || 0, fecha: String(d.created_at || '').slice(0, 10), liquidada: !!d.liquidada_at }));
    return jsonOk({ ok: true, data: {
      pvHoy, pvAyer, unicosHoy, socialHoy,
      serie7: serie30.slice(-7).map((x) => x.n), serie30,
      topPaginas, topFuentes, langsHoy, redes,
      hoyH, ayerH, horaActual, horas8, dias8, redesIn,
      registrosTotal: reg.total, registrosHoy: reg.hoy,
      newsTotal: news.total, newsHoy: news.hoy,
      donCount: donPag.length, donTotalCents, donHoyCount: donHoy.length,
      donHoyCents: donHoy.reduce((s2, d) => s2 + (d.importe_cents || 0), 0),
      donPendCount: donPend.length, donPendCents, donLista,
      votTotal, votHoy, propTotal, propHoy, chatHoy, contNuevos, afiliadosAct,
    } });
  }

  // ---- Actividad reciente (feed CRM del panel de inicio) ----
  if (b.action === 'actividad') {
    const list = async (p) => { const r = await supa('GET', p); return Array.isArray(r.json) ? r.json : []; };
    const [props, coms, conts, dons, dens] = await Promise.all([
      list('proposals?select=titulo,estado,contacto_nombre,created_at&order=created_at.desc&limit=8'),
      list('comments?select=texto,estado,created_at,profiles(nombre)&order=created_at.desc&limit=8'),
      list('contact_messages?select=nombre,asunto,estado,created_at&order=created_at.desc&limit=8'),
      list('donations?select=importe_cents,estado,created_at&order=created_at.desc&limit=8'),
      list('denuncias?select=codigo,estado,created_at&order=created_at.desc&limit=5'),
    ]);
    const feed = [
      ...props.map((x) => ({ tipo: 'propuesta', titulo: x.titulo, quien: x.contacto_nombre || 'Anónimo', estado: x.estado, at: x.created_at })),
      ...coms.map((x) => ({ tipo: 'comentario', titulo: String(x.texto || '').slice(0, 90), quien: x.profiles?.nombre || 'Vecino/a', estado: x.estado, at: x.created_at })),
      ...conts.map((x) => ({ tipo: 'contacto', titulo: x.asunto || 'Mensaje de contacto', quien: x.nombre, estado: x.estado, at: x.created_at })),
      ...dons.map((x) => ({ tipo: 'donacion', titulo: (x.importe_cents / 100).toFixed(2).replace('.', ',') + ' €', quien: '', estado: x.estado, at: x.created_at })),
      ...dens.map((x) => ({ tipo: 'denuncia', titulo: x.codigo, quien: '', estado: x.estado, at: x.created_at })),
    ].sort((a, b2) => String(b2.at).localeCompare(String(a.at))).slice(0, 14);
    return jsonOk({ ok: true, items: feed });
  }

  // ---- inscripciones a actos, agrupadas por evento (para la pestaña Agenda) ----
  if (b.action === 'inscripciones-list') {
    const [insc, evs] = await Promise.all([
      supa('GET', 'event_inscripciones?select=event_slug,nombre,email,created_at&order=created_at.desc&limit=1000'),
      supa('GET', 'events?select=slug,titulo_es,fecha&order=fecha.desc&limit=200'),
    ]);
    const by = {};
    for (const x of insc.json || []) (by[x.event_slug] ||= []).push({ nombre: x.nombre || '', email: x.email, fecha: String(x.created_at).slice(0, 10) });
    const items = (evs.json || []).map((e) => ({ slug: e.slug, titulo: e.titulo_es, fecha: e.fecha, personas: by[e.slug] || [] })).filter((e) => e.personas.length);
    return jsonOk({ ok: true, items });
  }

  // ---- Afiliados: suscripciones REALES de Stripe (nada manual) ----
  if (b.action === 'afiliados-stripe') {
    const sk = process.env.STRIPE_SECRET_KEY;
    if (!sk) return jsonOk({ ok: true, afiliados: [], activos: 0, acumMesCents: 0, ingresado: true, noStripe: true });
    const r = await fetch('https://api.stripe.com/v1/subscriptions?status=all&limit=100&expand[]=data.customer', { headers: { authorization: 'Bearer ' + sk } }).then((x) => x.json()).catch(() => ({}));
    const subs = (r.data || []).filter((s) => !['canceled', 'incomplete_expired', 'incomplete'].includes(s.status));
    const afiliados = subs.map((s) => {
      const it = s.items && s.items.data && s.items.data[0];
      const cents = (it && it.price && it.price.unit_amount) || 0;
      const md = s.metadata || {};
      const nom = ((md.nombre || '') + ' ' + (md.apellidos || '')).trim();
      const estado = s.pause_collection ? 'pausado' : (s.cancel_at_period_end ? 'baja_fin' : s.status);
      // Stripe "Basil" (API 2025-03-31) movió current_period_end del objeto Subscription a cada item.
      // Se lee primero del item (API nuevas) y se cae al nivel suscripción (API antiguas) como respaldo.
      // Así la fecha de próximo cobro aparece en cuanto existe la suscripción (p. ej. SEPA con primer
      // pago aún en proceso), sin esperar al webhook de pago confirmado.
      const finPeriodo = (it && it.current_period_end) || s.current_period_end || null;
      return {
        id: s.id,
        nombre: nom || (s.customer && s.customer.name) || '—',
        email: (s.customer && s.customer.email) || md.email || '',
        cuotaCents: cents,
        proximo: finPeriodo ? new Date(finPeriodo * 1000).toISOString().slice(0, 10) : '',
        estado,
      };
    }).sort((a, c) => a.nombre.localeCompare(c.nombre));
    // Acumulado de cuotas cobradas este mes pendientes de ingreso (payments sin liquidar)
    const pq = await supa('GET', 'payments?estado=eq.pagado&liquidada_at=is.null&select=importe_cents');
    const acumMesCents = (pq.json || []).reduce((s2, p) => s2 + (p.importe_cents || 0), 0);
    const activos = afiliados.filter((x) => x.estado === 'active' || x.estado === 'baja_fin').length;
    // Afiliados anteriores (sistema manual): se conservan; quedan como "pendientes de reafiliación"
    // hasta que se afilien por el enlace con el mismo nombre (match normalizado) -> pasan a la lista Stripe.
    const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
    const activeNames = new Set(afiliados.map((a) => norm(a.nombre)));
    const leg = await supa('GET', 'afiliados?select=id,numero,nombre,apellidos,cuota,total,estado&order=numero.asc');
    const anteriores = (leg.json || []).map((x) => ({
      id: x.id,
      numero: x.numero,
      nombre: ((x.nombre || '') + ' ' + (x.apellidos || '')).trim(),
      cuotaCents: Math.round((x.cuota || 0) * 100),
      totalCents: Math.round((x.total || 0) * 100),
      estado: x.estado,
    })).filter((x) => !activeNames.has(norm(x.nombre)))
      .sort((a, c) => (a.estado === 'activo' ? 0 : 1) - (c.estado === 'activo' ? 0 : 1) || (a.numero - c.numero));
    return jsonOk({ ok: true, afiliados, activos, acumMesCents, ingresado: acumMesCents === 0, anteriores });
  }
  if (['afiliado-pausar', 'afiliado-reactivar', 'afiliado-baja'].includes(b.action)) {
    const id = String(b.id || '');
    if (!/^sub_/.test(id)) return jsonErr(400, 'bad_id', 'Suscripción no válida');
    const params = b.action === 'afiliado-pausar' ? { 'pause_collection[behavior]': 'void' }
      : b.action === 'afiliado-baja' ? { cancel_at_period_end: 'true' }
      : { pause_collection: '', cancel_at_period_end: 'false' };
    const j = await fetch('https://api.stripe.com/v1/subscriptions/' + id, {
      method: 'POST', headers: { authorization: 'Bearer ' + process.env.STRIPE_SECRET_KEY, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
    }).then((x) => x.json()).catch(() => ({ error: { message: 'red' } }));
    if (j.error) return jsonErr(502, 'stripe_error', j.error.message);
    await audit(b.action.replace('-', '_'), 'members', id, {});
    return jsonOk({ ok: true });
  }
  if (b.action === 'afiliado-cambiar-cuota') {
    const id = String(b.id || '');
    const cents = Math.round(Number(b.cents));
    if (!/^sub_/.test(id)) return jsonErr(400, 'bad_id', 'Suscripción no válida');
    if (!Number.isFinite(cents) || cents < 300 || cents > 500000) return jsonErr(400, 'bad_amount', 'Importe no válido');
    const sk = process.env.STRIPE_SECRET_KEY;
    const sub = await fetch('https://api.stripe.com/v1/subscriptions/' + id, { headers: { authorization: 'Bearer ' + sk } }).then((x) => x.json()).catch(() => ({}));
    if (sub.error || !sub.items) return jsonErr(502, 'stripe_error', (sub.error && sub.error.message) || 'No encontrada');
    const item = sub.items.data[0];
    const product = item.price && item.price.product;
    // Nuevo precio recurrente mensual sobre el mismo producto; el cambio aplica sin prorrateo (siguiente ciclo).
    const pr = await fetch('https://api.stripe.com/v1/prices', {
      method: 'POST', headers: { authorization: 'Bearer ' + sk, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ currency: 'eur', unit_amount: String(cents), 'recurring[interval]': 'month', product }),
    }).then((x) => x.json()).catch(() => ({}));
    if (pr.error) return jsonErr(502, 'stripe_error', pr.error.message);
    const up = await fetch('https://api.stripe.com/v1/subscriptions/' + id, {
      method: 'POST', headers: { authorization: 'Bearer ' + sk, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ 'items[0][id]': item.id, 'items[0][price]': pr.id, proration_behavior: 'none' }),
    }).then((x) => x.json()).catch(() => ({}));
    if (up.error) return jsonErr(502, 'stripe_error', up.error.message);
    await audit('afiliado_cambiar_cuota', 'members', id, { cents });
    return jsonOk({ ok: true });
  }
  // Baja de un afiliado ANTIGUO (tabla manual `afiliados`), solo estos 23 casos aislados.
  if (b.action === 'legacy-baja') {
    const id = String(b.id || '');
    if (!/^[0-9a-f-]{36}$/i.test(id)) return jsonErr(400, 'bad_id', 'Afiliado no válido');
    const up = await supa('PATCH', `afiliados?id=eq.${id}`, { estado: 'baja' });
    if (!up.ok) return jsonErr(502, 'db_error', 'No se pudo dar de baja');
    await audit('afiliado_legacy_baja', 'afiliados', id, {});
    return jsonOk({ ok: true });
  }
  // Eliminar del registro un afiliado ANTIGUO ya parado (solo estos 23 casos aislados).
  if (b.action === 'legacy-eliminar') {
    const id = String(b.id || '');
    if (!/^[0-9a-f-]{36}$/i.test(id)) return jsonErr(400, 'bad_id', 'Afiliado no válido');
    const del = await supa('DELETE', `afiliados?id=eq.${id}`);
    if (!del.ok) return jsonErr(502, 'db_error', 'No se pudo eliminar');
    await audit('afiliado_legacy_eliminar', 'afiliados', id, {});
    return jsonOk({ ok: true });
  }

  // ---- hilo de una denuncia (equipo <-> informante) ----
  if (b.action === 'den-hilo') {
    const codigo = String(b.codigo || '').toUpperCase();
    if (!/^ACG-[0-9A-F]{8}$/.test(codigo)) return jsonErr(400, 'bad_codigo', 'Código no válido');
    const ms = await supa('GET', `denuncia_mensajes?codigo=eq.${codigo}&select=autor,texto,created_at&order=created_at.asc&limit=200`);
    return jsonOk({ ok: true, items: (ms.json || []).map((m) => ({ autor: m.autor, texto: m.texto, fecha: String(m.created_at).slice(0, 16).replace('T', ' ') })) });
  }
  if (b.action === 'den-msg') {
    const codigo = String(b.codigo || '').toUpperCase();
    const texto = String(b.texto || '').trim();
    if (!/^ACG-[0-9A-F]{8}$/.test(codigo)) return jsonErr(400, 'bad_codigo', 'Código no válido');
    if (texto.length < 2 || texto.length > 4000) return jsonErr(400, 'invalid_texto', 'Mensaje entre 2 y 4000 caracteres');
    const ins = await supa('POST', 'denuncia_mensajes', { codigo, autor: 'equipo', texto });
    if (!ins.ok) return jsonErr(502, 'db_error', 'No se pudo enviar');
    await supa('PATCH', `denuncias?codigo=eq.${codigo}&estado=eq.nueva`, { estado: 'en_tramite' });
    // aviso al informante si dejó contacto (sin incluir el contenido)
    const d = await supa('GET', `denuncias?codigo=eq.${codigo}&select=contacto,email`);
    const to = d.json?.[0]?.contacto || d.json?.[0]?.email;
    if (to) sendEmail({
      to, subject: 'Hay novedades en tu expediente confidencial',
      html: emailShell({ title: 'Novedades en tu expediente', body: `<p>El equipo de cumplimiento ha añadido un mensaje a tu expediente <b>${codigo}</b>.</p><p><a href="https://accioncivilgandia.netlify.app/denuncias?ver=${codigo}">Leer la conversación</a> (necesitarás tu código).</p>` }),
    }).catch(() => {});
    await audit('den_mensaje', 'denuncia_mensajes', codigo, {});
    return jsonOk({ ok: true });
  }

  // ---- Chat de la comunidad (ver, responder como Acción Civil, ocultar) ----
  if (b.action === 'chat-list') {
    const r = await supa('GET', 'messages?select=id,texto,estado,created_at,user_id,profiles(nombre,bloqueado)&order=created_at.desc&limit=80');
    if (!r.ok) return jsonErr(502, 'db_error', 'No se pudo cargar el chat');
    const items = (r.json || []).map((m) => ({
      id: m.id, texto: m.texto, estado: m.estado, at: m.created_at, uid: m.user_id,
      autor: m.profiles?.nombre || 'Vecino/a', oficial: m.user_id === SYSTEM_CHAT_ID,
      bloqueado: !!m.profiles?.bloqueado,
    }));
    return jsonOk({ ok: true, items });
  }
  if (b.action === 'chat-del') {
    const id = String(b.id || '');
    if (!/^[0-9a-f-]{36}$/.test(id)) return jsonErr(400, 'bad_id', 'Id no válido');
    const r = await supa('DELETE', `messages?id=eq.${id}`);
    if (!r.ok) return jsonErr(502, 'db_error', 'No se pudo borrar');
    await audit('chat_borrar', 'messages', id, {});
    return jsonOk({ ok: true });
  }
  if (b.action === 'user-block') {
    const uid = String(b.userId || '');
    if (!/^[0-9a-f-]{36}$/.test(uid)) return jsonErr(400, 'bad_id', 'Usuario no válido');
    if (uid === SYSTEM_CHAT_ID) return jsonErr(400, 'no_self', 'No se puede bloquear la cuenta oficial');
    const bloquear = !!b.bloquear;
    const motivo = bloquear ? String(b.motivo || '').trim().slice(0, 500) : null;
    if (bloquear && (motivo || '').length < 3) return jsonErr(400, 'no_motivo', 'Indica el motivo del bloqueo');
    const patch = bloquear
      ? { bloqueado: true, bloqueo_motivo: motivo, bloqueado_at: new Date().toISOString() }
      : { bloqueado: false, bloqueo_motivo: null, bloqueado_at: null, apelacion_texto: null, apelacion_at: null };
    const r = await supa('PATCH', `profiles?id=eq.${uid}`, patch);
    if (!r.ok) return jsonErr(502, 'db_error', 'No se pudo actualizar (¿migración de columnas de bloqueo aplicada?)');
    // Al bloquear: ocultar del público TODO lo que ha dicho (chat + comentarios). Al desbloquear: restaurarlo.
    if (bloquear) {
      await supa('PATCH', `messages?user_id=eq.${uid}&estado=eq.publicado`, { estado: 'oculto' });
      await supa('PATCH', `comments?user_id=eq.${uid}&estado=eq.publicado`, { estado: 'oculto' });
    } else {
      await supa('PATCH', `messages?user_id=eq.${uid}&estado=eq.oculto`, { estado: 'publicado' });
      await supa('PATCH', `comments?user_id=eq.${uid}&estado=eq.oculto`, { estado: 'publicado' });
    }
    // Aviso por correo (el email vive en auth.users, no en profiles)
    try {
      const au = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users/${uid}`, {
        headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY },
      }).then((x) => x.json()).catch(() => null);
      const to = au && au.email;
      if (to && bloquear) await sendEmail({ to, subject: 'Tu cuenta ha sido bloqueada — Acción Civil Gandia',
        html: emailShell({ title: 'Cuenta bloqueada temporalmente', body: `<p>Hola,</p><p>Tu cuenta en la comunidad de Acción Civil Gandia ha sido <b>bloqueada</b> por este motivo:</p><p style="background:#FBECEC;border-left:3px solid #C0392B;padding:10px 14px;border-radius:6px">${String(motivo).replace(/</g, '&lt;')}</p><p>Mientras dure el bloqueo no podrás publicar en el chat, comentar ni crear propuestas. Es <b>hasta nuevo aviso</b>.</p><p>Si crees que es un error, puedes <b>apelar</b> desde tu área ciudadana (entra en «Mi cuenta»).</p>` }) }).catch(() => {});
      if (to && !bloquear) await sendEmail({ to, subject: 'Tu cuenta ha sido desbloqueada — Acción Civil Gandia',
        html: emailShell({ title: 'Cuenta desbloqueada', body: '<p>Buenas noticias: tu cuenta ha sido <b>desbloqueada</b> y ya puedes volver a participar en la comunidad. Gracias por tu colaboración.</p>' }) }).catch(() => {});
    } catch (e) { console.error('block email fail', e); }
    await audit(bloquear ? 'user_bloquear' : 'user_desbloquear', 'profiles', uid, { motivo });
    return jsonOk({ ok: true });
  }
  if (b.action === 'bloqueados-list') {
    const r = await supa('GET', 'profiles?bloqueado=eq.true&select=id,nombre,bloqueo_motivo,bloqueado_at,apelacion_texto,apelacion_at&order=bloqueado_at.desc.nullslast');
    const rows = r.json || [];
    const items = [];
    for (const p of rows) {
      let email = '';
      try {
        const au = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users/${p.id}`, {
          headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY },
        }).then((x) => x.json()).catch(() => null);
        email = (au && au.email) || '';
      } catch {}
      items.push({ id: p.id, nombre: p.nombre || '—', email, motivo: p.bloqueo_motivo || '', desde: p.bloqueado_at ? String(p.bloqueado_at).slice(0, 10) : '', apelacion: p.apelacion_texto || '', apelacionAt: p.apelacion_at ? String(p.apelacion_at).slice(0, 10) : '' });
    }
    return jsonOk({ ok: true, items });
  }
  if (b.action === 'chat-send') {
    const texto = String(b.texto || '').trim().slice(0, 1000);
    if (texto.length < 1) return jsonErr(400, 'empty', 'El mensaje está vacío');
    const r = await supa('POST', 'messages', { user_id: SYSTEM_CHAT_ID, texto });
    if (!r.ok) return jsonErr(502, 'db_error', 'No se pudo enviar: ' + (r.text || '').slice(0, 140));
    await audit('chat_enviar', 'messages', r.json?.[0]?.id, {});
    return jsonOk({ ok: true, item: r.json?.[0] });
  }
  if (b.action === 'chat-hide') {
    const id = String(b.id || '');
    if (!/^[0-9a-f-]{36}$/.test(id)) return jsonErr(400, 'bad_id', 'Id no válido');
    const estado = b.mostrar ? 'publicado' : 'oculto';
    const r = await supa('PATCH', `messages?id=eq.${id}`, { estado });
    if (!r.ok) return jsonErr(502, 'db_error', 'No se pudo actualizar');
    await audit(b.mostrar ? 'chat_mostrar' : 'chat_ocultar', 'messages', id, {});
    return jsonOk({ ok: true });
  }

  // ---- Canal de difusión (anuncios efímeros) ----
  if (b.action === 'broadcast-list') {
    const r = await supa('GET', 'broadcasts?select=id,texto,created_at,expires_at&order=created_at.desc&limit=100');
    if (!r.ok) return jsonErr(502, 'db_error', 'No se pudo cargar');
    return jsonOk({ ok: true, items: r.json || [] });
  }
  if (b.action === 'broadcast-send') {
    const texto = String(b.texto || '').trim().slice(0, 2000);
    if (texto.length < 1) return jsonErr(400, 'empty', 'El anuncio está vacío');
    const dias = [1, 7, 30].includes(Number(b.dias)) ? Number(b.dias) : 7;
    const expires = new Date(Date.now() + dias * 86400000).toISOString();
    const r = await supa('POST', 'broadcasts', { texto, expires_at: expires });
    if (!r.ok) return jsonErr(502, 'db_error', 'No se pudo publicar: ' + (r.text || '').slice(0, 120));
    await audit('difusion_enviar', 'broadcasts', r.json?.[0]?.id, { dias });
    return jsonOk({ ok: true });
  }
  if (b.action === 'broadcast-del') {
    const id = String(b.id || '');
    if (!/^[0-9a-f-]{36}$/.test(id)) return jsonErr(400, 'bad_id', 'Id no válido');
    const r = await supa('DELETE', `broadcasts?id=eq.${id}`);
    if (!r.ok) return jsonErr(502, 'db_error', 'No se pudo borrar');
    await audit('difusion_borrar', 'broadcasts', id, {});
    return jsonOk({ ok: true });
  }

  // ---- Bandeja de contactos ----
  if (b.action === 'contactos-list') {
    const r = await supa('GET', 'contact_messages?select=id,nombre,apellidos,email,asunto,mensaje,estado,created_at&order=created_at.desc&limit=200');
    if (!r.ok) return jsonErr(502, 'db_error', 'No se pudo cargar (¿has creado la tabla contact_messages?)');
    return jsonOk({ ok: true, items: r.json || [] });
  }
  if (b.action === 'contactos-estado') {
    const id = String(b.id || '');
    if (!/^[0-9a-f-]{36}$/.test(id)) return jsonErr(400, 'bad_id', 'Id no válido');
    if (!['nuevo', 'leido', 'respondido', 'archivado'].includes(b.estado)) return jsonErr(400, 'bad_estado', 'Estado no válido');
    const r = await supa('PATCH', `contact_messages?id=eq.${id}`, { estado: b.estado });
    if (!r.ok) return jsonErr(502, 'db_error', 'No se pudo actualizar');
    await audit('contacto_estado', 'contact_messages', id, { estado: b.estado });
    return jsonOk({ ok: true });
  }

  // Comentarios de propuestas: sin moderación previa; el admin los ve todos y puede borrarlos.
  if (b.action === 'comentarios-list') {
    const r = await supa('GET', 'comments?select=id,texto,estado,created_at,profiles:profiles(nombre),proposals:proposals(titulo)&order=created_at.desc&limit=300');
    if (!r.ok) return jsonErr(502, 'db_error', 'No se pudieron cargar los comentarios');
    return jsonOk({ ok: true, items: r.json || [] });
  }
  if (b.action === 'comentario-borrar') {
    const id = String(b.id || '');
    if (!/^[0-9a-f-]{36}$/.test(id)) return jsonErr(400, 'bad_id', 'Id no válido');
    await supa('DELETE', `comment_likes?comment_id=eq.${id}`);
    const r = await supa('DELETE', `comments?id=eq.${id}`);
    if (!r.ok) return jsonErr(502, 'db_error', 'No se pudo borrar');
    await audit('comentario_borrar', 'comments', id, {});
    return jsonOk({ ok: true });
  }

  // Denuncias de propuestas ciudadanas: listar (para revisión manual) y marcar como revisadas.
  if (b.action === 'reportes-list') {
    const r = await supa('GET', 'proposal_reports?select=id,motivo,nota,estado,created_at,proposal_id,proposals:proposals(titulo)&order=created_at.desc&limit=400');
    if (!r.ok) return jsonErr(502, 'db_error', 'No se pudieron cargar las denuncias');
    return jsonOk({ ok: true, items: r.json || [] });
  }
  if (b.action === 'reporte-revisar') {
    const id = String(b.id || '');
    if (!/^[0-9a-f-]{36}$/.test(id)) return jsonErr(400, 'bad_id', 'Id no válido');
    const r = await supa('PATCH', `proposal_reports?id=eq.${id}`, { estado: 'revisado' });
    if (!r.ok) return jsonErr(502, 'db_error', 'No se pudo actualizar');
    await audit('reporte_revisar', 'proposal_reports', id, {});
    return jsonOk({ ok: true });
  }
  if (b.action === 'reportes-descartar') {   // la propuesta es correcta: descarta TODAS sus denuncias
    const pid = String(b.proposalId || '');
    if (!/^[0-9a-f-]{36}$/.test(pid)) return jsonErr(400, 'bad_id', 'Id no válido');
    const r = await supa('DELETE', `proposal_reports?proposal_id=eq.${pid}`);
    if (!r.ok) return jsonErr(502, 'db_error', 'No se pudo descartar');
    await audit('reportes_descartar', 'proposal_reports', pid, {});
    return jsonOk({ ok: true });
  }
  // Preview de una propuesta dentro del admin (para revisar denuncias sin salir del panel).
  if (b.action === 'propuesta-get') {
    const id = String(b.id || '');
    if (!/^[0-9a-f-]{36}$/.test(id)) return jsonErr(400, 'bad_id', 'Id no válido');
    const r = await supa('GET', `proposals?id=eq.${id}&select=titulo,descripcion,categoria,estado,created_at,imagenes,contacto_nombre&limit=1`);
    const p = (r.json && r.json[0]) || null;
    if (!p) return jsonErr(404, 'not_found', 'Propuesta no encontrada');
    const c = await supa('GET', `proposal_vote_counts?proposal_id=eq.${id}&select=a_favor`);
    p.aFavor = (c.json && c.json[0] && c.json[0].a_favor) || 0;
    return jsonOk({ ok: true, propuesta: p });
  }

  // Limpiar propuestas rechazadas: archivar (se conserva, sale de la lista) o eliminar (definitivo).
  if (b.action === 'prop-archivar') {
    const id = String(b.id || '');
    if (!/^[0-9a-f-]{36}$/.test(id)) return jsonErr(400, 'bad_id', 'Id no válido');
    const r = await supa('PATCH', `proposals?id=eq.${id}`, { estado: 'archivada' });
    if (!r.ok) return jsonErr(502, 'db_error', 'No se pudo archivar');
    await audit('prop_archivar', 'proposals', id, {});
    return jsonOk({ ok: true });
  }
  if (b.action === 'prop-eliminar') {
    const id = String(b.id || '');
    if (!/^[0-9a-f-]{36}$/.test(id)) return jsonErr(400, 'bad_id', 'Id no válido');
    await supa('DELETE', `comments?proposal_id=eq.${id}`);
    await supa('DELETE', `votes?proposal_id=eq.${id}`);
    const r = await supa('DELETE', `proposals?id=eq.${id}`);
    if (!r.ok) return jsonErr(502, 'db_error', 'No se pudo eliminar');
    await audit('prop_eliminar', 'proposals', id, {});
    return jsonOk({ ok: true });
  }
  if (b.action === 'prop-desarchivar') {
    const id = String(b.id || '');
    if (!/^[0-9a-f-]{36}$/.test(id)) return jsonErr(400, 'bad_id', 'Id no válido');
    const r = await supa('PATCH', `proposals?id=eq.${id}`, { estado: 'rechazada' });
    if (!r.ok) return jsonErr(502, 'db_error', 'No se pudo desarchivar');
    await audit('prop_desarchivar', 'proposals', id, {});
    return jsonOk({ ok: true });
  }

  // Moderar una propuesta: cambia el estado Y avisa por correo al autor con la plantilla del partido.
  if (b.action === 'proposals-moderar') {
    const id = String(b.id || '');
    const estado = ['publicada', 'en_estudio', 'rechazada'].includes(b.estado) ? b.estado : null;
    if (!id || !estado) return jsonErr(400, 'bad_req', 'Acción no válida');
    const motivo = estado === 'rechazada' ? String(b.motivo || '').trim().slice(0, 1000) : null;
    if (estado === 'rechazada' && (motivo || '').length < 5) return jsonErr(400, 'no_motivo', 'Falta el motivo del rechazo');
    const r0 = await supa('GET', `proposals?id=eq.${encodeURIComponent(id)}&select=id,titulo,user_id,contacto_email,contacto_nombre`);
    const p = r0.json && r0.json[0];
    if (!p) return jsonErr(404, 'no_prop', 'Propuesta no encontrada');
    const up = await supa('PATCH', `proposals?id=eq.${encodeURIComponent(id)}`, { estado, motivo_rechazo: motivo });
    if (!up.ok) return jsonErr(502, 'db_error', 'No se pudo guardar: ' + (up.text || '').slice(0, 120));
    // destinatario: contacto_email o el email de la cuenta del autor
    let dest = p.contacto_email || null;
    let nombre = p.contacto_nombre || '';
    if (!dest && p.user_id) {
      try {
        const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
        const ur = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users/${p.user_id}`, { headers: { apikey: k, authorization: `Bearer ${k}` } });
        const uj = await ur.json().catch(() => ({}));
        const em = String(uj.email || '');
        if (em && !em.endsWith('@seed.acg') && !em.endsWith('@acgtest.local')) dest = em;
      } catch {}
    }
    if (!nombre && p.user_id) {
      const pr = await supa('GET', `profiles?id=eq.${p.user_id}&select=nombre`);
      nombre = (pr.json && pr.json[0] && pr.json[0].nombre) || '';
    }
    let emailed = false;
    if (dest) {
      const esc = (s2) => String(s2).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      const hola = `<p>Hola${nombre ? ' ' + esc(nombre) : ''},</p>`;
      const urlProp = `https://accioncivilgandia.netlify.app/propuesta-ciudadana?id=${p.id}`;
      const M = {
        publicada: {
          subj: 'Tu propuesta ya está publicada 🎉',
          title: '¡Propuesta publicada!',
          body: `${hola}<p>Tu propuesta <b>«${esc(p.titulo)}»</b> ha pasado la revisión y ya está publicada en la web: los vecinos ya pueden verla, apoyarla y comentarla.</p>${emailBtn(urlProp, 'Ver mi propuesta')}<p style="color:#8A99A8;font-size:13px">Gracias por participar en Acción Civil Gandia.</p>`,
        },
        en_estudio: {
          subj: 'Tu propuesta está en estudio',
          title: 'Propuesta en estudio',
          body: `${hola}<p>Hemos revisado tu propuesta <b>«${esc(p.titulo)}»</b> y la estamos estudiando con el equipo antes de publicarla. Te avisaremos por correo en cuanto haya una decisión.</p>${emailBtn('https://accioncivilgandia.netlify.app/cuenta', 'Ver estado en mi cuenta')}`,
        },
        rechazada: {
          subj: 'Sobre tu propuesta',
          title: 'Propuesta no publicada',
          body: `${hola}<p>Hemos revisado tu propuesta <b>«${esc(p.titulo)}»</b> y en esta ocasión no vamos a publicarla. Motivo:</p><div style="background:#F4F7FB;border:1px solid #E9EEF4;border-radius:10px;padding:14px 16px">${esc(motivo || '')}</div><p style="margin-top:14px">Puedes ajustarla y volver a enviarla cuando quieras: cada propuesta cuenta.</p>${emailBtn('https://accioncivilgandia.netlify.app/crear-propuesta', 'Enviar una nueva propuesta')}`,
        },
      }[estado];
      const sr = await sendEmail({ to: dest, subject: M.subj + ' — Acción Civil Gandia', html: emailShell({ title: M.title, body: M.body }), replyTo: 'accioncivilgandia@gmail.com' });
      emailed = !!sr.ok;
    }
    await audit('proposal_moderar', 'proposals', id, { estado, emailed });
    return jsonOk({ ok: true, emailed });
  }

  // Crear una propuesta ciudadana desde el panel (p. ej. recogida en mesa informativa).
  if (b.action === 'proposals-crear') {
    const titulo = String(b.titulo || '').trim().slice(0, 140);
    const descripcion = String(b.descripcion || '').trim().slice(0, 5000);
    const categoria = String(b.categoria || '').trim().slice(0, 60);
    const estado = b.estado === 'pendiente_moderacion' ? 'pendiente_moderacion' : 'publicada';
    if (titulo.length < 5) return jsonErr(400, 'incompleto', 'Título: mínimo 5 caracteres');
    if (descripcion.length < 30) return jsonErr(400, 'incompleto', 'Descripción: mínimo 30 caracteres');
    if (!categoria) return jsonErr(400, 'incompleto', 'Elige una categoría');
    const imagenes = (Array.isArray(b.imagenes) ? b.imagenes : [])
      .filter((u) => typeof u === 'string' && u.startsWith(`${process.env.SUPABASE_URL}/storage/`)).slice(0, 3);
    const row = {
      user_id: SYSTEM_CHAT_ID,             // cuenta oficial del partido
      titulo, descripcion, categoria,
      barrio_id: /^[0-9a-f-]{36}$/.test(String(b.barrioId || '')) ? b.barrioId : null,
      estado, imagenes,
      contacto_nombre: String(b.autor || '').trim().slice(0, 80) || null,
      contacto_email: String(b.email || '').trim().slice(0, 120) || null,
    };
    const r = await supa('POST', 'proposals', row);
    if (!r.ok) return jsonErr(502, 'db_error', 'No se pudo crear: ' + (r.text || '').slice(0, 140));
    await audit('proposal_crear', 'proposals', r.json?.[0]?.id, { estado });
    return jsonOk({ ok: true, id: r.json?.[0]?.id });
  }

  // Responder un contacto desde el panel: sale desde noticias@ con la plantilla del partido.
  if (b.action === 'contactos-reply') {
    const id = String(b.id || '');
    const texto = String(b.texto || '').trim().slice(0, 5000);
    if (!id || texto.length < 2) return jsonErr(400, 'incompleto', 'Escribe la respuesta');
    const r0 = await supa('GET', `contact_messages?id=eq.${encodeURIComponent(id)}&select=nombre,email,asunto`);
    const m = r0.json && r0.json[0];
    if (!m || !m.email) return jsonErr(404, 'no_msg', 'Mensaje no encontrado');
    const esc = (s2) => String(s2).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const sr = await sendEmail({
      to: m.email,
      subject: 'Re: ' + (m.asunto || 'Tu mensaje a Acción Civil Gandia'),
      replyTo: 'accioncivilgandia@gmail.com',
      html: emailShell({
        title: 'Respuesta a tu mensaje',
        body: `<p>Hola ${esc(m.nombre || '')},</p>
          <div style="background:#F4F7FB;border:1px solid #E9EEF4;border-radius:10px;padding:14px 16px">${esc(texto).replace(/\n/g, '<br>')}</div>
          <p style="color:#8A99A8;font-size:13px;margin:14px 0 0">Puedes responder directamente a este correo.</p>`,
      }),
    });
    if (!sr.ok) return jsonErr(502, 'email_error', 'No se pudo enviar la respuesta' + (sr.unconfigured ? ' (falta RESEND_API_KEY)' : ''));
    await supa('PATCH', `contact_messages?id=eq.${encodeURIComponent(id)}`, { estado: 'respondido' });
    await audit('contacto_responder', 'contact_messages', id, {});
    return jsonOk({ ok: true });
  }

  // ---- Suscriptores / leads (newsletter + opt-in marketing, desde Brevo) ----
  if (b.action === 'leads-list') {
    const key = process.env.BREVO_API_KEY;
    if (!key) return jsonErr(503, 'no_brevo', 'Newsletter (Brevo) no configurado todavía');
    const r = await fetch('https://api.brevo.com/v3/contacts?limit=500&sort=desc', { headers: { 'api-key': key, accept: 'application/json' } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return jsonErr(502, 'brevo_error', 'Error consultando Brevo: ' + JSON.stringify(j).slice(0, 120));
    const idEs = Number(process.env.BREVO_LIST_ID_ES), idVa = Number(process.env.BREVO_LIST_ID_VA);
    const exclId = await brevoExclusionList(key, false);
    const items = (j.contacts || []).map((c) => ({
      email: c.email,
      lang: (c.attributes && c.attributes.LANG) || (Array.isArray(c.listIds) && c.listIds.includes(idVa) ? 'va' : 'es'),
      alta: c.createdAt ? String(c.createdAt).slice(0, 10) : '',
      baja: !!c.emailBlacklisted,
      excluido: !!(exclId && Array.isArray(c.listIds) && c.listIds.includes(exclId)),
      fuente: (c.attributes && c.attributes.CONSENT_SOURCE) || '',
    }));
    return jsonOk({ ok: true, total: j.count != null ? j.count : items.length, items });
  }
  if (b.action === 'leads-excluir') {
    const key = process.env.BREVO_API_KEY;
    if (!key) return jsonErr(503, 'no_brevo', 'Newsletter (Brevo) no configurado todavía');
    const email = String(b.email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return jsonErr(400, 'bad_email', 'Email no válido');
    const exclId = await brevoExclusionList(key, true);
    if (!exclId) return jsonErr(502, 'brevo_error', 'No se pudo crear la lista de exclusiones en Brevo');
    const op = b.excluir ? 'add' : 'remove';
    const r = await fetch(`https://api.brevo.com/v3/contacts/lists/${exclId}/contacts/${op}`, {
      method: 'POST', headers: { 'api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({ emails: [email] }),
    });
    if (!r.ok) return jsonErr(502, 'brevo_error', 'Brevo: ' + (await r.text()).slice(0, 120));
    await audit(b.excluir ? 'newsletter_excluir' : 'newsletter_incluir', 'brevo', email, {});
    return jsonOk({ ok: true });
  }
  if (b.action === 'leads-send') {
    const key = process.env.BREVO_API_KEY;
    if (!key) return jsonErr(503, 'no_brevo', 'Newsletter (Brevo) no configurado todavía');
    const asunto = String(b.asunto || '').trim().slice(0, 150);
    const cuerpo = String(b.cuerpo || '').trim().slice(0, 20000);
    if (asunto.length < 3 || cuerpo.length < 5) return jsonErr(400, 'incompleto', 'Asunto y mensaje obligatorios');
    const bh = { 'api-key': key, accept: 'application/json', 'content-type': 'application/json' };
    // remitente verificado en Brevo
    const sres = await fetch('https://api.brevo.com/v3/senders', { headers: bh });
    const sj = await sres.json().catch(() => ({}));
    const sender = (sj.senders || []).find((s) => s.active && /@accioncivilgandia\.es$/i.test(s.email)) || (sj.senders || []).find((s) => s.active) || (sj.senders || [])[0];
    if (!sender) return jsonErr(400, 'no_sender', 'No hay remitente verificado en Brevo. Verifica uno en Brevo → Remitentes.');
    const aud = ['todos', 'es', 'va'].includes(b.audiencia) ? b.audiencia : 'todos';
    const idEs2 = Number(process.env.BREVO_LIST_ID_ES), idVa2 = Number(process.env.BREVO_LIST_ID_VA);
    const lists = (aud === 'es' ? [idEs2] : aud === 'va' ? [idVa2] : [idEs2, idVa2]).filter(Boolean);
    if (!lists.length) return jsonErr(400, 'no_list', 'No hay listas de Brevo configuradas');
    const exclId2 = await brevoExclusionList(key, false);
    const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const html = '<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#17232F;border:1px solid #E9EEF4;border-radius:12px;overflow:hidden">'
      + '<div style="background:#0A2A5E;color:#fff;padding:18px 22px;font-weight:bold;font-size:18px"><img src="https://accioncivilgandia.netlify.app/assets/icon-192.png" width="36" height="36" alt="" style="vertical-align:middle;border-radius:9px;background:#fff;margin-right:10px">Acción Civil Gandia</div>'
      + '<div style="padding:24px;font-size:15px;line-height:1.6">' + esc(cuerpo).replace(/\n/g, '<br>') + '</div>'
      + '<div style="padding:16px 22px;color:#8A99A8;font-size:12px;border-top:1px solid #eee">Recibes este correo porque te suscribiste a Acción Civil Gandia. <a href="{{ unsubscribe }}" style="color:#1563C4">Darse de baja</a>.</div></div>';
    const camp = await fetch('https://api.brevo.com/v3/emailCampaigns', {
      method: 'POST', headers: bh,
      body: JSON.stringify({ name: 'Panel: ' + asunto.slice(0, 40) + ' #' + Date.now(), subject: asunto, sender: { name: 'Acción Civil Gandia', email: sender.email }, htmlContent: html, recipients: { listIds: lists, ...(exclId2 ? { exclusionListIds: [exclId2] } : {}) } }),
    });
    const cj = await camp.json().catch(() => ({}));
    if (!camp.ok || !cj.id) return jsonErr(502, 'brevo_error', 'No se pudo crear la campaña: ' + JSON.stringify(cj).slice(0, 140));
    const snd = await fetch(`https://api.brevo.com/v3/emailCampaigns/${cj.id}/sendNow`, { method: 'POST', headers: bh });
    if (!snd.ok) return jsonErr(502, 'brevo_error', 'Creada pero no enviada: ' + (await snd.text()).slice(0, 140));
    await audit('newsletter_enviar', 'brevo', String(cj.id), { asunto });
    return jsonOk({ ok: true });
  }

  // ---- Registros web: personas que han creado cuenta en la web (Supabase Auth) ----
  if (b.action === 'registros-list') {
    const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
    // Cuentas técnicas (semillas de datos, pruebas, cuenta de sistema): NO son personas → se ocultan.
    const esSistema = (em) => {
      const e = String(em || '').toLowerCase();
      return /@seed\.acg$/.test(e) || /@acgtest\.local$/.test(e) || /@acg-test\.local$/.test(e)
        || /^sistema-oficial@/.test(e) || /^moderacion-test@/.test(e) || /^test_/.test(e) || /@acg\.test$/.test(e);
    };
    // 1) usuarios de auth (paginado)
    const users = [];
    for (let page = 1; page <= 10; page++) {
      const r = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=100`, { headers: { apikey: k, authorization: `Bearer ${k}` } });
      const j = await r.json().catch(() => ({}));
      const us = j.users || [];
      users.push(...us);
      if (us.length < 100) break;
    }
    // 2) perfiles (nombre, avatar, títulos/flags)
    const pr = await supa('GET', 'profiles?select=id,nombre,avatar_url,es_afiliado,es_donante,voluntariado,bloqueado');
    const pById = {};
    (pr.json || []).forEach((p) => { pById[p.id] = p; });
    const hoy = madridDayStart(0);
    let ocultas = 0;
    const items = [];
    for (const u of users) {
      if (esSistema(u.email)) { ocultas++; continue; }
      const p = pById[u.id] || {};
      const meta = u.user_metadata || {};
      items.push({
        id: u.id,
        nombre: p.nombre || meta.full_name || meta.name || '',
        email: u.email || '',
        avatar: (p.avatar_url && p.avatar_url !== 'none') ? p.avatar_url : '',
        via: (u.app_metadata && u.app_metadata.provider) || 'email',
        alta: u.created_at || '',
        afiliado: !!p.es_afiliado,
        donante: !!p.es_donante,
        voluntario: p.voluntariado || '',
        bloqueado: !!p.bloqueado,
        nuevoHoy: String(u.created_at || '') >= hoy,
      });
    }
    items.sort((a, b2) => String(b2.alta).localeCompare(String(a.alta)));   // más recientes primero
    return jsonOk({ ok: true, items, total: items.length, hoy: items.filter((x) => x.nuevoHoy).length, ocultas });
  }

  // ---- Cuotas mensuales de afiliados ----
  if (b.action === 'cuotas-periodo') {
    const periodo = String(b.periodo || '');
    if (!/^\d{4}-\d{2}$/.test(periodo)) return jsonErr(400, 'bad_periodo', 'Periodo no válido');
    const r = await supa('GET', `cuotas_pagos?periodo=eq.${periodo}&select=afiliado_id`);
    return jsonOk({ ok: true, pagados: (r.json || []).map((p) => p.afiliado_id) });
  }
  if (b.action === 'cuotas-registrar') {
    const periodo = String(b.periodo || '');
    if (!/^\d{4}-\d{2}$/.test(periodo)) return jsonErr(400, 'bad_periodo', 'Periodo no válido');
    const ids = Array.isArray(b.ids) ? b.ids.filter((x) => /^[0-9a-f-]{36}$/.test(x)) : [];
    if (!ids.length) return jsonErr(400, 'no_ids', 'Selecciona al menos un afiliado');
    const r = await supa('GET', `afiliados?id=in.(${ids.join(',')})&select=id,cuota,total`);
    const afs = r.json || [];
    const paid = await supa('GET', `cuotas_pagos?periodo=eq.${periodo}&afiliado_id=in.(${ids.join(',')})&select=afiliado_id`);
    const ya = new Set((paid.json || []).map((p) => p.afiliado_id));
    let registrados = 0, suma = 0;
    for (const a of afs) {
      const imp = Number(a.cuota || 0);
      if (ya.has(a.id) || imp <= 0) continue;
      const ins = await supa('POST', 'cuotas_pagos', { afiliado_id: a.id, periodo, importe: imp });
      if (!ins.ok) continue;
      await supa('PATCH', `afiliados?id=eq.${a.id}`, { total: Number(a.total || 0) + imp });
      registrados++; suma += imp;
    }
    if (suma > 0) {
      const [y, mm] = periodo.split('-');
      const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
      const concepto = `Cuotas afiliados (${meses[Number(mm) - 1]} ${y})`;
      const add = Math.round(suma * 100);
      // Una sola línea por mes: si ya existe, se le suma lo nuevo (confirmaciones en varias tandas).
      const ex = await supa('GET', `tesoreria?tipo=eq.ingreso&concepto=eq.${encodeURIComponent(concepto)}&select=id,importe_cents`);
      if (ex.ok && Array.isArray(ex.json) && ex.json.length) {
        await supa('PATCH', `tesoreria?id=eq.${ex.json[0].id}`, { importe_cents: ex.json[0].importe_cents + add });
      } else {
        await supa('POST', 'tesoreria', { fecha: `${periodo}-01`, tipo: 'ingreso', categoria: 'Cuotas', concepto, importe_cents: add });
      }
    }
    await audit('cuotas_registrar', 'afiliados', periodo, { registrados, suma });
    return jsonOk({ ok: true, registrados, suma });
  }
  if (b.action === 'cuotas-anular') {
    const periodo = String(b.periodo || '');
    if (!/^\d{4}-\d{2}$/.test(periodo)) return jsonErr(400, 'bad_periodo', 'Periodo no válido');
    const ids = Array.isArray(b.ids) ? b.ids.filter((x) => /^[0-9a-f-]{36}$/.test(x)) : [];
    if (!ids.length) return jsonErr(400, 'no_ids', 'Nada que anular');
    const pg = await supa('GET', `cuotas_pagos?periodo=eq.${periodo}&afiliado_id=in.(${ids.join(',')})&select=id,afiliado_id,importe`);
    const pagos = pg.json || [];
    if (!pagos.length) return jsonOk({ ok: true, anulados: 0, resta: 0 });
    const af = await supa('GET', `afiliados?id=in.(${pagos.map((p) => p.afiliado_id).join(',')})&select=id,total`);
    const tot = new Map((af.json || []).map((a) => [a.id, Number(a.total || 0)]));
    let anulados = 0, resta = 0;
    for (const p of pagos) {
      await supa('DELETE', `cuotas_pagos?id=eq.${p.id}`);
      await supa('PATCH', `afiliados?id=eq.${p.afiliado_id}`, { total: Math.max(0, (tot.get(p.afiliado_id) || 0) - Number(p.importe)) });
      anulados++; resta += Number(p.importe);
    }
    if (resta > 0) {
      const [y, mm] = periodo.split('-');
      const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
      const concepto = `Cuotas afiliados (${meses[Number(mm) - 1]} ${y})`;
      const ex = await supa('GET', `tesoreria?tipo=eq.ingreso&concepto=eq.${encodeURIComponent(concepto)}&select=id,importe_cents`);
      if (ex.ok && Array.isArray(ex.json) && ex.json.length) {
        const nuevo = ex.json[0].importe_cents - Math.round(resta * 100);
        if (nuevo > 0) await supa('PATCH', `tesoreria?id=eq.${ex.json[0].id}`, { importe_cents: nuevo });
        else await supa('DELETE', `tesoreria?id=eq.${ex.json[0].id}`);
      }
    }
    await audit('cuotas_anular', 'afiliados', periodo, { anulados, resta });
    return jsonOk({ ok: true, anulados, resta });
  }

  // ===== TIENDA (merchandising) =====
  if (b.action === 'productos-list') {
    const r = await supa('GET', 'products?select=*,product_variants(*)&order=orden.asc,created_at.desc');
    if (!r.ok) return jsonErr(502, 'db_error', 'No se pudo leer los productos: ' + (r.text || '').slice(0, 140));
    const items = (r.json || []).map((p) => ({
      ...p,
      product_variants: (p.product_variants || []).slice().sort((a, b2) => (a.orden || 0) - (b2.orden || 0)),
    }));
    return jsonOk({ ok: true, items });
  }
  if (b.action === 'producto-guardar') {
    const p = b.producto || {};
    const row = {};
    for (const k of ['slug', 'nombre_es', 'nombre_va', 'descripcion_es', 'descripcion_va', 'precio_cents', 'categoria', 'imagen_url', 'galeria', 'activo', 'destacado', 'orden']) {
      if (p[k] !== undefined) row[k] = p[k];
    }
    await autotraducir(row);                             // el idioma que falte (nombre/descripción) se traduce solo
    if (!row.slug) row.slug = slugify(row.nombre_es || row.nombre_va || 'producto') + '-' + Math.random().toString(36).slice(2, 6);
    let prodId = p.id;
    if (prodId) {
      const r = await supa('PATCH', `products?id=eq.${prodId}`, row);
      if (!r.ok) return jsonErr(502, 'db_error', 'No se pudo guardar el producto: ' + (r.text || '').slice(0, 140));
    } else {
      const r = await supa('POST', 'products', row);
      if (!r.ok) return jsonErr(502, 'db_error', 'No se pudo crear el producto: ' + (r.text || '').slice(0, 140));
      prodId = r.json?.[0]?.id;
    }
    if (!prodId) return jsonErr(502, 'db_error', 'Sin id de producto tras guardar');
    for (const vid of (b.borrarVariantes || [])) await supa('DELETE', `product_variants?id=eq.${vid}`);
    for (const v of (b.variantes || [])) {
      const vr = {
        talla: v.talla || null,
        sku: v.sku || null,
        stock: Number.isFinite(+v.stock) ? Math.max(0, Math.round(+v.stock)) : 0,
        precio_cents: (v.precio_cents === null || v.precio_cents === undefined || v.precio_cents === '') ? null : Math.round(+v.precio_cents),
        orden: Number.isFinite(+v.orden) ? +v.orden : 0,
      };
      if (v.id) await supa('PATCH', `product_variants?id=eq.${v.id}`, vr);
      else await supa('POST', 'product_variants', { ...vr, product_id: prodId });
    }
    await audit(p.id ? 'editar' : 'crear', 'products', prodId, {});
    const out = await supa('GET', `products?id=eq.${prodId}&select=*,product_variants(*)`);
    return jsonOk({ ok: true, item: out.json?.[0] || null });
  }
  if (b.action === 'producto-borrar') {
    await supa('DELETE', `product_variants?product_id=eq.${b.id}`);
    const r = await supa('DELETE', `products?id=eq.${b.id}`);
    if (!r.ok) return jsonErr(502, 'db_error', 'No se pudo borrar el producto');
    await audit('borrar', 'products', b.id, {});
    return jsonOk({ ok: true });
  }
  if (b.action === 'pedidos-list') {
    const filtro = b.estado && b.estado !== 'todos' ? `&estado=eq.${encodeURIComponent(b.estado)}` : '';
    const r = await supa('GET', `orders?select=*,order_items(*)${filtro}&order=created_at.desc&limit=200`);
    if (!r.ok) return jsonErr(502, 'db_error', 'No se pudo leer los pedidos: ' + (r.text || '').slice(0, 140));
    return jsonOk({ ok: true, items: r.json || [] });
  }
  if (b.action === 'pedido-estado') {
    const ESTADOS_OK = ['pendiente_pago', 'pagado', 'preparando', 'listo_recogida', 'enviado', 'entregado', 'cancelado'];
    if (!ESTADOS_OK.includes(b.estado)) return jsonErr(400, 'bad_estado', 'Estado de pedido no válido');
    const r = await supa('PATCH', `orders?id=eq.${b.id}`, { estado: b.estado });
    if (!r.ok) return jsonErr(502, 'db_error', 'No se pudo actualizar el pedido');
    const ped = r.json?.[0] || {};
    await audit('pedido_estado', 'orders', b.id, { estado: b.estado });
    // Aviso al comprador (best-effort; nunca para pendiente_pago)
    const MSG = {
      pagado: ['Hemos recibido tu pago', 'Hemos recibido tu pago correctamente y ya estamos preparando tu pedido.'],
      preparando: ['Estamos preparando tu pedido', 'Tu pedido está en preparación. Te avisaremos en cuanto esté listo.'],
      listo_recogida: ['Tu pedido está listo para recoger', 'Ya puedes pasar a recoger tu pedido por nuestra sede. Recuerda tu número de pedido.'],
      enviado: ['Tu pedido ha sido enviado', 'Tu pedido ya está de camino. En breve lo recibirás en la dirección indicada.'],
      entregado: ['Pedido entregado', '¡Gracias por tu compra y por apoyar a Acción Civil Gandia!'],
      cancelado: ['Tu pedido ha sido cancelado', 'Tu pedido ha sido cancelado. Si crees que es un error o tienes cualquier duda, escríbenos respondiendo a este correo.'],
    };
    const m = MSG[b.estado];
    const esc = (s) => String(s || '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
    if (m && ped.email) {
      sendEmail({
        to: ped.email,
        subject: m[0] + ' — Acción Civil Gandia',
        replyTo: process.env.CONTACT_INBOX || 'accioncivilgandia@gmail.com',
        html: emailShell({
          title: m[0],
          body: `<p>Hola${ped.nombre ? ' ' + esc(ped.nombre) : ''},</p><p>${m[1]}</p>`
            + `<p style="color:#5C6B7A;font-size:13px">Pedido <b>#${esc(ped.numero || ped.id || '')}</b> · Total ${((ped.total_cents || 0) / 100).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })}</p>`,
        }),
      }).catch(() => {});
    }
    return jsonOk({ ok: true, item: ped });
  }
  if (b.action === 'pedido-eliminar') {
    // Borrado definitivo de pedidos erróneos: solo si ya está cancelado, con motivo obligatorio (queda en audit_log)
    if (!b.id) return jsonErr(400, 'bad_id', 'Falta el id del pedido');
    const motivo = String(b.motivo || '').trim();
    if (!motivo) return jsonErr(400, 'bad_motivo', 'Indica el motivo del borrado');
    const pr = await supa('GET', `orders?id=eq.${b.id}&select=id,estado,numero,email,total_cents`);
    const ped = pr.json?.[0];
    if (!ped) return jsonErr(404, 'not_found', 'Pedido no encontrado');
    if (ped.estado !== 'cancelado') return jsonErr(400, 'not_cancelado', 'Solo se pueden eliminar pedidos ya cancelados. Cancélalo primero.');
    const dr = await supa('DELETE', `orders?id=eq.${b.id}`);   // order_items cae en cascada (FK on delete cascade)
    if (!dr.ok) return jsonErr(502, 'db_error', 'No se pudo eliminar el pedido');
    await audit('pedido_eliminar', 'orders', b.id, { motivo, numero: ped.numero, email: ped.email, total_cents: ped.total_cents });
    return jsonOk({ ok: true });
  }
  if (b.action === 'tienda-stats') {
    const ym = new Date().toLocaleDateString('sv', { timeZone: 'Europe/Madrid' }).slice(0, 7);
    const mesDesde = ym + '-01T00:00:00Z';
    const PAID = ['pagado', 'preparando', 'listo_recogida', 'enviado', 'entregado'];
    const ords = await supa('GET', 'orders?select=estado,total_cents,created_at&limit=2000');
    const list = Array.isArray(ords.json) ? ords.json : [];
    const pagados = list.filter((o) => PAID.includes(o.estado));
    const ingresosMesCents = pagados.filter((o) => String(o.created_at) >= mesDesde).reduce((s, o) => s + (o.total_cents || 0), 0);
    const porEstado = {};
    for (const o of list) porEstado[o.estado] = (porEstado[o.estado] || 0) + 1;
    const itr = await supa('GET', 'order_items?select=nombre,cantidad&limit=5000');
    const top = {};
    for (const it of (Array.isArray(itr.json) ? itr.json : [])) top[it.nombre || '—'] = (top[it.nombre || '—'] || 0) + (it.cantidad || 0);
    const topProductos = Object.entries(top).sort((a, b2) => b2[1] - a[1]).slice(0, 5).map(([nombre, unidades]) => ({ nombre, unidades }));
    return jsonOk({ ok: true, data: {
      pedidosTotal: list.length, ingresosMesCents,
      pendientes: (porEstado.pagado || 0) + (porEstado.preparando || 0), porEstado, topProductos,
    } });
  }

  const cfg = TABLAS[b.tabla];
  if (!['barrios', 'sync-titulos'].includes(b.action) && !cfg) return jsonErr(400, 'bad_table', 'Tabla no permitida');

  if (b.action === 'barrios') {
    const r = await supa('GET', 'barrios?select=id,slug,nombre_es&order=orden.asc,nombre_es.asc');
    return jsonOk({ ok: true, items: r.json || [] });
  }
  if (b.action === 'sync-titulos') {
    // Recalcula es_donante (por email de donaciones pagadas) y es_afiliado (members activos) en todas las cuentas.
    const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const emailToId = {};
    for (let page = 1; page <= 30; page++) {
      const rr = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=100`, { headers: { apikey: k, authorization: `Bearer ${k}` } });
      const jj = await rr.json().catch(() => ({}));
      const us = jj.users || [];
      for (const u of us) if (u.email) emailToId[String(u.email).toLowerCase()] = u.id;
      if (us.length < 100) break;
    }
    const donIds = new Set();
    for (const d of (await supa('GET', 'donations?estado=eq.pagada&select=donor_email&limit=10000')).json || []) {
      const id = emailToId[String(d.donor_email || '').toLowerCase()]; if (id) donIds.add(id);
    }
    // Afiliados REALES = suscripciones de Stripe activas, casadas por email de cuenta (+ members activos como respaldo).
    const afiIds = new Set();
    const afiEmails = new Set();
    const sk = process.env.STRIPE_SECRET_KEY;
    if (sk) {
      const sr = await fetch('https://api.stripe.com/v1/subscriptions?status=all&limit=100&expand[]=data.customer', { headers: { authorization: 'Bearer ' + sk } }).then((x) => x.json()).catch(() => ({}));
      for (const s of (sr.data || [])) {
        if (['canceled', 'incomplete_expired', 'incomplete'].includes(s.status)) continue;
        const em = (s.customer && s.customer.email) || (s.metadata && s.metadata.email) || '';
        if (em) afiEmails.add(String(em).toLowerCase());
      }
    }
    for (const [em, id] of Object.entries(emailToId)) if (afiEmails.has(em)) afiIds.add(id);
    for (const m of (await supa('GET', 'members?estado=eq.activo&select=user_id&limit=10000')).json || []) {
      if (m.user_id) afiIds.add(m.user_id);
    }
    let cambiados = 0;
    for (const p of (await supa('GET', 'profiles?select=id,es_donante,es_afiliado&limit=10000')).json || []) {
      const d = donIds.has(p.id), a = afiIds.has(p.id);
      if (d !== !!p.es_donante || a !== !!p.es_afiliado) { await supa('PATCH', `profiles?id=eq.${p.id}`, { es_donante: d, es_afiliado: a }); cambiados++; }
    }
    await audit('sync_titulos', 'profiles', '', { donantes: donIds.size, afiliados: afiIds.size, cambiados });
    return jsonOk({ ok: true, donantes: donIds.size, afiliados: afiIds.size, cambiados });
  }
  if (b.action === 'list') {
    let sel = cfg.select;
    let r = await supa('GET', `${b.tabla}?select=${sel}&order=${cfg.orden}&limit=200`);
    if (!r.ok && sel.includes('imagen_vertical')) {   // columna aún sin migrar → reintenta sin ella
      sel = sel.replace(',imagen_vertical', '');
      r = await supa('GET', `${b.tabla}?select=${sel}&order=${cfg.orden}&limit=200`);
    }
    if (!r.ok) return jsonErr(502, 'db_error', 'Error leyendo ' + b.tabla);
    return jsonOk({ ok: true, items: r.json });
  }
  if (b.action === 'save' && b.tabla === 'voluntarios') return await guardarVoluntario(b);
  if (b.action === 'del' && b.tabla === 'voluntarios') {
    const g = await supa('GET', `voluntarios?id=eq.${b.id}&select=user_id`);
    const uid = ((g.json || [])[0] || {}).user_id;
    const r = await supa('DELETE', `voluntarios?id=eq.${b.id}`);
    if (!r.ok) return jsonErr(502, 'db_error', 'No se pudo borrar');
    if (uid) {   // ¿le quedan otros voluntariados activos? si no, retira el título
      const other = await supa('GET', `voluntarios?user_id=eq.${uid}&activo=eq.true&select=tipo&limit=1`);
      await supa('PATCH', `profiles?id=eq.${uid}`, { voluntariado: ((other.json || [])[0] || {}).tipo || null }).catch(() => {});
    }
    await audit('borrar', 'voluntarios', b.id, {});
    return jsonOk({ ok: true });
  }
  if (b.action === 'save') {
    if (cfg.soloLeer) return jsonErr(403, 'read_only', 'Tabla de solo lectura');
    const row = {};
    for (const c of cfg.campos) if (b.row[c] !== undefined) row[c] = b.row[c];
    await autotraducir(row);                          // el idioma que falte se traduce solo
    // Reintento sin imagen_vertical si esa columna aún no existe (migración pendiente).
    const _sinVert = () => { if ('imagen_vertical' in row) { delete row.imagen_vertical; return true; } return false; };
    if (b.row.id) {                                    // editar
      let r = await supa('PATCH', `${b.tabla}?id=eq.${b.row.id}`, row);
      if (!r.ok && _sinVert()) r = await supa('PATCH', `${b.tabla}?id=eq.${b.row.id}`, row);
      if (!r.ok) return jsonErr(502, 'db_error', 'No se pudo guardar: ' + (r.text || '').slice(0, 140));
      await audit('editar', b.tabla, b.row.id, { campos: Object.keys(row) });
      return jsonOk({ ok: true, item: r.json?.[0] });
    }
    if (cfg.soloEditar) return jsonErr(403, 'edit_only', 'En esta tabla solo se puede editar');
    if (cfg.slugDe && !row.slug) row.slug = slugify(b.row[cfg.slugDe]) + '-' + Math.random().toString(36).slice(2, 6);
    if (b.tabla === 'posts' && row.estado === 'publicado' && !row.publicado_at) row.publicado_at = new Date().toISOString();
    let r = await supa('POST', b.tabla, row);
    if (!r.ok && _sinVert()) r = await supa('POST', b.tabla, row);
    if (!r.ok) return jsonErr(502, 'db_error', 'No se pudo crear: ' + (r.text || '').slice(0, 140));
    await audit('crear', b.tabla, r.json?.[0]?.id, {});
    return jsonOk({ ok: true, item: r.json?.[0] });
  }
  if (b.action === 'del') {
    if (!cfg.borrable) return jsonErr(403, 'no_delete', 'Esta tabla no permite borrar');
    const r = await supa('DELETE', `${b.tabla}?id=eq.${b.id}`);
    if (!r.ok) return jsonErr(502, 'db_error', 'No se pudo borrar');
    await audit('borrar', b.tabla, b.id, {});
    return jsonOk({ ok: true });
  }
  return jsonErr(400, 'bad_action', 'Acción desconocida');
}

// ---------- App HTML ----------
const APP = `<!doctype html><html lang="es"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Panel — Acción Civil Gandia</title>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@800&family=Fraunces:opsz,wght@9..144,700;9..144,800&family=Public+Sans:wght@400;600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box}body{margin:0;font-family:Public Sans,sans-serif;background:#EEF3F9;color:#17232F;line-height:1.5}
.top{background:linear-gradient(90deg,#0A2A5E,#123a72);color:#fff;padding:11px 22px;display:flex;align-items:center;gap:13px;box-shadow:0 2px 14px rgba(7,30,69,.22);position:sticky;top:0;z-index:50}
.top b{font-family:Bricolage Grotesque;font-size:17px;letter-spacing:.2px}
.toplogo{width:34px;height:34px;object-fit:contain;background:#fff;border-radius:9px;padding:3px;flex-shrink:0}
.wrap{display:flex;min-height:calc(100vh - 56px)}
.side{width:216px;background:#fff;border-right:1px solid #E7EDF4;padding:12px 10px;flex-shrink:0}
.side button{display:flex;align-items:center;gap:10px;width:100%;text-align:left;border:none;background:none;cursor:pointer;font:600 13.5px Public Sans;color:#42525F;padding:10px 12px;border-radius:10px;margin-bottom:2px;transition:background .14s,color .14s}
.side button:hover{background:#F1F5FA;color:#0A2A5E}
.side button.on{color:#0A2A5E;background:#EAF1FB;font-weight:700}
.side .ic{font-size:15px;width:20px;text-align:center;flex-shrink:0}
.side .badge{margin-left:auto;background:#E23B3B;color:#fff;font:800 10.5px Public Sans;min-width:18px;height:18px;border-radius:9px;display:inline-flex;align-items:center;justify-content:center;padding:0 5px}
.main{flex:1;padding:26px;min-width:0}
.page{max-width:1120px;margin:0 auto;width:100%}
.prev{background:#F7FAFD;border:1px solid #E9EEF4;border-radius:16px;padding:18px;margin-top:20px}
.editwrap{display:grid;grid-template-columns:minmax(330px,440px) minmax(0,1fr);gap:20px;align-items:start}
.editwrap .form{margin-top:0}
.editwrap .prev{margin-top:0;position:sticky;top:70px;max-height:calc(100vh - 92px);overflow-y:auto}
@media(max-width:1080px){.editwrap{grid-template-columns:1fr}.editwrap .prev{position:static;max-height:none}}
.prevhead{display:flex;align-items:center;justify-content:space-between;font:700 12px Public Sans;text-transform:uppercase;letter-spacing:.08em;color:#5C6B7A;margin-bottom:14px}
.ptab{border:1.5px solid #E4EBF2;background:#fff;color:#5C6B7A;font:700 12px Public Sans;padding:5px 14px;border-radius:999px;cursor:pointer;margin-left:6px}
.ptab.on{background:#0A2A5E;color:#F5B942;border-color:#0A2A5E}
.drop{border:2px dashed #C9D6E4;border-radius:12px;padding:18px;text-align:center;color:#5C6B7A;font-size:13px;cursor:pointer;background:#FAFCFE;transition:border-color .2s,background .2s}
.drop.over{border-color:#1563C4;background:#EAF3FC}
.drop img{max-height:110px;border-radius:8px;display:block;margin:0 auto 8px}
.wixbar{position:sticky;top:56px;z-index:40;background:#0B1F3F;border-radius:14px;padding:10px 14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;box-shadow:0 10px 26px rgba(7,30,69,.28);margin-bottom:16px}
.wixbar .btn{margin:0}
.wixbar select,.wixbar input[type=date],.wixbar input[type=time],.wixbar input[type=number]{background:#12294E;color:#fff;border:1px solid #2C4A7C;border-radius:8px;padding:7px 10px;font:600 12.5px Public Sans}
.wixbar label{color:#9FB2CC;font:700 10px Public Sans;text-transform:uppercase;letter-spacing:.06em;display:flex;flex-direction:column;gap:3px}
.wixpage{background:#fff;border:1px solid #E9EEF4;border-radius:18px;overflow:hidden;box-shadow:0 14px 40px rgba(10,42,94,.10)}
.ed{outline:none;cursor:text;border-radius:6px;transition:box-shadow .15s}
.ed:hover{box-shadow:0 0 0 2px rgba(246,190,24,.5)}
.ed:focus{box-shadow:0 0 0 2px #F6BE18;background:rgba(246,190,24,.07)}
.ed:empty::before{content:attr(data-ph);color:#9AA8B8;font-style:italic;pointer-events:none}
.wixpage .ed:empty{min-height:1.2em;display:block}
.wiximg{position:relative;cursor:pointer}
.wiximg .cam{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(10,42,94,.38);color:#fff;font:700 13px Public Sans;opacity:0;transition:opacity .15s}
.wiximg:hover .cam{opacity:1}
.wixadd{border:2px dashed #C9D6E4;background:#FAFCFE;color:#5C6B7A;font:700 12.5px Public Sans;border-radius:10px;padding:9px 14px;cursor:pointer;margin-top:4px}
.wixadd:hover{border-color:#1563C4;color:#1563C4}
.wixadd.over{border-color:#1563C4;background:#EAF3FC;color:#1563C4}
.wixdel{border:none;background:#FBECEC;color:#D24B4B;font:800 13px Public Sans;border-radius:8px;width:26px;height:26px;cursor:pointer;flex-shrink:0}
.lng{border:1.5px solid rgba(255,255,255,.28);background:none;color:#cdd9ec;font:700 12px Public Sans;padding:5px 12px;border-radius:999px;cursor:pointer;transition:background .15s}
.lng:hover{background:rgba(255,255,255,.12)}
.lng.on{background:#F6BE18;color:#0A2A5E;border-color:#F6BE18}
h2{font-family:Bricolage Grotesque;color:#0A2A5E;margin:0 0 4px;font-size:25px}
.sub{color:#5C6B7A;font-size:13.5px;margin:0 0 18px}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #E9EEF4;border-radius:14px;overflow:hidden;box-shadow:0 2px 12px rgba(10,42,94,.05)}
th{font:700 11.5px Public Sans;text-transform:uppercase;letter-spacing:.08em;color:#5C6B7A;text-align:left;padding:11px 14px;border-bottom:1px solid #E9EEF4;background:#FAFCFE}
td{padding:11px 14px;border-bottom:1px solid #F1F4F8;font-size:14px;vertical-align:top}
tr:hover td{background:#F7FAFD;cursor:pointer}
.pill{display:inline-block;font:700 11px Public Sans;padding:3px 10px;border-radius:999px}
.btn{border:none;cursor:pointer;background:#1563C4;color:#fff;font:700 14px Public Sans;padding:11px 20px;border-radius:10px;box-shadow:0 2px 8px rgba(21,99,196,.2);transition:filter .15s,transform .1s}
.btn:hover{filter:brightness(1.06)}.btn:active{transform:translateY(1px)}
.btn.gold{background:#F6BE18;color:#0A2A5E;box-shadow:0 2px 8px rgba(246,190,24,.28)}
.btn.ghost{background:#fff;color:#C0392B;border:1.5px solid #F0D5D0;box-shadow:none}
.btn.sm{padding:6px 12px;font-size:12.5px}
label{display:block;font:600 12.5px Public Sans;color:#42525F;margin:13px 0 5px}
input,select,textarea{width:100%;border:1.5px solid #E1E8F1;border-radius:10px;padding:10px 12px;font:400 14px Public Sans;outline:none;background:#fff;transition:border-color .15s,box-shadow .15s}
input:focus,select:focus,textarea:focus{border-color:#1563C4;box-shadow:0 0 0 3px rgba(21,99,196,.12)}
textarea{min-height:90px;resize:vertical}
.form{background:#fff;border:1px solid #E9EEF4;border-radius:16px;padding:22px;max-width:760px;margin:14px auto 0;box-shadow:0 6px 24px rgba(10,42,94,.08)}
.row2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.stats{display:flex;gap:14px;margin-bottom:16px;flex-wrap:wrap}
.stat{background:#fff;border:1px solid #E9EEF4;border-radius:14px;padding:14px 20px;min-width:150px}
.stat b{font:800 22px Bricolage Grotesque;display:block}
.msg{margin-top:12px;font-weight:600}
.warn{color:#C0392B;font-weight:700}
/* Panel de inicio */
.dash{display:flex;flex-wrap:wrap;gap:14px;margin-bottom:8px;justify-content:center}
.dash .dcard{flex:1 1 calc((100% - 28px)/3);max-width:calc((100% - 28px)/3);min-width:200px}
@media (max-width:760px){.dash .dcard{max-width:100%;flex-basis:calc(50% - 7px)}}
.acgbar:hover{filter:brightness(1.3)}
.dcard{background:#fff;border:1px solid #E7EDF4;border-radius:16px;padding:18px 20px;box-shadow:0 3px 14px rgba(10,42,94,.05);transition:transform .13s,box-shadow .13s;position:relative}
.dcard[data-go]{cursor:pointer}
.dcard:hover{transform:translateY(-2px);box-shadow:0 8px 22px rgba(10,42,94,.10)}
.dcard .ic{font-size:17px;position:absolute;top:16px;right:16px;opacity:.85}
.dcard .n{font:800 30px Bricolage Grotesque;color:#0A2A5E;line-height:1.05;padding-right:26px}
.dcard .l{color:#5C6B7A;font-size:12.5px;margin-top:7px;font-weight:600}
.dcard.alert{background:#FEF6F6;border-color:#F6D8D8}.dcard.alert .n{color:#C0392B}
.dcard.good .n{color:#1E7A45}
.dgo{display:inline-block;margin-top:9px;font:700 12px Public Sans;color:#1563C4;text-decoration:none;cursor:pointer}
.aldia{display:flex;align-items:center;gap:12px;background:#E7F4EC;border:1px solid #CBE8D5;border-radius:14px;padding:14px 18px;color:#1E7A45;font:700 14px Public Sans;margin-bottom:8px}
.modcard{background:#fff;border:1px solid #F0E1BE;border-left:5px solid #F6BE18;border-radius:14px;padding:18px 20px;margin-bottom:14px;box-shadow:0 3px 14px rgba(10,42,94,.06)}
.modcard h4{font:800 16.5px Bricolage Grotesque;color:#0A2A5E;margin:0 0 6px}
.modcard .meta{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px;color:#8A99A8;font-size:12px}
.modcard .desc{background:#F7FAFD;border:1px solid #E9EEF4;border-radius:10px;padding:12px 14px;font-size:13.5px;color:#33414F;line-height:1.6;margin-bottom:12px;white-space:pre-wrap}
.dcard a{color:#1563C4;font-weight:700;text-decoration:none;font-size:12.5px;display:inline-block;margin-top:9px}
.dcard a:hover{text-decoration:underline}
/* Chat comunidad */
.chat{background:#fff;border:1px solid #E7EDF4;border-radius:16px;padding:16px;height:58vh;overflow-y:auto;display:flex;flex-direction:column;gap:10px;box-shadow:0 3px 14px rgba(10,42,94,.05)}
.bub{max-width:78%;padding:9px 13px;border-radius:14px;font-size:14px;position:relative}
.bub .a{font:700 11px Public Sans;opacity:.75;margin-bottom:3px}
.bub.mine{align-self:flex-end;background:#0A2A5E;color:#fff;border-bottom-right-radius:5px}
.bub.other{align-self:flex-start;background:#F0F4F9;color:#17232F;border-bottom-left-radius:5px}
.bub.off{opacity:.55}
.bub .x{cursor:pointer;font-size:11px;font-weight:700;margin-left:8px;text-decoration:underline;opacity:.8}
.chatbar{display:flex;gap:10px;margin-top:14px}.chatbar input{flex:1;margin:0}
/* Contactos */
.cm{background:#fff;border:1px solid #E7EDF4;border-radius:14px;padding:16px 18px;margin-bottom:12px;box-shadow:0 2px 10px rgba(10,42,94,.04)}
.cm .h{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px}
.cm .h b{color:#0A2A5E}.cm .em{color:#1563C4;font-size:13px}
.cm .t{color:#33414F;font-size:14px;white-space:pre-wrap;margin:6px 0 12px}
.cm .acts{display:flex;gap:8px;flex-wrap:wrap}
#login{position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;padding:20px;background:radial-gradient(circle at 28% 18%,#1a4a8c,#0A2A5E 55%,#061B3E)}
.loginbox{width:100%;max-width:390px;background:#fff;border-radius:24px;padding:40px 34px;text-align:center;box-shadow:0 40px 90px rgba(0,0,0,.4)}
.loginbox h2{font-size:26px;margin-bottom:4px}
.loginbox input{margin-bottom:12px;text-align:center;font-size:15px}
.loginlogo{width:66px;height:66px;object-fit:contain;display:block;margin:0 auto 16px;background:#0A2A5E;border-radius:18px;padding:8px}
.burger{display:none;background:rgba(255,255,255,.16);border:none;color:#fff;font-size:19px;width:38px;height:38px;border-radius:10px;cursor:pointer;align-items:center;justify-content:center;flex-shrink:0;line-height:1;padding:0}
.sidebd{display:none}
@media(max-width:820px){
 body.authed .burger{display:inline-flex}
 .top{padding:10px 14px;gap:10px}
 .side{position:fixed;top:55px;left:0;bottom:0;width:238px;max-width:80vw;z-index:60;transform:translateX(-100%);transition:transform .22s ease;overflow-y:auto;box-shadow:0 24px 60px rgba(7,30,69,.30)}
 .side.open{transform:none}
 .sidebd{display:block;position:fixed;inset:55px 0 0 0;background:rgba(7,30,69,.42);z-index:55;opacity:0;pointer-events:none;transition:opacity .2s}
 .sidebd.on{opacity:1;pointer-events:auto}
 .main{padding:16px 14px}
 .page{max-width:100%}
 h2{font-size:21px}
 #topsub{display:none}
 .lng{padding:5px 9px}
 #out{padding:7px 11px!important}
 .row2{grid-template-columns:1fr}
 .form{padding:16px}
 .stat{min-width:calc(50% - 7px)}
 .chat{height:60vh}
 .bub{max-width:86%}
 table:not(.crud){display:block;overflow-x:auto;-webkit-overflow-scrolling:touch}
}
@media(max-width:640px){
 table.crud{display:block;border:none;background:none;box-shadow:none;border-radius:0}
 table.crud thead{display:none}
 table.crud tbody{display:block}
 table.crud tr{display:block;background:#fff;border:1px solid #E9EEF4;border-radius:12px;padding:4px 2px;margin-bottom:10px;box-shadow:0 2px 8px rgba(10,42,94,.05)}
 table.crud tr:hover td{background:none}
 table.crud td{display:flex;justify-content:space-between;gap:14px;align-items:center;text-align:right;padding:8px 13px;border:none;border-bottom:1px solid #F2F5F9;font-size:13.5px}
 table.crud tr td:last-child{border-bottom:none}
 table.crud td::before{content:attr(data-label);font:700 11px Public Sans;color:#5C6B7A;text-transform:uppercase;letter-spacing:.03em;text-align:left;flex:0 0 auto;white-space:nowrap}
 table.crud td:empty{display:none}
}
</style><link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"><script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script></head><body>
<div class="top"><button class="burger" id="burger" aria-label="Menú">☰</button><img src="/assets/logo-icon.webp" alt="" class="toplogo"><b>Acción Civil</b><span id="topsub" style="font-size:13px;color:#a9bcd8">Administración de contenidos</span>
<span style="margin-left:auto"></span>
<button class="lng" id="lng_es">ES</button><button class="lng" id="lng_va">VA</button><button id="out" class="btn ghost" style="display:none;padding:7px 14px;font-size:12.5px">Salir</button></div>
<div id="login"><div class="loginbox">
<img src="/assets/logo-icon.webp" alt="Acción Civil" class="loginlogo">
<h2>Acceso</h2><p class="sub">Panel del equipo de Acción Civil</p>
<input id="pw" type="password" placeholder="Contraseña">
<input id="otp" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="Código 2FA (si está activado)">
<button class="btn" style="width:100%" onclick="login()">Entrar</button><div id="lmsg" class="msg"></div></div></div>
<div class="wrap" id="app" style="display:none"><nav class="side" id="tabs"></nav><div class="sidebd" id="sidebd"></div><main class="main" id="main"></main></div>
<script>
const $=q=>document.querySelector(q);
let TOKEN=sessionStorage.getItem('acg_admin')||'';
let LANG=localStorage.getItem('acg_admin_lang')||'es';
const TT={
 es:{panel:'Administración de contenidos',acceso:'Acceso',accesoSub:'Panel del equipo de Acción Civil',entrar:'Entrar',salir:'Salir',nuevo:'+ Nuevo',nuevoReg:'Nuevo registro',editar:'Editar',guardar:'Guardar',borrar:'Borrar',cancelar:'Cancelar',guardado:'Guardado ✓',cargando:'Cargando…',sinReg:'Sin registros todavía.',confirmBorrar:'¿Borrar definitivamente este registro?',vista:'Vista previa',ingresos:'Ingresos',gastos:'Gastos',saldo:'Saldo',noBorrar:'No se pudo borrar',sinTitulo:'(sin título)',arrastra:'Arrastra una imagen aquí o haz clic para elegirla (PC o móvil)',subiendo:'Subiendo imagen…',cambiar:'Imagen subida ✓ — haz clic para cambiarla',guardando:'Guardando… (traduciendo lo que falte)',autotrad:'Escribe solo en un idioma si quieres: el otro se traduce automáticamente al guardar. Revísalo después.',anadirItem:'+ Añadir',mapaHint:'Pincha en el mapa o arrastra el marcador para fijar la ubicación.',sinPunto:'Sin ubicación fijada'},
 va:{panel:"Administració de continguts",acceso:"Accés",accesoSub:"Panell de l'equip d'Acció Civil",entrar:'Entrar',salir:'Eixir',nuevo:'+ Nou',nuevoReg:'Nou registre',editar:'Editar',guardar:'Guardar',borrar:'Esborrar',cancelar:"Cancel·lar",guardado:'Guardat ✓',cargando:'Carregant…',sinReg:'Sense registres encara.',confirmBorrar:"Segur que vols esborrar definitivament este registre?",vista:'Vista prèvia',ingresos:'Ingressos',gastos:'Despeses',saldo:'Saldo',noBorrar:"No s'ha pogut esborrar",sinTitulo:'(sense títol)',arrastra:'Arrossega una imatge ací o fes clic per triar-la (PC o mòbil)',subiendo:'Pujant imatge…',cambiar:'Imatge pujada ✓ — fes clic per canviar-la',guardando:'Guardant… (traduint el que falte)',autotrad:"Escriu només en un idioma si vols: l'altre es tradueix automàticament en guardar. Revisa-ho després.",anadirItem:'+ Afegir',mapaHint:'Fes clic al mapa o arrossega el marcador per fixar la ubicació.',sinPunto:'Sense ubicació fixada'}};
const T=k=>TT[LANG][k]||TT.es[k]||k;
const F_VA={
 inicio:['Inici',"Resum de l'estat del web i la comunitat."],
 comunidad:['Comunitat',"Xat de la comunitat. Respons com a compte oficial i moderes missatges."],
 contactos:['Contactes','Missatges rebuts pel formulari de Contacte.'],
 leads:['Subscriptors','Persones subscrites al newsletter i amb opt-in de màrqueting (des de Brevo).'],
 registros:['Registres web','Persones que han creat un compte a la web (Supabase Auth). Ací els veus créixer.'],
 posts:['Notícies i blog',"Actualitat, comunicats, vídeos i entrevistes. El que es publica apareix al web a l'instant."],
 events:['Agenda','Actes i esdeveniments. Estat "publicado" perquè isquen al web.'],
 campaigns:['Campanyes','La campanya amb "destacada" activada és la que ix a la Home.'],
 actuaciones:['Actuacions',"Accions per barri. Ixen a Acció a Gandia i al mapa de la Home."],
 equipo:['Equip','Junta directiva que apareix a Equip i Coneix-nos, per ordre.'],
 voluntarios:['Voluntaris','Xarxa de barris. Quan algú contacte per a ser voluntari/a, dóna’l d’alta ací: ix a Equip → «Xarxa de barris».'],
 tesoreria:['Tresoreria',"Ingressos i despeses. La pàgina pública de Transparència s'actualitza amb estes dades."],
 afiliados:['Afiliats','Registre intern de persones afiliades i les seues quotes. Dades privades: no ixen a la web.'],
 proposals:['Propostes ciutadanes','Moderació: publica, marca en estudi o rebutja (amb motiu). El que es publique eixirà a Participació.'],
 comments:['Comentaris','Moderació de comentaris en propostes (Fase 3).'],
 reportes:['Denúncies de propostes','Propostes que la gent ha denunciat. Revisa-les i, si cal, oculta/esborra des de «Propostes ciutadanes».'],
 denuncias:['Canal de denúncies',"⚠ Llei 2/2023: justificant de recepció en 7 dies i resolució en 3 mesos. La resposta la veu l'informant amb el seu codi."],
 members_inbox:['Afiliacions',"Altes pagades via Stripe (s'activa en Fase 4)."],
 donations:['Donacions','Donacions rebudes (Fase 4). Export complet per al Tribunal de Comptes.'],
 tienda:['Botiga','Productes de marxandatge i comandes de la botiga en línia.']};
const FT=k=>LANG==='va'&&F_VA[k]?F_VA[k][0]:F[k].titulo;
const FD=k=>LANG==='va'&&F_VA[k]?F_VA[k][1]:F[k].desc;
function setLang(l){LANG=l;localStorage.setItem('acg_admin_lang',l);chrome_();if(TOKEN&&$('#app').style.display!=='none'){$('#tabs').innerHTML=ORDEN.map(k=>'<button data-t="'+k+'"><span class="ic">'+(ICONS[k]||'•')+'</span>'+FT(k)+'</button>').join('');render();}}
function chrome_(){
  $('#topsub').textContent=T('panel');$('#out').textContent=T('salir');
  $('#lng_es').classList.toggle('on',LANG==='es');$('#lng_va').classList.toggle('on',LANG==='va');
  const lt=$('#login h2'),ls=$('#login .sub'),lb=$('#login .btn');
  if(lt){lt.textContent=T('acceso');ls.textContent=T('accesoSub');lb.textContent=T('entrar');}
}
const EUR=c=>(c/100).toLocaleString('es-ES',{style:'currency',currency:'EUR'});
const CATS_TES={ingreso:['Cuotas','Donaciones','Actos y lotería','Subvenciones','Otros ingresos'],gasto:['Alquiler local','Material y cartelería','Actos','Servicios y web','Gestoría','Otros gastos']};
const ESTADOS={borrador:['#FBF0DC','#9A6208'],publicado:['#E7F4EC','#1E7A45'],archivado:['#EEF2F7','#5C6B7A'],cancelado:['#FDEAEA','#C0392B'],activa:['#E7F4EC','#1E7A45'],finalizada:['#EEF2F7','#5C6B7A'],propuesta:['#FBF0DC','#9A6208'],en_curso:['#EAF3FC','#1563C4'],completada:['#E7F4EC','#1E7A45'],pendiente_moderacion:['#FBF0DC','#9A6208'],publicada:['#E7F4EC','#1E7A45'],rechazada:['#FDEAEA','#C0392B'],en_estudio:['#EAF3FC','#1563C4'],aprobada:['#E7F4EC','#1E7A45'],archivada:['#EEF2F7','#5C6B7A'],nueva:['#FDEAEA','#C0392B'],en_tramite:['#EAF3FC','#1563C4'],cerrada:['#E7F4EC','#1E7A45'],ingreso:['#E7F4EC','#1E7A45'],gasto:['#FDEAEA','#C0392B'],activo:['#E7F4EC','#1E7A45'],pagada:['#E7F4EC','#1E7A45'],nuevo:['#FDEAEA','#C0392B'],leido:['#EAF3FC','#1563C4'],respondido:['#E7F4EC','#1E7A45'],baja:['#EEF2F7','#5C6B7A']};
const pill=v=>{const c=ESTADOS[v]||['#EEF2F7','#5C6B7A'];return '<span class="pill" style="background:'+c[0]+';color:'+c[1]+'">'+(v||'—').replace(/_/g,' ')+'</span>'};

const F={ // definición de formularios por pestaña
 inicio:{titulo:'Inicio',desc:'Resumen del estado de la web y la comunidad.',cols:[],campos:[]},
 comunidad:{titulo:'Comunidad',desc:'Chat de la comunidad. Respondes como cuenta oficial y moderas mensajes.',cols:[],campos:[]},
 contactos:{titulo:'Contactos',desc:'Mensajes recibidos por el formulario de Contacto.',cols:[],campos:[]},
 leads:{titulo:'Suscriptores',desc:'Personas suscritas al newsletter y con opt-in de marketing (desde Brevo).',cols:[],campos:[]},
 registros:{titulo:'Registros web',desc:'Personas que han creado una cuenta en la web (Supabase Auth). Aquí los ves crecer.',cols:[],campos:[]},
 posts:{titulo:'Noticias y blog',desc:'Actualidad, comunicados, vídeos y entrevistas. Lo publicado aparece en la web al momento.',cols:[['titulo_es','Título'],['tipo','Tipo'],['estado','Estado'],['publicado_at','Publicado']],campos:[
  ['tipo','Tipo','select',['noticia','comunicado','video','entrevista']],['estado','Estado','select',['borrador','publicado','archivado']],
  ['titulo_es','Título (ES)','text'],['titulo_va','Título (VA) — si lo dejas vacío se traduce solo','text'],
  ['extracto_es','Extracto corto (ES)','textarea'],['extracto_va','Extracto (VA)','textarea'],
  ['cuerpo_es','Cuerpo del artículo (ES)','textarea'],['cuerpo_va','Cuerpo (VA)','textarea'],
  ['imagen','Imagen','text'],['video_url','URL de vídeo (opcional)','text']]},
 events:{titulo:'Agenda',desc:'Actos y eventos. Estado "publicado" para que salgan en la web.',cols:[['titulo_es','Título'],['fecha','Fecha'],['lugar','Lugar'],['inscribible','Inscr.'],['estado','Estado']],campos:[
  ['estado','Estado','select',['borrador','publicado','cancelado']],['titulo_es','Título (ES)','text'],['titulo_va','Título (VA)','text'],
  ['descripcion_es','Descripción (ES)','textarea'],['descripcion_va','Descripción (VA)','textarea'],
  ['fecha','Fecha','date'],['hora_inicio','Hora inicio','time'],['hora_fin','Hora fin','time'],
  ['lugar','Lugar','text'],['direccion','Dirección','text'],['barrio_id','Barrio','barrio'],['inscribible','Admite inscripción de asistentes','check']]},
 campaigns:{titulo:'Campañas',desc:'La campaña con "destacada" activada es la que sale en la Home.',cols:[['titulo_es','Título'],['progreso','%'],['destacada','Destacada'],['estado','Estado']],campos:[
  ['estado','Estado','select',['borrador','activa','finalizada']],['destacada','Destacada en Home','check'],['progreso','Progreso (0-100)','number'],
  ['titulo_es','Título (ES)','text'],['titulo_va','Título (VA)','text'],
  ['descripcion_es','Descripción (ES)','textarea'],['descripcion_va','Descripción (VA)','textarea'],['imagen','Imagen','text'],['objetivos','Objetivos','repeater',[['','Objetivo','text']]],['cronologia','Cronología','repeater',[['date','Fecha','text'],['text','Hito','text']]],['docs','Documentos','repeater',[['name','Nombre','text'],['href','Enlace (URL)','text'],['size','Info (ej. PDF · 2 MB)','text']]]]},
 actuaciones:{titulo:'Actuaciones',desc:'Acciones por barrio. Salen en Acción en Gandia y en el mapa de la Home.',cols:[['titulo_es','Título'],['estado','Estado']],campos:[
  ['estado','Estado','select',['propuesta','en_curso','completada']],['titulo_es','Título (ES)','text'],['titulo_va','Título (VA)','text'],
  ['descripcion_es','Descripción (ES)','textarea'],['descripcion_va','Descripción (VA)','textarea'],
  ['barrio_id','Barrio','barrio'],['_mapa','Ubicación (pincha en el mapa)','map'],['cronologia','Recorrido de la actuación','repeater',[['date','Fecha','text'],['title','Título','text'],['text','Detalle','text']]]]},
 equipo:{titulo:'Equipo',desc:'Junta directiva que aparece en Equipo y Conócenos, por orden.',cols:[['nombre','Nombre'],['cargo_es','Cargo'],['orden','Orden'],['activo','Activo']],campos:[
  ['nombre','Nombre completo','text'],['cargo_es','Cargo (ES)','text'],['cargo_va','Cargo (VA)','text'],
  ['bio_es','Bio (ES)','textarea'],['bio_va','Bio (VA)','textarea'],['foto','Foto','text'],
  ['orden','Orden (0 = primero)','number'],['activo','Visible en la web','check']]},
 voluntarios:{titulo:'Voluntarios',desc:'Red de barrios. Se asignan a una cuenta REGISTRADA por su correo: la foto y el nombre salen de su cuenta, y se le pone el título (voluntario/colaborador) en su área ciudadana. Sale en Equipo → «Red de barrios».',cols:[['nombre','Persona'],['tipo','Tipo'],['orden','Orden'],['activo','Activo']],campos:[
  ['email','Correo de la persona (debe estar registrada en la web)','text'],['tipo','Tipo','select',['voluntario','colaborador']],
  ['barrio_id','Barrio','barrio'],['orden','Orden (0 = primero)','number'],['activo','Visible en la web','check']],ro:['nombre']},
 tesoreria:{titulo:'Tesorería',desc:'Ingresos y gastos. La página pública de Transparencia se actualiza con estos datos.',cols:[['fecha','Fecha'],['tipo','Tipo'],['categoria','Categoría'],['concepto','Concepto'],['importe_cents','Importe']],campos:[
  ['fecha','Fecha','date'],['tipo','Tipo','select',['ingreso','gasto']],['categoria','Categoría','cat_tes'],
  ['concepto','Concepto','text'],['importe_eur','Importe en euros (ej. 120,50)','text']]},
 afiliados:{titulo:'Afiliados',desc:'Registro interno de personas afiliadas y sus cuotas. Datos privados: no aparecen en la web.',cols:[['numero','Nº'],['nombre','Nombre'],['apellidos','Apellidos'],['estado','Estado'],['cuota','Cuota €/mes'],['total','Total €']],campos:[
  ['numero','Nº de socio','text'],['nombre','Nombre','text'],['apellidos','Apellidos','text'],['dni','DNI / NIE','text'],['telefono','Teléfono','text'],['estado','Estado','select',['activo','baja']],['cuota','Cuota mensual (€)','text'],['total','Total pagado (€)','text'],['notas','Notas','textarea']]},
 proposals:{titulo:'Propuestas ciudadanas',desc:'Moderación: publica, marca en estudio o rechaza (con motivo). Lo publicado saldrá en Participación.',cols:[['titulo','Título'],['categoria','Categoría'],['estado','Estado'],['created_at','Recibida']],campos:[
  ['estado','Decisión','select',['pendiente_moderacion','publicada','en_estudio','aprobada','rechazada']],['motivo_rechazo','Motivo (si se rechaza)','textarea'],['_mapa','Ubicación en el mapa','map'],['recorrido','Recorrido de la propuesta','repeater',[['estado','Estado','select',['hecho','en curso','pendiente']],['title','Título','text'],['date','Fecha','text'],['text','Detalle','text']]],['umbrales','Umbrales (vacío = usa los globales)','repeater',[['n','Apoyos','number'],['label','Qué pasa al llegar','text']]],['destacada','Realzar en web (sale en la página Propuestas)','check']],ro:['titulo','descripcion','contacto_nombre','contacto_email']},
 comments:{titulo:'Comentarios',desc:'Moderación de comentarios en propuestas (Fase 3).',cols:[['texto','Comentario'],['estado','Estado'],['created_at','Fecha']],campos:[
  ['estado','Estado','select',['pendiente','publicado','oculto']]],ro:['texto']},
 reportes:{titulo:'Denuncias de propuestas',desc:'Propuestas que la gente ha denunciado. Revísalas y, si hace falta, oculta/borra la propuesta desde «Propuestas ciudadanas».',cols:[],campos:[]},
 denuncias:{titulo:'Canal de denuncias',desc:'⚠ Ley 2/2023: acuse en 7 días y resolución en 3 meses. La respuesta la ve el informante con su código.',cols:[['codigo','Código'],['categoria','Categoría'],['estado','Estado'],['created_at','Recibida']],campos:[
  ['estado','Estado','select',['nueva','en_tramite','cerrada']],['respuesta','Respuesta al informante','textarea']],ro:['texto','contacto']},
 members_inbox:{titulo:'Afiliaciones',desc:'Altas pagadas vía Stripe (se activa en Fase 4).',cols:[['nombre','Nombre'],['apellidos','Apellidos'],['cuota_tipo','Cuota'],['estado','Estado']],campos:[]},
 donations:{titulo:'Donaciones',desc:'Donaciones recibidas (Fase 4). Export completo para Tribunal de Cuentas: ver spec.',cols:[['donor_nombre','Nombre'],['importe_cents','Importe'],['created_at','Fecha'],['estado','Estado'],['liquidada_at','Ingresada']],campos:[]},
 tienda:{titulo:'Tienda',desc:'Productos de merchandising y pedidos de la tienda online.',cols:[],campos:[]}
};
const ORDEN=['inicio','posts','events','campaigns','actuaciones','equipo','voluntarios','tesoreria','afiliados','donations','tienda','proposals','comments','contactos','leads','registros','comunidad','reportes','denuncias'];
const ICONS={inicio:'🏠',posts:'📰',events:'📅',campaigns:'📣',actuaciones:'📍',equipo:'👥',voluntarios:'🙋',tesoreria:'💶',afiliados:'🤝',proposals:'🗳️',comments:'💬',reportes:'🚩',contactos:'✉️',leads:'📬',registros:'🧑‍💻',comunidad:'💭',denuncias:'🛡️',members_inbox:'🎫',donations:'💛',tienda:'🛍️'};
let TAB='inicio', ROWS=[], BARRIOS=[], POLL=null, AF_MAX_TS=0;
const EH=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

async function call(body){
  const r=await fetch('/api/admin',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+TOKEN},body:JSON.stringify(body)});
  const j=await r.json().catch(()=>({}));
  if(r.status===401&&body.action!=='login'){sessionStorage.removeItem('acg_admin');location.reload();}
  return {s:r.status,j};
}
async function login(){
  const r=await call({action:'login',password:$('#pw').value,code:$('#otp').value.trim()});
  if(r.j.token){TOKEN=r.j.token;sessionStorage.setItem('acg_admin',TOKEN);start();}
  else $('#lmsg').innerHTML='<span class="warn">'+((r.j.error&&r.j.error.message)||'Error')+'</span>';
}
$('#pw').addEventListener('keydown',e=>{if(e.key==='Enter')login()});
$('#otp').addEventListener('keydown',e=>{if(e.key==='Enter')login()});
$('#out').onclick=()=>{sessionStorage.removeItem('acg_admin');location.reload();};
$('#lng_es').onclick=()=>setLang('es');$('#lng_va').onclick=()=>setLang('va');
function toggleSide(o){var s=$('#tabs'),b=$('#sidebd');if(!s)return;var open=o===undefined?!s.classList.contains('open'):o;s.classList.toggle('open',open);if(b)b.classList.toggle('on',open);}
$('#burger').onclick=function(){toggleSide();};
$('#sidebd').onclick=function(){toggleSide(false);};
chrome_();

function start(){
  $('#login').style.display='none';$('#app').style.display='flex';$('#out').style.display='block';document.body.classList.add('authed');
  $('#tabs').innerHTML=ORDEN.map(k=>'<button data-t="'+k+'"><span class="ic">'+(ICONS[k]||'•')+'</span>'+FT(k)+'</button>').join('');
  $('#tabs').addEventListener('click',e=>{const b=e.target.closest('button');if(b){TAB=b.dataset.t;render();toggleSide(false);}});
  call({action:'barrios',tabla:'events'}).then(r=>{BARRIOS=r.j.items||[]});
  const badges=()=>call({action:'dashboard'}).then(r=>{if(r.j&&r.j.data)updBadges(r.j.data)});
  badges(); setInterval(badges,120000);
  render();
}
// Buscador instantáneo para tablas y listados (filtra filas ya cargadas)
window.tblFilter=function(inp){
  const q=inp.value.toLowerCase();
  const scope=inp.closest('.page');
  scope.querySelectorAll('tbody tr, .cm').forEach(el=>{el.style.display=!q||el.textContent.toLowerCase().indexOf(q)>-1?'':'none';});
};
const SRCH=ph=>'<input class="tblsrch" placeholder="🔍 '+ph+'" oninput="tblFilter(this)" style="width:100%;box-sizing:border-box;border:1.5px solid #E2E9F1;border-radius:11px;padding:10px 14px;font:600 13.5px Public Sans;margin:10px 0 12px;background:#fff">';
async function render(){
  document.querySelectorAll('.side button').forEach(b=>b.classList.toggle('on',b.dataset.t===TAB));
  clearInterval(POLL);POLL=null;
  if(TAB==='inicio')return renderInicio();
  if(TAB==='comunidad')return renderComunidad();
  if(TAB==='contactos')return renderContactos();
  if(TAB==='leads')return renderLeads();
  if(TAB==='registros')return renderRegistros();
  if(TAB==='proposals')return renderModeracion();
  if(TAB==='comments')return renderComments();
  if(TAB==='reportes')return renderReportes();
  if(TAB==='afiliados')return renderAfiliados();
  if(TAB==='tienda')return renderTienda();
  const f=F[TAB];
  $('#main').innerHTML='<div class="page"><h2>'+FT(TAB)+'</h2><p class="sub">'+FD(TAB)+'</p><p class="sub">'+T('cargando')+'</p></div>';
  const r=await call({action:'list',tabla:TAB});
  ROWS=r.j.items||[];
  let extra='';
  if(TAB==='tesoreria'){
    const ing=ROWS.filter(x=>x.tipo==='ingreso').reduce((s,x)=>s+x.importe_cents,0);
    const gas=ROWS.filter(x=>x.tipo==='gasto').reduce((s,x)=>s+x.importe_cents,0);
    const sal=ing-gas;
    extra='<div class="stats"><div class="stat"><b style="color:#1E7A45">'+EUR(ing)+'</b>'+T('ingresos')+' ('+(LANG==='va'?'històric':'histórico')+')</div><div class="stat"><b style="color:#C0392B">'+EUR(gas)+'</b>'+T('gastos')+' ('+(LANG==='va'?'històric':'histórico')+')</div><div class="stat" style="background:#0A2A5E;border-color:#0A2A5E"><b style="color:#F6BE18">'+EUR(sal)+'</b><span style="color:#cdd9ec;font-weight:600">'+(LANG==='va'?'Saldo actual':'Saldo actual')+'</span></div></div>';
  }
  if(TAB==='denuncias'){
    const urg=ROWS.filter(x=>x.estado==='nueva'&&(Date.now()-new Date(x.created_at))/864e5>5).length;
    if(urg)extra='<p class="warn">⚠ '+urg+' denuncia(s) a punto de agotar el plazo de acuse de 7 días.</p>';
    extra+='<p class="sub" style="margin:6px 0 0">Abre una denuncia para responder en su <b>hilo de conversación</b>: el informante lo lee con su código y puede contestarte.</p>';
  }
  if(TAB==='events')extra+='<div id="inscBox"></div>';
  const nuevo=(!f.campos.length||F[TAB].ro&&!f.campos.length)?'':(TABLAS_EDIT(TAB)?'<button class="btn gold" onclick="window.form()">'+T('nuevo')+'</button>':'');
  $('#main').innerHTML='<div class="page"><div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap"><div style="flex:1"><h2>'+FT(TAB)+'</h2><p class="sub">'+FD(TAB)+'</p></div>'+nuevo+'</div>'+extra+
    (ROWS.length>5?SRCH(LANG==='va'?'Busca en esta llista…':'Buscar en esta lista…'):'')+
    '<table class="crud"><thead><tr>'+f.cols.map(c=>'<th>'+c[1]+'</th>').join('')+'</tr></thead><tbody>'+
    (ROWS.length?ROWS.map((row,i)=>'<tr onclick="form('+i+')">'+f.cols.map(c=>{
      let v=row[c[0]];
      if(c[0]==='importe_cents')v=(row.tipo==='gasto'?'−':'+')+EUR(v);
      else if(c[0]==='publicado_at'||c[0]==='created_at')v=v?String(v).slice(0,10):'—';
      else if(typeof v==='boolean')v=v?'✓':'—';
      else if(ESTADOS[v])v=pill(v);
      return '<td data-label="'+EH(c[1])+'">'+(v==null?'—':v)+'</td>';
    }).join('')+'</tr>').join(''):'<tr><td colspan="9" style="color:#8A99A8">'+T('sinReg')+'</td></tr>')+
    '</tbody></table><div id="fbox"></div></div>';
  if(TAB==='events')cargaInscritos();
}
async function cargaInscritos(){
  const r=await call({action:'inscripciones-list'});
  const el=document.getElementById('inscBox'); if(!el)return;
  const items=(r.j&&r.j.items)||[];
  if(!items.length){el.innerHTML='';return;}
  el.innerHTML='<div style="background:#fff;border:1px solid #E7EDF4;border-radius:14px;padding:16px 18px;margin:10px 0"><h3 style="font:800 14px Bricolage Grotesque;color:#0A2A5E;margin:0 0 8px">👥 '+(LANG==='va'?'Inscrits per acte':'Inscritos por acto')+'</h3>'
    +items.map(e=>'<details style="border-top:1px dashed #EEF2F7;padding:7px 0"><summary style="cursor:pointer;font:600 13.5px Public Sans;color:#17232F">'+EH(e.titulo)+' <span style="color:#8A99A8">('+e.fecha+')</span> — <b style="color:#1563C4">'+e.personas.length+'</b></summary>'
      +'<table style="margin-top:6px;font-size:12.5px"><tbody>'+e.personas.map(p=>'<tr><td style="padding:3px 12px 3px 0">'+EH(p.nombre||'—')+'</td><td style="padding:3px 12px 3px 0;color:#5C6B7A">'+EH(p.email)+'</td><td style="padding:3px 0;color:#8A99A8">'+p.fecha+'</td></tr>').join('')+'</tbody></table></details>').join('')+'</div>';
}
async function renderAfiliados(){
  const va=LANG==='va';
  // Al abrir la pestaña, se marcan como vistas las afiliaciones nuevas y se limpia el badge del menú.
  if(AF_MAX_TS)localStorage.setItem('acg_af_seen',String(AF_MAX_TS));
  var afbdg=document.querySelector('#tabs button[data-t="afiliados"] .bdg');if(afbdg)afbdg.remove();
  $('#main').innerHTML='<div class="page"><h2>🤝 '+(va?'Afiliats':'Afiliados')+'</h2><p class="sub">'+T('cargando')+'</p></div>';
  const r=await call({action:'afiliados-stripe'});
  const d=r.j||{}; const af=d.afiliados||[];
  const link=location.origin+'/afiliarse';
  window.copiaLinkAf=function(){navigator.clipboard.writeText(link).then(function(){toast(va?'Enllaç copiat':'Enlace copiado');},function(){toast(va?'No s ha pogut copiar':'No se pudo copiar',{error:true});});};
  const estPill=function(e){
    var M={active:[va?'Actiu':'Activo','#1E7A45','#E7F4EC'],pausado:[va?'Pausat':'Pausado','#9A6208','#FBF0DC'],baja_fin:[va?'Baixa programada':'Baja programada','#5C6B7A','#EEF2F7'],past_due:[va?'Impagament':'Impago','#C0392B','#FDECEA'],unpaid:[va?'Impagament':'Impago','#C0392B','#FDECEA'],trialing:[va?'Prova':'Prueba','#1563C4','#EAF3FC']};
    var m=M[e]||[e,'#5C6B7A','#EEF2F7'];
    return '<span style="font:700 11px Public Sans;color:'+m[1]+';background:'+m[2]+';padding:3px 9px;border-radius:3px">'+m[0]+'</span>';
  };
  const acc=function(x){
    var bt=function(id,act,col,lbl,cents){return '<button class="afbtn" data-id="'+id+'" data-act="'+act+'"'+(cents!=null?' data-cents="'+cents+'"':'')+' style="border:none;cursor:pointer;background:'+col+';color:#fff;font:700 11px Public Sans;padding:6px 11px;border-radius:3px;margin:0 4px 4px 0">'+lbl+'</button>';};
    var out='';
    if(x.estado==='pausado')out+=bt(x.id,'afiliado-reactivar','#1E7A45','▶ '+(va?'Reactivar':'Reactivar'));
    else if(x.estado==='active')out+=bt(x.id,'afiliado-pausar','#9A6208','⏸ '+(va?'Pausar':'Pausar'));
    if(x.estado==='active'||x.estado==='pausado')out+=bt(x.id,'afiliado-cambiar-cuota','#1563C4','✎ '+(va?'Quota':'Cuota'),x.cuotaCents);
    if(x.estado==='baja_fin')out+='<span class="sub" style="margin:0">'+(va?'baixa a fi de mes':'baja a fin de mes')+'</span>';
    else out+=bt(x.id,'afiliado-baja','#C0392B','⛔ '+(va?'Baixa':'Baja'));
    return out;
  };
  var resumen='<div class="stats"><div class="stat" style="background:#0A2A5E;border-color:#0A2A5E"><b style="color:#F6BE18">'+(d.activos||0)+'</b><span style="color:#cdd9ec;font-weight:600">'+(va?'socis actius':'socios activos')+'</span></div><div class="stat"><b style="color:'+(d.ingresado?'#1E7A45':'#9A6208')+'">'+EUR2(d.acumMesCents||0)+'</b>'+(d.ingresado?(va?'✓ ja ingressat aquest mes':'✓ ya ingresado este mes'):(va?'quotes aquest mes (pendents)':'cuotas este mes (pendiente)'))+'</div></div>';
  var copiar='<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:2px 0 14px"><button class="btn gold" onclick="window.copiaLinkAf()">🔗 '+(va?'Copiar enllaç afiliació':'Copiar enlace de afiliación')+'</button><span class="sub" style="margin:0">'+(va?'Envia a qui vulga fer-se soci. Res manual.':'Envíaselo a quien quiera hacerse socio. Nada manual.')+'</span></div>';
  var tabla='<table><thead><tr><th>'+(va?'Soci':'Socio')+'</th><th>'+(va?'Quota':'Cuota')+'</th><th>'+(va?'Pròxim cobrament':'Próximo cobro')+'</th><th>'+(va?'Estat':'Estado')+'</th><th></th></tr></thead><tbody>'+(af.length?af.map(function(x){return '<tr><td><b>'+EH(x.nombre)+'</b><br><span style="color:#8A99A8;font-size:12px">'+EH(x.email)+'</span></td><td>'+EUR2(x.cuotaCents)+'</td><td>'+(x.proximo||'—')+'</td><td>'+estPill(x.estado)+'</td><td style="white-space:nowrap">'+acc(x)+'</td></tr>';}).join(''):'<tr><td colspan="5" style="color:#8A99A8">'+(va?'Encara no hi ha socis. Comparteix l enllaç d amunt.':'Aún no hay socios. Comparte el enlace de arriba.')+'</td></tr>')+'</tbody></table>';
  var ant=d.anteriores||[];
  var legPill=function(e){var m=e==='activo'?[va?'Era actiu':'Estaba activo','#1E7A45','#E7F4EC']:[va?'Estava parat':'Estaba parado','#9A6208','#FBF0DC'];return '<span style="font:700 11px Public Sans;color:'+m[1]+';background:'+m[2]+';padding:3px 9px;border-radius:3px">'+m[0]+'</span><div style="font:600 10.5px Public Sans;color:#8A99A8;margin-top:3px">'+(va?'pendent de reafiliació':'pendiente de reafiliación')+'</div>';};
  var bloqueAnt=ant.length?'<h3 style="font:800 16px Fraunces;color:#0A2A5E;margin:28px 0 4px">'+(va?'Afiliats anteriors':'Afiliados anteriores')+'</h3><p class="sub" style="margin:0 0 12px">'+(va?'Del sistema manual. Es conserven amb el seu històric. Comparteix l enllaç perque es reafilien i passaran a la llista de dalt.':'Del sistema manual. Se conservan con su histórico. Comparte el enlace para que se reafilien y pasarán a la lista de arriba.')+'</p><table><thead><tr><th>#</th><th>'+(va?'Nom':'Nombre')+'</th><th>'+(va?'Quota':'Cuota')+'</th><th>'+(va?'Aportat':'Aportado')+'</th><th>'+(va?'Estat':'Estado')+'</th><th></th></tr></thead><tbody>'+ant.map(function(x){return '<tr><td style="color:#8A99A8">'+x.numero+'</td><td><b>'+EH(x.nombre)+'</b></td><td>'+EUR2(x.cuotaCents)+'</td><td>'+EUR2(x.totalCents)+'</td><td>'+legPill(x.estado)+'</td><td style="white-space:nowrap">'+(x.estado==='activo'?'<button class="aflegbaja" data-id="'+x.id+'" style="border:none;cursor:pointer;background:#C0392B;color:#fff;font:700 11px Public Sans;padding:6px 11px;border-radius:3px;margin:0 4px 4px 0">⛔ '+(va?'Baixa':'Baja')+'</button>':'<button class="aflegdel" data-id="'+x.id+'" style="border:none;cursor:pointer;background:#5C6B7A;color:#fff;font:700 11px Public Sans;padding:6px 11px;border-radius:3px;margin:0 4px 4px 0">🗑 '+(va?'Eliminar':'Eliminar')+'</button>')+'<button style="border:none;cursor:pointer;background:#0A2A5E;color:#fff;font:700 11px Public Sans;padding:6px 11px;border-radius:3px" onclick="window.copiaLinkAf()">🔗 '+(va?'Enllaç':'Enlace')+'</button></td></tr>';}).join('')+'</tbody></table>':'';
  $('#main').innerHTML='<div class="page"><h2>🤝 '+(va?'Afiliats':'Afiliados')+'</h2><p class="sub">'+(va?'Socis suscrits en Stripe. Es cobren i es gestionen automàticament.':'Socios suscritos en Stripe. Se cobran y se gestionan automáticamente.')+'</p>'+copiar+resumen+(af.length>5?SRCH(va?'Busca un soci…':'Buscar un socio…'):'')+tabla+bloqueAnt+'</div>';
}
window.afAccion=async function(id,act,cents){
  var va=LANG==='va';
  if(act==='afiliado-cambiar-cuota'){
    var cur=cents?(cents/100).toString().replace('.',','):'';
    var val=await askPrompt(va?'Nova quota mensual en euros:':'Nueva cuota mensual en euros:',cur);
    if(val===null)return;
    var eur=parseFloat(String(val).replace(',','.'));
    if(!(eur>=3)){toast(va?'Import no vàlid (mínim 3 euros)':'Importe no válido (mínimo 3 euros)',{error:true});return;}
    var rc=await call({action:act,id:id,cents:Math.round(eur*100)});
    if(rc.j&&rc.j.ok){toast(va?'Quota actualitzada':'Cuota actualizada');renderAfiliados();}else toast((rc.j&&rc.j.error&&rc.j.error.message)||'Error',{error:true});
    return;
  }
  var msg=act==='afiliado-baja'?(va?'Donar de baixa aquest soci? Deixarà de pagar al final del mes ja pagat, sense nous cobraments.':'¿Dar de baja a este socio? Dejará de pagar al final del mes ya pagado, sin nuevos cobros.'):act==='afiliado-pausar'?(va?'Pausar el cobrament a aquest soci?':'¿Pausar el cobro a este socio?'):(va?'Reactivar el cobrament?':'¿Reactivar el cobro?');
  var ok=await askConfirm(msg,{danger:act==='afiliado-baja'});
  if(!ok)return;
  var r=await call({action:act,id:id});
  if(r.j&&r.j.ok){toast(va?'Fet':'Hecho');renderAfiliados();}else toast((r.j&&r.j.error&&r.j.error.message)||'Error',{error:true});
};
window.afLegacyBaja=async function(id){
  var va=LANG==='va';
  var ok=await askConfirm(va?'Donar de baixa aquest afiliat antic? Es mantindrà el seu històric, però passarà a estat de baixa.':'¿Dar de baja a este afiliado antiguo? Se mantiene su histórico, pero pasará a estado de baja.',{danger:true});
  if(!ok)return;
  var r=await call({action:'legacy-baja',id:id});
  if(r.j&&r.j.ok){toast(va?'Afiliat donat de baixa':'Afiliado dado de baja');renderAfiliados();}else toast((r.j&&r.j.error&&r.j.error.message)||'Error',{error:true});
};
window.afLegacyEliminar=async function(id){
  var va=LANG==='va';
  var ok=await askConfirm(va?'Eliminar definitivament aquest afiliat antic del registre? No es podrà desfer.':'¿Eliminar definitivamente a este afiliado antiguo del registro? No se podrá deshacer.',{danger:true,yes:va?'Eliminar':'Eliminar'});
  if(!ok)return;
  var r=await call({action:'legacy-eliminar',id:id});
  if(r.j&&r.j.ok){toast(va?'Afiliat eliminat':'Afiliado eliminado');renderAfiliados();}else toast((r.j&&r.j.error&&r.j.error.message)||'Error',{error:true});
};
document.addEventListener('click',function(e){if(!e.target||!e.target.closest)return;var b=e.target.closest('button.afbtn');if(b&&b.dataset.act){window.afAccion(b.dataset.id,b.dataset.act,b.dataset.cents?parseInt(b.dataset.cents,10):0);return;}var lb=e.target.closest('button.aflegbaja');if(lb&&lb.dataset.id){window.afLegacyBaja(lb.dataset.id);return;}var ld=e.target.closest('button.aflegdel');if(ld&&ld.dataset.id)window.afLegacyEliminar(ld.dataset.id);});
function TABLAS_EDIT(t){return !['proposals','denuncias','members_inbox','donations'].includes(t)}
const EUR2=c=>((c||0)/100).toLocaleString('es-ES',{style:'currency',currency:'EUR'});

async function renderInicio(){
  $('#main').innerHTML='<div class="page"><h2>Inicio</h2><p class="sub">'+T('cargando')+'</p></div>';
  const va=LANG==='va';
  const [r,ra]=await Promise.all([call({action:'dashboard'}),call({action:'analytics'})]);
  const d=(r.j&&r.j.data)||{};
  const a=(ra.j&&ra.j.data)||{};
  updBadges(d);
  const card=(n,l,cls,link,ic)=>'<div class="dcard '+(cls||'')+'"'+(link?' data-go="'+link+'"':'')+'>'+(ic?'<span class="ic">'+ic+'</span>':'')+'<div class="n">'+n+'</div><div class="l">'+l+'</div>'+(link?'<span class="dgo">Revisar →</span>':'')+'</div>';
  const pend=d.propuestasPendientes||0, com=d.comentariosPendientes||0, den=d.denunciasAbiertas||0, cont=d.contactosNuevos||0, saldo=d.saldoCents||0;

  // ---- nombres legibles de páginas (nada de rutas) ----
  const NOMBRES={'/':'Inicio','/index.html':'Inicio','/participacion':'Participación','/propuestas':'Propuestas','/propuesta':'Detalle de propuesta','/propuesta-ciudadana':'Detalle de propuesta','/crear-propuesta':'Crear propuesta','/conocenos':'Conócenos','/actualidad':'Actualidad','/agenda':'Agenda','/campanas':'Campañas','/accion':'Acción en Gandia','/transparencia':'Transparencia','/comunidad':'Comunidad','/contacto':'Contacto','/cuenta':'Área ciudadana','/participa':'Participa','/equipo':'Equipo','/historia':'Historia','/valores':'Valores','/faq':'Preguntas frecuentes','/denuncias':'Canal de denuncias','/programa-electoral':'Programa electoral','/mapa-actuaciones':'Mapa de actuaciones','/buscar':'Buscador','/donar':'Donar','/afiliate':'Afíliate'};
  const nombrePag=(p)=>{
    let x=String(p||'/').split('?')[0].toLowerCase();
    if(NOMBRES[x])return NOMBRES[x];
    if(x.indexOf('/actualidad/')===0)return 'Noticia: '+x.slice(12).replace(/-/g,' ');
    if(x.indexOf('/agenda/')===0)return 'Evento: '+x.slice(8).replace(/-/g,' ');
    if(x.indexOf('/campanas/')===0)return 'Campaña: '+x.slice(10).replace(/-/g,' ');
    x=x.replace(/^\\//,'').replace(/\\.dc\\.html$/i,'').replace(/\\.html$/i,'');
    const limpio=x.replace(/^(detalle|categoria|perfilmiembro|barrio|ficha)/i,'$1 ').replace(/-/g,' ');
    return NOMBRES['/'+x]||(limpio.charAt(0).toUpperCase()+limpio.slice(1))||'Inicio';
  };

  // ---- gráfico horario con selector de día + tooltip de verdad ----
  const H8=a.horas8||[a.hoyH||[],a.ayerH||[]], D8=a.dias8||[];
  const hActHoy=(a.horaActual!=null?a.horaActual:23);
  const DSEM=va?['diumenge','dilluns','dimarts','dimecres','dijous','divendres','dissabte']:['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
  const nomDia=(i)=>{ if(i===0)return va?'Hui':'Hoy'; if(i===1)return va?'Ahir':'Ayer'; const dt=new Date(D8[i]+'T12:00:00'); return DSEM[dt.getDay()]+' '+dt.getDate(); };
  const buildCmp=(idx)=>{
    const cur=H8[idx]||Array(24).fill(0), prev=H8[idx+1]||Array(24).fill(0);
    const hMax=idx===0?hActHoy:23;
    let accP=0,accC=0; const cumP=[],cumC=[];
    for(let h2=0;h2<24;h2++){accP+=(prev[h2]||0);cumP.push(accP);if(h2<=hMax){accC+=(cur[h2]||0);cumC.push(accC);}}
    const maxY=Math.max(accP,accC,1);
    const GX=h2=>Math.round(h2/23*450)+15, GY=v2=>132-Math.round(v2/maxY*108);
    const ptsP=cumP.map((v2,h2)=>GX(h2)+','+GY(v2)).join(' ');
    const ptsC=cumC.map((v2,h2)=>GX(h2)+','+GY(v2)).join(' ');
    const areaC=cumC.length?('15,'+GY(0)+' '+ptsC+' '+GX(cumC.length-1)+','+GY(0)):'';
    return {cumP,cumC,maxY,totC:accC,totP:accP,prevAlli:cumP[hMax]||0,hMax,
      svg:'<svg id="svgCmp" viewBox="0 0 480 158" style="width:100%;height:auto;display:block;cursor:crosshair" role="img">'
      +[0.5,1].map(f2=>'<line x1="15" y1="'+GY(maxY*f2)+'" x2="465" y2="'+GY(maxY*f2)+'" stroke="#EEF2F7" stroke-width="1"/>').join('')
      +'<line x1="15" y1="132" x2="465" y2="132" stroke="#E2E9F1" stroke-width="1"/>'
      +'<polyline points="'+ptsP+'" fill="none" stroke="#C9D6E4" stroke-width="2" stroke-dasharray="5 4"/>'
      +(areaC?'<polygon points="'+areaC+'" fill="rgba(21,99,196,.10)"/>':'')
      +(cumC.length?'<polyline points="'+ptsC+'" fill="none" stroke="#1563C4" stroke-width="2.5"/>':'')
      +(cumC.length?'<circle cx="'+GX(cumC.length-1)+'" cy="'+GY(cumC[cumC.length-1])+'" r="4.5" fill="#F6BE18" stroke="#0A2A5E" stroke-width="1.5"/>':'')
      +'<line id="cmpCross" x1="0" y1="18" x2="0" y2="132" stroke="#0A2A5E" stroke-width="1" stroke-dasharray="3 3" style="display:none"/>'
      +'<circle id="cmpDotC" r="3.5" fill="#1563C4" style="display:none"/><circle id="cmpDotP" r="3.5" fill="#94A3B2" style="display:none"/>'
      +[0,6,12,18,23].map(h2=>'<text x="'+GX(h2)+'" y="148" font-size="10" fill="#8A99A8" text-anchor="middle" font-family="Public Sans,sans-serif">'+h2+'h</text>').join('')
      +'</svg>'};
  };
  const cmpChip=(id2,n,l2,col)=>'<div style="text-align:center"><div id="'+id2+'" style="font:800 26px Bricolage Grotesque;color:'+col+'">'+n+'</div><div style="font:600 11.5px Public Sans;color:#8A99A8">'+l2+'</div></div>';
  const diasBtns='<div id="diaSel" style="display:flex;gap:4px;flex-wrap:wrap;background:#EEF3F9;border-radius:9px;padding:3px">'+[0,1,2,3,4,5,6].map(i2=>'<button data-dia="'+i2+'" style="border:none;cursor:pointer;font:700 11px Public Sans;padding:4px 9px;border-radius:7px;background:'+(i2?'none':'#fff')+';color:'+(i2?'#5C6B7A':'#0A2A5E')+';'+(i2?'':'box-shadow:0 1px 4px rgba(10,42,94,.12)')+'">'+nomDia(i2)+'</button>').join('')+'</div>';
  const c0=buildCmp(0);
  const boxCmp='<div style="background:#fff;border:1px solid #E7EDF4;border-radius:16px;padding:20px 22px;box-shadow:0 3px 14px rgba(10,42,94,.05);margin-bottom:14px;position:relative">'
    +'<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:10px">'
    +'<h3 style="font:800 15px Bricolage Grotesque;color:#0A2A5E;margin:0">📈 <span id="cmpTitulo">'+(va?'Visites: hui contra ahir, hora a hora':'Visitas: hoy contra ayer, hora a hora')+'</span></h3>'
    +'<div style="flex:1"></div>'+diasBtns+'</div>'
    +'<div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:6px;justify-content:flex-end">'
    +cmpChip('cmpNC',c0.totC,(va?'dia triat':'día elegido'),'#1563C4')
    +cmpChip('cmpNP',c0.prevAlli,va?'anterior a la mateixa hora':'anterior a la misma hora','#8A99A8')
    +cmpChip('cmpNT',c0.totP,va?'anterior complet':'anterior completo','#C9D6E4')
    +'</div><div id="cmpWrap">'+c0.svg+'</div>'
    +'<div id="cmpTip" style="display:none;position:absolute;pointer-events:none;background:#0A2A5E;color:#fff;font:600 12px Public Sans;padding:7px 11px;border-radius:9px;box-shadow:0 8px 20px rgba(10,42,94,.3);z-index:20;white-space:nowrap"></div>'
    +'<p class="sub" style="margin:8px 0 0;font-size:12px"><span style="color:#1563C4;font-weight:800">━</span> '+(va?'Dia triat (acumulat)':'Día elegido (acumulado)')+' &nbsp; <span style="color:#C9D6E4;font-weight:800">╌╌</span> '+(va?'Dia anterior':'Día anterior')+' &nbsp; <span style="color:#F6BE18">●</span> '+(va?'ara':'ahora')+'</p></div>';

  // ---- % de cambio hoy vs ayer ----
  const dAyer=a.pvAyer||0, dHoy2=a.pvHoy||0;
  const delta=dAyer?Math.round((dHoy2-dAyer)/dAyer*100):null;
  const deltaChip=delta===null?'':' <span style="font:800 11px Public Sans;padding:2px 8px;border-radius:99px;vertical-align:middle;'+(delta>=0?'background:#E7F4EC;color:#1E7A45':'background:#FDEAEA;color:#C0392B')+'">'+(delta>=0?'▲':'▼')+' '+Math.abs(delta)+'%</span>';

  // ---- barras 7/30 días ----
  const s30=a.serie30||[]; const s7=s30.slice(-7);
  const DIAS=va?['dl','dm','dc','dj','dv','ds','dg']:['lu','ma','mi','ju','vi','sá','do'];
  const barra=(items,compact)=>{
    const mx=Math.max.apply(null,items.map(x=>x.n).concat([1]));
    return '<div style="display:flex;align-items:flex-end;gap:'+(compact?'3px':'8px')+';height:96px;margin-top:10px">'+items.map((x,i)=>{
      const last=i===items.length-1;
      const dt=new Date(x.d+'T12:00:00');
      const lbl=compact?(dt.getDate()===1||i%5===0?String(dt.getDate()):''):DIAS[(dt.getDay()+6)%7];
      return '<div style="flex:1;text-align:center;min-width:0"><div class="acgbar" title="'+x.d+': '+x.n+(va?' visites':' visitas')+'" style="background:'+(last?'#F6BE18':'#1563C4')+';border-radius:4px 4px 0 0;height:'+Math.max(4,Math.round(x.n/mx*70))+'px;cursor:default;transition:filter .12s"></div><div style="font-size:9.5px;color:#8A99A8;margin-top:4px;white-space:nowrap">'+lbl+'</div>'+(compact?'':'<div style="font-size:11px;font-weight:800;color:#0A2A5E">'+x.n+'</div>')+'</div>';
    }).join('')+'</div>';
  };
  const tot7=s7.reduce((s2,x)=>s2+x.n,0), tot30=s30.reduce((s2,x)=>s2+x.n,0);
  const chart='<div id="ch7">'+barra(s7,false)+'<p class="sub" style="margin:10px 0 0">'+(va?'Total setmana: ':'Total semana: ')+'<b style="color:#0A2A5E">'+tot7+'</b>'+(va?' visites':' visitas')+'</p></div>'
    +'<div id="ch30" style="display:none">'+barra(s30,true)+'<p class="sub" style="margin:10px 0 0">'+(va?'Total 30 dies: ':'Total 30 días: ')+'<b style="color:#0A2A5E">'+tot30+'</b>'+(va?' visites':' visitas')+'</p></div>';
  const rangoBtns='<div style="display:inline-flex;background:#EEF3F9;border-radius:9px;padding:3px;gap:2px;float:right">'
    +'<button id="rg7" style="border:none;cursor:pointer;font:700 11.5px Public Sans;padding:4px 11px;border-radius:7px;background:#fff;color:#0A2A5E;box-shadow:0 1px 4px rgba(10,42,94,.12)">7d</button>'
    +'<button id="rg30" style="border:none;cursor:pointer;font:700 11.5px Public Sans;padding:4px 11px;border-radius:7px;background:none;color:#5C6B7A">30d</button></div>';

  // ---- embudo ----
  const participantes=(a.votTotal||0)+(a.propTotal||0);
  const compromiso=(a.afiliadosAct||0)+(a.donCount||0);
  const fSteps=[
    [va?'Visites (30 dies)':'Visitas (30 días)', tot30, '#1563C4'],
    [va?'Usuaris registrats':'Usuarios registrados', a.registrosTotal||0, '#0FA6B6'],
    [va?'Participacions (vots+propostes)':'Participaciones (votos+propuestas)', participantes, '#6B4EE6'],
    [va?'Afiliats + donants':'Afiliados + donantes', compromiso, '#2E9E5B']
  ];
  const fMax=Math.max.apply(null,fSteps.map(x=>x[1]).concat([1]));
  const funnel=fSteps.map((x,i)=>{
    const w=Math.max(3,Math.round(x[1]/fMax*100));
    const pct=i?(fSteps[0][1]?Math.round(x[1]/fSteps[0][1]*1000)/10:0):100;
    return '<div style="margin-bottom:9px"><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px"><span style="color:#42525F;font-weight:600">'+x[0]+'</span><span style="color:#0A2A5E;font-weight:800">'+x[1]+' <span style="color:#8A99A8;font-weight:600">('+pct+'%)</span></span></div><div style="height:14px;background:#EEF3F9;border-radius:99px;overflow:hidden"><div title="'+x[1]+'" style="width:'+w+'%;height:100%;border-radius:99px;background:'+x[2]+';transition:width .8s cubic-bezier(.2,.7,.3,1)"></div></div></div>';
  }).join('');

  // ---- fuentes + idioma ----
  const fuentesHtml=(a.topFuentes&&a.topFuentes.length)?a.topFuentes.map(f=>'<div style="display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-bottom:1px dashed #EEF2F7;font-size:13.5px"><span style="color:#42525F">'+(f[0]==='Directo'?(va?'Directe / marcadors':'Directo / marcadores'):EH(f[0]))+'</span><b style="color:#0A2A5E">'+f[1]+'</b></div>').join(''):'<p class="sub" style="margin:0">'+(va?'Sense dades hui.':'Sin datos hoy.')+'</p>';
  const lt=(a.langsHoy&&((a.langsHoy.es||0)+(a.langsHoy.va||0)))||0;
  const pctEs=lt?Math.round((a.langsHoy.es||0)/lt*100):0;
  const langBar=lt?'<div style="margin-top:14px"><div style="font:700 11px Public Sans;color:#8A99A8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">'+(va?'Idioma de les visites':'Idioma de las visitas')+'</div><div style="display:flex;height:10px;border-radius:99px;overflow:hidden;background:#EEF2F7"><div style="width:'+pctEs+'%;background:#1563C4"></div><div style="flex:1;background:#F6BE18"></div></div><p class="sub" style="margin:6px 0 0;font-size:12px">ES '+pctEs+'% · VA '+(100-pctEs)+'%</p></div>':'';

  // ---- redes: salidas (clicks) y entradas (visitas desde) — siempre las 4 con contador ----
  const REDES4=[['facebook','📘','Facebook'],['instagram','📸','Instagram'],['tiktok','🎵','TikTok'],['youtube','▶️','YouTube']];
  const rSal=a.redes||{}, rEnt=a.redesIn||{};
  const redesHtml='<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">'
    +'<tr><th style="text-align:left;font:700 11px Public Sans;color:#8A99A8;text-transform:uppercase;letter-spacing:.5px;padding:4px 8px 8px 0">'+(va?'Xarxa':'Red')+'</th>'
    +'<th style="text-align:right;font:700 11px Public Sans;color:#8A99A8;text-transform:uppercase;padding:4px 8px 8px">'+(va?'Ixen cap allà (hui · 7d)':'Salen hacia allá (hoy · 7d)')+'</th>'
    +'<th style="text-align:right;font:700 11px Public Sans;color:#8A99A8;text-transform:uppercase;padding:4px 0 8px 8px">'+(va?'Entren des d’allà (hui · 7d)':'Entran desde allá (hoy · 7d)')+'</th></tr>'
    +REDES4.map(x=>{
      const so=rSal[x[0]]||{hoy:0,semana:0}, si=rEnt[x[0]]||{hoy:0,semana:0};
      return '<tr><td style="padding:7px 8px 7px 0;border-top:1px dashed #EEF2F7;font-weight:700;color:#0A2A5E">'+x[1]+' '+x[2]+'</td>'
        +'<td style="padding:7px 8px;border-top:1px dashed #EEF2F7;text-align:right;color:#42525F"><b style="color:#1563C4">'+so.hoy+'</b> · '+so.semana+'</td>'
        +'<td style="padding:7px 0 7px 8px;border-top:1px dashed #EEF2F7;text-align:right;color:#42525F"><b style="color:#1E7A45">'+si.hoy+'</b> · '+si.semana+'</td></tr>';
    }).join('')+'</table></div>'
    +'<p class="sub" style="margin:10px 0 0;font-size:12px">'+(va?'“Entren” es detecta pel referrer o per utm_source/fbclid a l’enllaç. Consell: quan publiques a Facebook, enllaça amb ?utm_source=facebook':'“Entran” se detecta por el referrer o por utm_source/fbclid en el enlace. Consejo: cuando publiques en Facebook, enlaza con ?utm_source=facebook')+'</p>';

  const topHtml=(a.topPaginas&&a.topPaginas.length)?a.topPaginas.map(p=>'<div style="display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-bottom:1px dashed #EEF2F7;font-size:13.5px"><span style="color:#42525F;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+EH(p[0])+'">'+EH(nombrePag(p[0]))+'</span><b style="color:#0A2A5E">'+p[1]+'</b></div>').join(''):'<p class="sub" style="margin:0">'+(va?'Sense visites hui encara.':'Sin visitas hoy todavía.')+'</p>';

  const box=(t,inner,extra)=>'<div style="background:#fff;border:1px solid #E7EDF4;border-radius:16px;padding:18px;box-shadow:0 3px 14px rgba(10,42,94,.05)"><h3 style="font:800 15px Bricolage Grotesque;color:#0A2A5E;margin:0 0 8px">'+t+(extra||'')+'</h3>'+inner+'</div>';
  const sec=(t)=>'<h3 style="font:800 12.5px Public Sans;color:#8A99A8;text-transform:uppercase;letter-spacing:.6px;margin:22px 0 10px">'+t+'</h3>';
  const apel=d.apelacionesPendientes||0;
  const totalPend=pend+com+den+cont+apel;
  const fecha=new Date().toLocaleDateString(va?'ca-ES':'es-ES',{weekday:'long',day:'numeric',month:'long'});
  const pendHtml=totalPend
    ?'<div class="dash">'
      +(apel?card(apel,va?'Apel·lacions de bloqueig':'Apelaciones de bloqueo','alert','comunidad','🚫'):'')
      +(pend?card(pend,va?'Propostes per moderar':'Propuestas por moderar','alert','proposals','🗳️'):'')
      +(cont?card(cont,va?'Contactes per llegir':'Contactos por leer','alert','contactos','✉️'):'')
      +(com?card(com,va?'Comentaris en cua':'Comentarios en cola','alert','comments','💬'):'')
      +(den?card(den,va?'Denúncies obertes':'Denuncias abiertas','alert','denuncias','🛡️'):'')
      +'</div>'
    :'<div class="aldia">✅ '+(va?'Tot al dia: res pendent de moderar ni de respondre.':'Todo al día: nada pendiente de moderar ni de responder.')+'</div>';

  const masHoy=(n)=>n?(' <span style="font:800 12px Public Sans;color:#1E7A45">+'+n+(va?' hui':' hoy')+'</span>'):'';
  $('#main').innerHTML='<div class="page"><h2>Hola 👋</h2><p class="sub" style="text-transform:capitalize">'+fecha+'</p>'
    +sec('⏳ '+(va?'Necessita la teua atenció':'Necesita tu atención'))
    +pendHtml
    +sec('📊 '+(va?'El web hui':'La web hoy'))
    +boxCmp
    +'<div class="dash">'
    +card((a.pvHoy||0)+deltaChip,va?'Visites (vs ahir)':'Visitas (vs ayer)','good','','👀')
    +card(a.unicosHoy||0,va?'Visitants únics':'Visitantes únicos','','','🧑‍🤝‍🧑')
    +card(a.socialHoy||0,va?'Clics cap a xarxes':'Clicks hacia redes','','','🌐')
    +card(a.registrosHoy||0,va?'Registres nous':'Registros nuevos',a.registrosHoy?'good':'','','🆕')
    +card(a.newsHoy||0,va?'Altes newsletter':'Altas newsletter',a.newsHoy?'good':'','leads','📬')
    +card((a.donHoyCount||0)+(a.donHoyCents?' · '+EUR2(a.donHoyCents):''),va?'Donacions hui':'Donaciones hoy',a.donHoyCount?'good':'','donations','💛')
    +'</div>'
    +'<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px;margin:14px 0 4px">'
    +box('📈 '+(va?'Visites':'Visitas'),chart,rangoBtns)
    +box('🧭 '+(va?'Fonts de trànsit hui':'Fuentes de tráfico hoy'),fuentesHtml+langBar)
    +box('🔝 '+(va?'Pàgines més vistes hui':'Páginas más vistas hoy'),topHtml)
    +'</div>'
    +'<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px;margin:0 0 4px">'
    +box('🎯 '+(va?'Embut de la comunitat':'Embudo de la comunidad'),funnel)
    +box('🕓 '+(va?'Activitat recent':'Actividad reciente'),'<div id="feedAct"><p class="sub" style="margin:0">'+T('cargando')+'</p></div>')
    +'</div>'
    +'<div style="margin-top:14px">'+box('🌐 '+(va?'Xarxes socials: ixen i entren':'Redes sociales: salen y entran'),redesHtml)+'</div>'
    +sec('🧮 '+(va?'La comunitat en total':'La comunidad en total'))
    +'<div class="dash">'
    +card(a.registrosTotal||0,(va?'Usuaris registrats':'Usuarios registrados')+masHoy(a.registrosHoy),'','','👤')
    +card(a.newsTotal||0,(va?'Subscriptors newsletter':'Suscriptores newsletter')+masHoy(a.newsHoy),'','leads','📬')
    +card(a.afiliadosAct||0,va?'Afiliats actius':'Afiliados activos','','afiliados','🤝')
    +card((a.donCount||0)+' · '+EUR2(a.donTotalCents||0),va?'Donacions (històric total)':'Donaciones (histórico total)','','donations','💛')
    +card((a.donPendCount||0)+' · '+EUR2(a.donPendCents||0),va?'Aquest mes (pendent d\\'ingrés)':'Este mes (pendiente de ingreso)',a.donPendCents?'good':'','donations','⏳')
    +card(a.votTotal||0,(va?'Vots totals':'Votos totales')+masHoy(a.votHoy),'','','🗳️')
    +card(a.propTotal||0,(va?'Propostes rebudes':'Propuestas recibidas')+masHoy(a.propHoy),'','proposals','💡')
    +card(a.chatHoy||0,va?'Missatges de xat hui':'Mensajes de chat hoy','','comunidad','💭')
    +card(EUR2(saldo),(saldo<0?(va?'Dèficit de tresoreria':'Déficit de tesorería'):(va?'Saldo de tresoreria':'Saldo de tesorería')),saldo<0?'alert':'good','tesoreria','💶')
    +'</div>'
    +'<div style="margin-top:14px">'+box('💛 '+(va?'Últimes donacions':'Últimas donaciones')+' <span style="font:600 11px Public Sans;color:#66788A">'+(va?'· qui, quant i quan':'· quién, cuánto y cuándo')+'</span>',
      (a.donLista&&a.donLista.length
        ? '<div style="display:flex;flex-direction:column;gap:6px">'+a.donLista.map(function(d){return '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 12px;background:#F7F9FC;border:1px solid #EEF2F7;border-radius:3px">'
            +'<span style="font:600 13.5px Public Sans;color:#17232F;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0">'+String(d.nombre).replace(/[&<]/g,function(c){return c==='&'?'&amp;':'&lt;';})+'</span>'
            +'<span style="font:600 12px Public Sans;color:#66788A;white-space:nowrap">'+d.fecha+'</span>'
            +'<span style="font:800 13.5px Public Sans;color:#1E7A45;white-space:nowrap">'+EUR2(d.cents)+(d.liquidada?'':' <span style="font:700 9px Public Sans;color:#9A6208;background:#FBF0DC;padding:1px 6px;border-radius:3px;vertical-align:middle">'+(va?'PENDENT':'PENDIENTE')+'</span>')+'</span>'
            +'</div>';}).join('')+'</div>'
        : '<p class="sub" style="margin:0">'+(va?'Encara no hi ha donacions.':'Aún no hay donaciones.')+'</p>'))
    +'</div></div>';

  // Toggle 7/30 días
  const rg7=document.getElementById('rg7'), rg30=document.getElementById('rg30');
  const setRg=(m)=>{
    document.getElementById('ch7').style.display=m===7?'':'none';
    document.getElementById('ch30').style.display=m===30?'':'none';
    rg7.style.background=m===7?'#fff':'none'; rg7.style.color=m===7?'#0A2A5E':'#5C6B7A'; rg7.style.boxShadow=m===7?'0 1px 4px rgba(10,42,94,.12)':'none';
    rg30.style.background=m===30?'#fff':'none'; rg30.style.color=m===30?'#0A2A5E':'#5C6B7A'; rg30.style.boxShadow=m===30?'0 1px 4px rgba(10,42,94,.12)':'none';
  };
  if(rg7&&rg30){rg7.onclick=()=>setRg(7);rg30.onclick=()=>setRg(30);}

  // Selector de día + tooltip del gráfico horario
  let diaSel=0, cmpData=c0;
  const pintaDia=(i2)=>{
    diaSel=i2; cmpData=buildCmp(i2);
    document.getElementById('cmpWrap').innerHTML=cmpData.svg;
    document.getElementById('cmpNC').textContent=cmpData.totC;
    document.getElementById('cmpNP').textContent=cmpData.prevAlli;
    document.getElementById('cmpNT').textContent=cmpData.totP;
    document.getElementById('cmpTitulo').textContent=(va?'Visites: ':'Visitas: ')+nomDia(i2).toLowerCase()+(va?' contra ':' contra ')+nomDia(i2+1).toLowerCase()+(va?', hora a hora':', hora a hora');
    document.querySelectorAll('#diaSel [data-dia]').forEach(b2=>{
      const on=Number(b2.dataset.dia)===i2;
      b2.style.background=on?'#fff':'none'; b2.style.color=on?'#0A2A5E':'#5C6B7A'; b2.style.boxShadow=on?'0 1px 4px rgba(10,42,94,.12)':'none';
    });
    armaTip();
  };
  document.querySelectorAll('#diaSel [data-dia]').forEach(b2=>{ b2.onclick=()=>pintaDia(Number(b2.dataset.dia)); });
  function armaTip(){
    const svg=document.getElementById('svgCmp'), tip=document.getElementById('cmpTip');
    if(!svg||!tip)return;
    const cross=svg.querySelector('#cmpCross'), dotC=svg.querySelector('#cmpDotC'), dotP=svg.querySelector('#cmpDotP');
    const GX=h2=>Math.round(h2/23*450)+15, GY=v2=>132-Math.round(v2/cmpData.maxY*108);
    svg.onmousemove=(e2)=>{
      const rct=svg.getBoundingClientRect();
      const xs=(e2.clientX-rct.left)*(480/rct.width);
      const h2=Math.max(0,Math.min(23,Math.round((xs-15)/450*23)));
      const vC=h2<=cmpData.hMax?cmpData.cumC[h2]:null, vP=cmpData.cumP[h2];
      cross.setAttribute('x1',GX(h2)); cross.setAttribute('x2',GX(h2)); cross.style.display='';
      if(vC!=null){dotC.setAttribute('cx',GX(h2));dotC.setAttribute('cy',GY(vC));dotC.style.display='';}else dotC.style.display='none';
      dotP.setAttribute('cx',GX(h2)); dotP.setAttribute('cy',GY(vP)); dotP.style.display='';
      tip.innerHTML='<b>'+h2+':00</b> — '+nomDia(diaSel)+': <b style="color:#F6BE18">'+(vC!=null?vC:'—')+'</b> · '+nomDia(diaSel+1)+': '+vP;
      tip.style.display='block';
      const box2=svg.parentElement.parentElement.getBoundingClientRect();
      let lx=e2.clientX-box2.left+14; if(lx>box2.width-170)lx=e2.clientX-box2.left-170;
      tip.style.left=lx+'px'; tip.style.top=(e2.clientY-box2.top-38)+'px';
    };
    svg.onmouseleave=()=>{tip.style.display='none';cross.style.display='none';dotC.style.display='none';dotP.style.display='none';};
  }
  armaTip();

  // Feed de actividad reciente
  call({action:'actividad'}).then(rf=>{
    const el=document.getElementById('feedAct'); if(!el)return;
    const items=(rf.j&&rf.j.items)||[];
    if(!items.length){el.innerHTML='<p class="sub" style="margin:0">'+(va?'Sense activitat encara.':'Sin actividad todavía.')+'</p>';return;}
    const IC={propuesta:'💡',comentario:'💬',contacto:'✉️',donacion:'💛',denuncia:'🛡️'};
    const ESTCOL={pendiente:'#D98A0B',pendiente_moderacion:'#D98A0B',nuevo:'#D98A0B',nueva:'#D98A0B',publicado:'#1E7A45',publicada:'#1E7A45',pagada:'#1E7A45',rechazado:'#C0392B',rechazada:'#C0392B',iniciada:'#8A99A8'};
    const rel=(iso)=>{const m2=Math.floor((Date.now()-new Date(iso).getTime())/6e4);if(m2<60)return(va?'fa ':'hace ')+m2+' min';const h3=Math.floor(m2/60);if(h3<24)return(va?'fa ':'hace ')+h3+' h';return(va?'fa ':'hace ')+Math.floor(h3/24)+(va?' dies':' días');};
    el.innerHTML='<div style="max-height:280px;overflow-y:auto">'+items.map(x=>'<div style="display:flex;gap:9px;padding:7px 0;border-bottom:1px dashed #EEF2F7;font-size:12.5px;align-items:flex-start"><span style="flex-shrink:0">'+(IC[x.tipo]||'·')+'</span><div style="min-width:0;flex:1"><div style="color:#17232F;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+EH(x.titulo||'')+'</div><div style="color:#8A99A8;font-size:11.5px">'+(x.quien?EH(x.quien)+' · ':'')+rel(x.at)+(x.estado?' · <span style="font-weight:700;color:'+(ESTCOL[x.estado]||'#8A99A8')+'">'+EH(String(x.estado).replace(/_/g,' '))+'</span>':'')+'</div></div></div>').join('')+'</div>';
  });
}
// Badges de pendientes en el menú lateral
function updBadges(d){
  AF_MAX_TS=d.afiliadoMaxTs||0;
  // Afiliaciones nuevas: solo cuentan si el alta más reciente es POSTERIOR a la última vez que el
  // equipo abrió la pestaña Afiliados (marca guardada en acg_af_seen). Así el badge se limpia al verlas.
  let afN=d.afiliadosNuevos||0;
  const seen=+(localStorage.getItem('acg_af_seen')||0);
  if(!AF_MAX_TS||AF_MAX_TS<=seen)afN=0;
  const map={proposals:d.propuestasPendientes,reportes:d.reportesPendientes,comments:d.comentariosPendientes,denuncias:d.denunciasAbiertas,contactos:d.contactosNuevos,comunidad:d.apelacionesPendientes,afiliados:afN};
  document.querySelectorAll('#tabs button').forEach(b=>{
    const n=map[b.dataset.t]||0;
    let s=b.querySelector('.bdg');
    if(n){ if(!s){s=document.createElement('span');s.className='bdg';s.style.cssText='margin-left:auto;background:#C0392B;color:#fff;border-radius:99px;font:800 10.5px Public Sans;padding:2px 7px';b.appendChild(s);} s.textContent=n; }
    else if(s)s.remove();
  });
}

async function renderComunidad(){
  const va=LANG==='va';
  $('#main').innerHTML='<div class="page"><h2>💭 '+(va?'Comunitat':'Comunidad')+'</h2>'
    +'<div style="background:#fff;border:1px solid #E7EDF4;border-radius:16px;padding:18px;margin-bottom:22px;box-shadow:0 3px 14px rgba(10,42,94,.05)">'
    +'<h3 style="font:800 16px Bricolage Grotesque;color:#0A2A5E;margin:0 0 3px">📢 '+(va?'Canal de difusió':'Canal de difusión')+'</h3>'
    +'<p class="sub" style="margin:0 0 12px">'+(va?'Només publica l’equip. Ix a Comunitat i caduca sol.':'Solo publica el equipo. Aparece en la Comunidad de la web y caduca solo.')+'</p>'
    +'<textarea id="bcin" rows="2" maxlength="2000" placeholder="'+(va?'Escriu un anunci per a tota la comunitat…':'Escribe un anuncio para toda la comunidad…')+'"></textarea>'
    +'<div style="display:flex;gap:10px;align-items:center;margin-top:10px;flex-wrap:wrap"><label style="margin:0;font:600 12.5px Public Sans;color:#42525F">'+(va?'Caduca en':'Caduca en')+'</label>'
    +'<select id="bcdias" style="width:auto"><option value="1">1 '+(va?'dia':'día')+'</option><option value="7" selected>7 '+(va?'dies':'días')+'</option><option value="30">30 '+(va?'dies':'días')+'</option></select>'
    +'<button class="btn" onclick="window.bcSend()">'+(va?'Publicar anunci':'Publicar anuncio')+'</button></div>'
    +'<div id="bclist" style="margin-top:14px"></div></div>'
    +'<h3 style="font:800 16px Bricolage Grotesque;color:#0A2A5E;margin:0 0 3px">💬 '+(va?'Xat general':'Chat general')+'</h3>'
    +'<p class="sub">'+(va?'Respons com a «Acció Civil» i modera missatges.':'Respondes como «Acción Civil» y moderas mensajes.')+'</p>'
    +'<div class="chat" id="chatbox"></div><div class="chatbar"><input id="chatin" maxlength="1000" placeholder="'+(va?'Escriu com a Acció Civil…':'Escribe como Acció Civil…')+'"><button class="btn" onclick="window.chatSend()">'+(va?'Enviar':'Enviar')+'</button></div>'
    +'<h3 style="font:800 16px Bricolage Grotesque;color:#C0392B;margin:26px 0 3px">🚫 '+(va?'Membres bloquejats':'Miembros bloqueados')+'</h3>'
    +'<p class="sub">'+(va?'No poden xatejar, comentar ni proposar. Ací pots veure el motiu, la seua apel·lació i desbloquejar-los.':'No pueden chatear, comentar ni proponer. Aquí ves el motivo, su apelación y puedes desbloquearlos.')+'</p>'
    +'<div id="blkbox"></div></div>';
  await window.bcLoad();
  await window.chatLoad();
  await window.blkLoad();
  const inp=$('#chatin'); if(inp)inp.addEventListener('keydown',e=>{if(e.key==='Enter')window.chatSend()});
  POLL=setInterval(()=>{if(TAB==='comunidad')window.chatLoad();},5000);
}
window.bcLoad=async function(){
  const box=$('#bclist'); if(!box)return;
  const va=LANG==='va';
  const r=await call({action:'broadcast-list'});
  const items=(r.j&&r.j.items)||[];
  box.innerHTML=items.length?items.map(m=>{
    const venc=m.expires_at&&new Date(m.expires_at).getTime()<Date.now();
    const meta=String(m.created_at).slice(0,10)+(venc?(va?' · caducado':' · caducat'):(m.expires_at?(va?' · caduca '+String(m.expires_at).slice(0,10):' · caduca '+String(m.expires_at).slice(0,10)):''));
    return '<div class="cm" style="margin-bottom:8px;padding:12px 14px;'+(venc?'opacity:.5':'')+'"><div class="t" style="margin:0 0 6px">'+EH(m.texto)+'</div><div style="display:flex;gap:10px;align-items:center;font-size:12px;color:#8A99A8"><span>'+meta+'</span><span class="x" data-bcdel="'+m.id+'" style="margin-left:auto;color:#C0392B;cursor:pointer;text-decoration:underline">'+(va?'Esborrar':'Borrar')+'</span></div></div>';
  }).join(''):'<p class="sub" style="margin:0">'+(va?'Cap anunci actiu.':'Ningún anuncio activo.')+'</p>';
};
window.bcSend=async function(){
  const ta=$('#bcin'); if(!ta)return; const t=ta.value.trim(); if(!t)return;
  const sel=$('#bcdias'); const dias=Number(sel?sel.value:7);
  ta.value=''; const r=await call({action:'broadcast-send',texto:t,dias:dias});
  if(r.j&&r.j.ok)window.bcLoad(); else toast((r.j.error&&r.j.error.message)||'Error',{error:true});
};
window.bcDel=async function(id){ await call({action:'broadcast-del',id:id}); window.bcLoad(); };
window.chatLoad=async function(){
  const box=$('#chatbox'); if(!box)return;
  const r=await call({action:'chat-list'});
  const va=LANG==='va';
  const items=((r.j&&r.j.items)||[]).slice().reverse();
  box.innerHTML=items.length?items.map(m=>{
    const cls=(m.oficial?'mine':'other')+(m.estado==='oculto'?' off':'');
    const acc=m.estado==='oculto'?(va?'mostrar':'mostrar'):(va?'ocultar':'ocultar');
    const ctl=' <span class="x" data-hide="'+m.id+'" data-show="'+(m.estado==='oculto'?'1':'0')+'">'+acc+'</span>'
      +' <span class="x" data-chatdel="'+m.id+'" style="color:#C0392B">'+(va?'esborrar':'borrar')+'</span>'
      +(m.oficial?'':' <span class="x" data-block="'+m.uid+'" data-blockon="'+(m.bloqueado?'1':'0')+'" style="color:'+(m.bloqueado?'#1E7A45':'#9A6208')+'">'+(m.bloqueado?(va?'desbloquejar':'desbloquear'):(va?'bloquejar':'bloquear'))+'</span>');
    return '<div class="bub '+cls+'"><div class="a">'+EH(m.autor)+(m.bloqueado?' 🚫':'')+' · '+String(m.at).slice(11,16)+ctl+'</div>'+EH(m.texto)+'</div>';
  }).join(''):'<div style="color:#8A99A8;text-align:center;margin:auto">'+(va?'Encara no hi ha missatges.':'Aún no hay mensajes.')+'</div>';
  box.scrollTop=box.scrollHeight;
};
window.chatSend=async function(){
  const inp=$('#chatin'); if(!inp)return; const t=inp.value.trim(); if(!t)return;
  inp.value=''; inp.focus();
  const r=await call({action:'chat-send',texto:t});
  if(r.j&&r.j.ok)window.chatLoad(); else toast((r.j.error&&r.j.error.message)||'Error',{error:true});
};
window.chatHide=async function(id,mostrar){ await call({action:'chat-hide',id:id,mostrar:mostrar}); window.chatLoad(); };
window.chatDel=async function(id){ if(!await askConfirm(LANG==='va'?'Esborrar este missatge definitivament?':'¿Borrar este mensaje definitivamente?',{danger:true,yes:LANG==='va'?'Esborrar':'Borrar'}))return; await call({action:'chat-del',id:id}); window.chatLoad(); };
window.chatBlock=async function(uid,bloquear){
  var va=LANG==='va';
  if(bloquear){
    var motivo=await askBlockReason(); if(!motivo)return;
    var r=await call({action:'user-block',userId:uid,bloquear:true,motivo:motivo});
    if(r.j&&r.j.ok)toast(va?'Usuari bloquejat i avisat':'Usuario bloqueado y avisado');else toast((r.j&&r.j.error&&r.j.error.message)||'Error',{error:true});
  }else{
    if(!await askConfirm(va?'Desbloquejar este usuari? Podrà tornar a participar.':'¿Desbloquear a este usuario? Podrá volver a participar.',{yes:va?'Desbloquejar':'Desbloquear'}))return;
    var r2=await call({action:'user-block',userId:uid,bloquear:false});
    if(r2.j&&r2.j.ok)toast(va?'Usuari desbloquejat':'Usuario desbloqueado');else toast((r2.j&&r2.j.error&&r2.j.error.message)||'Error',{error:true});
  }
  if(window.blkLoad)window.blkLoad(); window.chatLoad();
};
window.blkLoad=async function(){
  var box=document.getElementById('blkbox'); if(!box)return; var va=LANG==='va';
  var r=await call({action:'bloqueados-list'}); var items=(r.j&&r.j.items)||[];
  if(!items.length){box.innerHTML='<p class="sub" style="margin:0">'+(va?'Cap membre bloquejat.':'Ningún miembro bloqueado.')+'</p>';return;}
  box.innerHTML=items.map(function(x){
    var ap=x.apelacion?'<div style="margin-top:8px;background:#FFF7E6;border:1px solid #F3E2B8;border-radius:8px;padding:9px 12px;font:500 13px Public Sans;color:#7A5B12"><b>'+(va?'Apel·lació':'Apelación')+(x.apelacionAt?' ('+x.apelacionAt+')':'')+':</b> '+EH(x.apelacion)+'</div>':'';
    return '<div style="background:#fff;border:1px solid #F0D9D9;border-left:3px solid #C0392B;border-radius:10px;padding:12px 14px;margin-bottom:9px">'
      +'<div style="display:flex;gap:10px;align-items:flex-start;flex-wrap:wrap"><div style="min-width:0;flex:1"><b style="color:#17232F">'+EH(x.nombre)+'</b>'+(x.email?' <span style="color:#8A99A8;font-size:12px">'+EH(x.email)+'</span>':'')
      +'<div style="font:500 13px Public Sans;color:#5C6B7A;margin-top:3px"><b style="color:#C0392B">'+(va?'Motiu:':'Motivo:')+'</b> '+EH(x.motivo||'—')+(x.desde?' · '+(va?'des de ':'desde ')+x.desde:'')+'</div></div>'
      +'<button data-block="'+x.id+'" data-blockon="1" style="border:none;cursor:pointer;background:#1E7A45;color:#fff;font:700 12px Public Sans;padding:7px 13px;border-radius:3px;flex-shrink:0">✔ '+(va?'Desbloquejar':'Desbloquear')+'</button></div>'+ap+'</div>';
  }).join('');
};
function askBlockReason(){
  return new Promise(function(res){
    var va=LANG==='va';
    var PRE=va?['Spam o publicitat','Insults o faltes de respecte','Contingut inapropiat o ofensiu','Incomplir les normes de la comunitat','Suplantacio d identitat']
      :['Spam o publicidad','Insultos o faltas de respeto','Contenido inapropiado u ofensivo','Incumplir las normas de la comunidad','Suplantacion de identidad'];
    var o=document.createElement('div');
    o.style.cssText='position:fixed;inset:0;z-index:9800;background:rgba(7,30,69,.55);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:24px';
    var opts=PRE.map(function(m,i){return '<label style="display:flex;gap:9px;align-items:flex-start;padding:9px 11px;border:1px solid #E4EBF2;border-radius:10px;margin-bottom:7px;cursor:pointer;font:500 14px Public Sans;color:#17232F"><input type="radio" name="_bm" value="'+i+'" style="margin-top:3px;width:16px;height:16px">'+m+'</label>';}).join('');
    o.innerHTML='<div style="background:#fff;border-radius:18px;max-width:460px;width:100%;padding:26px;box-shadow:0 30px 80px rgba(10,42,94,.35);max-height:88vh;overflow:auto">'
      +'<h3 style="font:800 17px Fraunces;color:#0A2A5E;margin:0 0 4px">'+(va?'Bloquejar usuari':'Bloquear usuario')+'</h3>'
      +'<p style="font:500 13px Public Sans;color:#5C6B7A;margin:0 0 16px">'+(va?'Tria un motiu (li arribarà per correu):':'Elige un motivo (le llegará por correo):')+'</p>'
      +opts
      +'<label style="display:block;font:600 12px Public Sans;color:#42525F;margin:10px 0 5px">'+(va?'O escriu un motiu propi':'O escribe un motivo propio')+'</label>'
      +'<textarea id="_bmtxt" rows="2" style="width:100%" placeholder="'+(va?'Motiu personalitzat…':'Motivo personalizado…')+'"></textarea>'
      +'<div style="display:flex;gap:10px;margin-top:16px"><button class="btn ghost" id="_bno" style="flex:1;color:#42525F;border-color:#E4EBF2">'+(va?'Cancel·lar':'Cancelar')+'</button>'
      +'<button class="btn" id="_byes" style="flex:1;background:#C0392B">'+(va?'Bloquejar':'Bloquear')+'</button></div></div>';
    document.body.appendChild(o);
    var done=function(v){o.remove();res(v);};
    o.querySelector('#_bno').onclick=function(){done(null);};
    o.querySelector('#_byes').onclick=function(){
      var custom=o.querySelector('#_bmtxt').value.trim();
      var radio=o.querySelector('input[name=_bm]:checked');
      var motivo=custom||(radio?PRE[parseInt(radio.value,10)]:'');
      if(!motivo){toast(va?'Tria o escriu un motiu':'Elige o escribe un motivo',{error:true});return;}
      done(motivo);
    };
    o.addEventListener('click',function(e){if(e.target===o)done(null);});
  });
}

// Bandeja de moderación de propuestas: lo pendiente arriba con acciones de un click.
async function renderModeracion(){
  const va=LANG==='va';
  $('#main').innerHTML='<div class="page"><h2>🗳️ '+(va?'Propostes ciutadanes':'Propuestas ciudadanas')+'</h2><p class="sub">'+T('cargando')+'</p></div>';
  const r=await call({action:'list',tabla:'proposals'});
  ROWS=r.j.items||[];
  const pend=ROWS.filter(p=>p.estado==='pendiente_moderacion');
  const est=ROWS.filter(p=>p.estado==='en_estudio');
  window._modq={pend:pend,est:est};
  const cardMod=(p,k,src)=>{
    const kk=src+'-'+k;
    const borde=src==='est'?'border-left-color:#1563C4;border-color:#CFE1F5':'';
    return '<div class="modcard" style="'+borde+'"><h4 style="cursor:pointer" onclick="modPrev(\\''+src+'\\','+k+')">'+EH(p.titulo)+' <span style="font:600 12px Public Sans;color:#1563C4">👁 '+(va?'vista prèvia':'vista previa')+'</span></h4>'
      +'<div class="meta">'+pill(p.estado)+'<span class="pill" style="background:#EAF3FC;color:#1563C4">'+EH(p.categoria||'—')+'</span>'
      +'<span>📅 '+String(p.created_at).slice(0,10)+'</span>'
      +(p.contacto_nombre?'<span>👤 '+EH(p.contacto_nombre)+'</span>':'')
      +(p.contacto_email?'<a href="mailto:'+EH(p.contacto_email)+'" style="color:#1563C4">'+EH(p.contacto_email)+'</a>':'')
      +(Array.isArray(p.imagenes)&&p.imagenes.length?'<span class="pill" style="background:#FBF0DC;color:#9A6208">📷 '+p.imagenes.length+' '+(va?'fotos':'fotos')+'</span>':'')+'</div>'
      +'<div class="desc" style="white-space:normal;cursor:pointer" onclick="modPrev(\\''+src+'\\','+k+')">'+EH(String(p.descripcion||'').slice(0,220))+(String(p.descripcion||'').length>220?'… <span style="color:#1563C4;font-weight:700">'+(va?'llegir sencera':'leer completa')+'</span>':'')+'</div>'
      +'<div style="display:flex;gap:8px;flex-wrap:wrap">'
      +'<button class="btn sm" style="background:#EEF2F7;color:#0A2A5E" onclick="modPrev(\\''+src+'\\','+k+')">👁 '+(va?'Vista prèvia':'Vista previa')+'</button>'
      +'<button class="btn sm" style="background:#1E7A45" onclick="modAccion(\\''+src+'\\','+k+',\\'publicada\\')">✅ Publicar</button>'
      +(src==='pend'?'<button class="btn sm" style="background:#1563C4" onclick="modAccion(\\''+src+'\\','+k+',\\'en_estudio\\')">🔍 '+(va?'En estudi':'En estudio')+'</button>':'')
      +'<button class="btn sm ghost" style="color:#C0392B" onclick="modRech(\\''+kk+'\\')">✕ '+(va?'Rebutjar':'Rechazar')+'</button></div>'
      +'<div id="modr-'+kk+'" style="display:none;margin-top:10px"><textarea id="modmot-'+kk+'" rows="2" placeholder="'+(va?'Motiu del rebuig (li arribarà per correu i al seu compte)…':'Motivo del rechazo (le llegará por correo y a su cuenta)…')+'"></textarea>'
      +'<button class="btn sm" style="background:#C0392B;margin-top:8px" onclick="modAccion(\\''+src+'\\','+k+',\\'rechazada\\')">'+(va?'Confirmar rebuig':'Confirmar rechazo')+'</button></div></div>';
  };
  const tabla=ROWS.length?SRCH(va?'Busca una proposta…':'Buscar una propuesta…')
    +'<table><thead><tr><th>'+(va?'Títol':'Título')+'</th><th>'+(va?'Categoria':'Categoría')+'</th><th>'+(va?'Estat':'Estado')+'</th><th>'+(va?'Rebuda':'Recibida')+'</th></tr></thead><tbody>'
    +ROWS.map((p,i)=>'<tr onclick="form('+i+')"><td>'+EH(p.titulo)+'</td><td>'+EH(p.categoria||'—')+'</td><td>'+pill(p.estado)+'</td><td>'+String(p.created_at).slice(0,10)+'</td></tr>').join('')
    +'</tbody></table>':'<p class="sub">'+(va?'Cap proposta encara.':'Sin propuestas todavía.')+'</p>';
  $('#main').innerHTML='<div class="page"><div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap"><div style="flex:1"><h2>🗳️ '+(va?'Propostes ciutadanes':'Propuestas ciudadanas')+'</h2>'
    +'<p class="sub" style="margin:0">'+(va?'Cada decisió (publicar, en estudi o rebutjar) s’avisa per correu a l’autor/a i es reflecteix al seu compte.':'Cada decisión (publicar, en estudio o rechazar) se avisa por correo al autor/a y se refleja en su cuenta.')+'</p></div>'
    +'<button class="btn gold" onclick="npForm()">'+(va?'＋ Nova proposta':'＋ Nueva propuesta')+'</button></div>'
    +'<div id="npbox"></div>'
    +(pend.length
      ?'<h3 style="font:800 15px Bricolage Grotesque;color:#9A6208;margin:16px 0 10px">⏳ '+(va?'Pendents de revisió':'Pendientes de revisión')+' ('+pend.length+')</h3>'+pend.map((p,k)=>cardMod(p,k,'pend')).join('')
      :'<div class="aldia">✅ '+(va?'Cap proposta pendent de moderar.':'Ninguna propuesta pendiente de moderar.')+'</div>')
    +(est.length
      ?'<h3 style="font:800 15px Bricolage Grotesque;color:#1563C4;margin:20px 0 10px">🔍 '+(va?'En estudi':'En estudio')+' ('+est.length+')</h3><p class="sub" style="margin:0 0 10px">'+(va?'Aparcades amb avís enviat a l’autor/a. Decideix quan toque: publicar o rebutjar.':'Aparcadas con aviso enviado al autor/a. Decide cuando toque: publicar o rechazar.')+'</p>'+est.map((p,k)=>cardMod(p,k,'est')).join('')
      :'')
    +(function(){var rech=ROWS.filter(function(p){return p.estado==='rechazada';});return rech.length?'<h3 style="font:800 15px Bricolage Grotesque;color:#C0392B;margin:22px 0 8px">🗑️ '+(va?'Rebutjades':'Rechazadas')+' ('+rech.length+')</h3><p class="sub" style="margin:0 0 10px">'+(va?'Arxiva-les (es conserven i ixen de la llista) o elimina-les del tot.':'Archívalas (se conservan y salen de la lista) o elimínalas del todo.')+'</p>'+rech.map(function(p){return '<div style="background:#fff;border:1px solid #F0D9D9;border-radius:10px;padding:11px 13px;margin-bottom:8px;display:flex;gap:10px;align-items:center;flex-wrap:wrap"><div style="min-width:0;flex:1"><b style="color:#17232F">'+EH(p.titulo||'')+'</b>'+(p.motivo_rechazo?'<div style="font:500 12.5px Public Sans;color:#8A99A8;margin-top:2px">'+EH(p.motivo_rechazo)+'</div>':'')+'</div><button data-parch="'+p.id+'" style="border:none;cursor:pointer;background:#5C6B7A;color:#fff;font:700 12px Public Sans;padding:7px 12px;border-radius:3px">🗂 '+(va?'Arxivar':'Archivar')+'</button><button data-pdel="'+p.id+'" style="border:none;cursor:pointer;background:#C0392B;color:#fff;font:700 12px Public Sans;padding:7px 12px;border-radius:3px">🗑 '+(va?'Eliminar':'Eliminar')+'</button></div>';}).join(''):'';})()
    +(function(){var arch=ROWS.filter(function(p){return p.estado==='archivada';});return arch.length?'<details style="margin:22px 0 4px"><summary style="cursor:pointer;font:800 15px Bricolage Grotesque;color:#5C6B7A;list-style:none">🗂 '+(va?'Arxivades':'Archivadas')+' ('+arch.length+') <span style="font:600 12px Public Sans;color:#8A99A8">'+(va?'· desplega per veure-les':'· despliega para verlas')+'</span></summary><p class="sub" style="margin:8px 0 10px">'+(va?'Guardades, fora de la web i de la llista de rebutjades. Pots desarxivar-les o eliminar-les.':'Guardadas, fuera de la web y de la lista de rechazadas. Puedes desarchivarlas o eliminarlas.')+'</p>'+arch.map(function(p){return '<div style="background:#F7F9FC;border:1px solid #E4EBF2;border-radius:10px;padding:11px 13px;margin-bottom:8px;display:flex;gap:10px;align-items:center;flex-wrap:wrap"><div style="min-width:0;flex:1"><b style="color:#42525F">'+EH(p.titulo||'')+'</b>'+(p.motivo_rechazo?'<div style="font:500 12.5px Public Sans;color:#8A99A8;margin-top:2px">'+EH(p.motivo_rechazo)+'</div>':'')+'</div><button data-punarch="'+p.id+'" style="border:none;cursor:pointer;background:#1563C4;color:#fff;font:700 12px Public Sans;padding:7px 12px;border-radius:3px">↩ '+(va?'Desarxivar':'Desarchivar')+'</button><button data-pdel="'+p.id+'" style="border:none;cursor:pointer;background:#C0392B;color:#fff;font:700 12px Public Sans;padding:7px 12px;border-radius:3px">🗑 '+(va?'Eliminar':'Eliminar')+'</button></div>';}).join('')+'</details>':'';})()
    +'<h3 style="font:800 15px Bricolage Grotesque;color:#0A2A5E;margin:20px 0 6px">'+(va?'Totes les propostes':'Todas las propuestas')+'</h3>'
    +tabla+'<div id="fbox"></div></div>';
}
window.propArch=async function(id){ if(!await askConfirm(LANG==='va'?'Arxivar esta proposta rebutjada? Es conserva però ix de la llista.':'¿Archivar esta propuesta rechazada? Se conserva pero sale de la lista.'))return; var r=await call({action:'prop-archivar',id:id}); if(r.j&&r.j.ok){toast(LANG==='va'?'Arxivada':'Archivada');renderModeracion();}else toast((r.j&&r.j.error&&r.j.error.message)||'Error',{error:true}); };
window.propDel=async function(id){ if(!await askConfirm(LANG==='va'?'Eliminar definitivament esta proposta i els seus comentaris? No es pot desfer.':'¿Eliminar definitivamente esta propuesta y sus comentarios? No se puede deshacer.',{danger:true,yes:LANG==='va'?'Eliminar':'Eliminar'}))return; var r=await call({action:'prop-eliminar',id:id}); if(r.j&&r.j.ok){toast(LANG==='va'?'Eliminada':'Eliminada');renderModeracion();}else toast((r.j&&r.j.error&&r.j.error.message)||'Error',{error:true}); };
window.propUnarch=async function(id){ var r=await call({action:'prop-desarchivar',id:id}); if(r.j&&r.j.ok){toast(LANG==='va'?'Desarxivada':'Desarchivada');renderModeracion();}else toast((r.j&&r.j.error&&r.j.error.message)||'Error',{error:true}); };
document.addEventListener('click',function(e){if(!e.target||!e.target.closest)return;var a=e.target.closest('[data-parch]');if(a){window.propArch(a.getAttribute('data-parch'));return;}var u=e.target.closest('[data-punarch]');if(u){window.propUnarch(u.getAttribute('data-punarch'));return;}var d=e.target.closest('[data-pdel]');if(d)window.propDel(d.getAttribute('data-pdel'));});
window.modRech=function(kk){const b=document.getElementById('modr-'+kk);if(b){b.style.display=b.style.display==='none'?'block':'none';const t=b.querySelector('textarea');if(b.style.display==='block'&&t)t.focus();}};
// Crear propuesta desde el panel (misma estética que la web; fotos por arrastre)
const NP_CATS=[['Urbanismo y vivienda','🏘️'],['Movilidad y transporte','🚌'],['Medio ambiente','🌳'],['Cultura y fiestas','🎉'],['Educación','🎓'],['Sanidad','🏥'],['Servicios sociales','🤝'],['Seguridad ciudadana','🛡️'],['Economía local','🛍️'],['Deportes','⚽'],['Turismo','🏖️'],['Otro','💡']];
window.npForm=function(){
  const va=LANG==='va';
  const box=$('#npbox'); if(!box)return;
  if(box.innerHTML){ box.innerHTML=''; return; }
  box.innerHTML='<div class="form" style="margin:14px 0"><h3 style="font-family:Bricolage Grotesque;color:#0A2A5E;margin:0">'+(va?'Nova proposta ciutadana':'Nueva propuesta ciudadana')+'</h3>'
    +'<p class="sub" style="margin:6px 0 0">'+(va?'Per a pujar propostes rebudes en paper, mesas informatives, etc. Ix al web amb el mateix format que qualsevol altra.':'Para subir propuestas recibidas en papel, mesas informativas, etc. Sale en la web con el mismo formato que cualquier otra.')+'</p>'
    +'<label>'+(va?'Títol':'Título')+'</label><input id="np_t" maxlength="140">'
    +'<label>'+(va?'Descripció (l’argument sencer)':'Descripción (el argumento entero)')+'</label><textarea id="np_d" rows="7"></textarea>'
    +'<label>'+(va?'Categoria':'Categoría')+'</label><select id="np_c">'+NP_CATS.map(c=>'<option value="'+c[0]+'">'+c[1]+' '+c[0]+'</option>').join('')+'</select>'
    +'<label>'+(va?'Barri':'Barrio')+'</label><select id="np_b"><option value="">'+(va?'Tota la ciutat / sense barri':'Toda la ciudad / sin barrio')+'</option>'+BARRIOS.map(b=>'<option value="'+b.id+'">'+EH(b.nombre_es)+'</option>').join('')+'</select>'
    +'<label>'+(va?'Autor/a públic (com ha d’eixir al web)':'Autor/a público (como debe salir en la web)')+'</label><input id="np_a" placeholder="'+(va?'p. ex. María del Grau, o «Recollida en mesa informativa»':'p. ej. María del Grao, o «Recogida en mesa informativa»')+'">'
    +'<label>Email '+(va?'de contacte (opcional, per a avisar-lo)':'de contacto (opcional, para avisarle)')+'</label><input id="np_e" type="email">'
    +'<label>'+(va?'Fotos (opcional, màx. 3)':'Fotos (opcional, máx. 3)')+'</label>'
    +[1,2,3].map(i=>'<div class="drop" data-k="np'+i+'" style="margin-bottom:8px"><span>'+(va?'Arrossega o fes clic — foto ':'Arrastra o haz clic — foto ')+i+'</span><input type="file" id="file_np'+i+'" accept="image/*" style="display:none"></div><input type="hidden" id="f_np'+i+'">').join('')
    +'<label>'+(va?'Com entra':'Cómo entra')+'</label><select id="np_s"><option value="publicada">'+(va?'Publicada directament al web':'Publicada directamente en la web')+'</option><option value="pendiente_moderacion">'+(va?'A la cua de moderació':'A la cola de moderación')+'</option></select>'
    +'<div style="display:flex;gap:10px;margin-top:18px"><button class="btn gold" onclick="npCrear(this)">'+(va?'Crear proposta':'Crear propuesta')+'</button>'
    +'<button class="btn" style="background:#EEF2F7;color:#42525F" onclick="document.getElementById(\\'npbox\\').innerHTML=\\'\\'">'+T('cancelar')+'</button></div><div id="npmsg" class="msg"></div></div>';
  box.querySelectorAll('.drop').forEach(z=>{
    const k=z.dataset.k, inp=document.getElementById('file_'+k);
    z.addEventListener('click',()=>inp.click());
    z.addEventListener('dragover',e=>{e.preventDefault();z.classList.add('over');});
    z.addEventListener('dragleave',()=>z.classList.remove('over'));
    z.addEventListener('drop',e=>{e.preventDefault();z.classList.remove('over');if(e.dataTransfer.files[0])subirImg(k,e.dataTransfer.files[0]);});
    inp.addEventListener('change',()=>{if(inp.files[0])subirImg(k,inp.files[0]);});
  });
  box.scrollIntoView({behavior:'smooth'});
};
window.npCrear=async function(btn){
  const va=LANG==='va';
  const g=id=>((document.getElementById(id)||{}).value||'').trim();
  const imagenes=[1,2,3].map(i=>g('f_np'+i)).filter(Boolean);
  const msg=$('#npmsg');
  btn.disabled=true;
  const r=await call({action:'proposals-crear',titulo:g('np_t'),descripcion:g('np_d'),categoria:g('np_c'),barrioId:g('np_b'),autor:g('np_a'),email:g('np_e'),estado:g('np_s'),imagenes:imagenes});
  btn.disabled=false;
  if(r.j&&r.j.ok){ toast(g('np_s')==='publicada'?(va?'Creada i publicada al web ✓':'Creada y publicada en la web ✓'):(va?'Creada a la cua de moderació ✓':'Creada en la cola de moderación ✓')); renderModeracion(); }
  else if(msg){ msg.innerHTML='<span class="warn">'+((r.j.error&&r.j.error.message)||'Error')+'</span>'; }
};
// Vista previa: la propuesta tal y como se verá en la web pública
window.modPrev=function(src,k){
  const va=LANG==='va';
  const p=((window._modq||{})[src]||[])[k]; if(!p)return;
  const old=document.getElementById('acg-modprev'); if(old)old.remove();
  const ov=document.createElement('div');
  ov.id='acg-modprev';
  ov.style.cssText='position:fixed;inset:0;background:rgba(10,42,94,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
  ov.innerHTML='<div style="background:#F4F7FB;border-radius:20px;max-width:660px;width:100%;max-height:86vh;overflow:auto;box-shadow:0 24px 60px rgba(10,42,94,.35)">'
    +'<div style="background:#0A2A5E;border-radius:20px 20px 0 0;padding:14px 22px;display:flex;align-items:center;gap:10px"><img src="/assets/icon-192.png" width="30" height="30" style="border-radius:8px;background:#fff"><span style="font:800 13px Public Sans;color:#fff">'+(va?'Així es veurà al web':'Así se verá en la web')+'</span><button onclick="document.getElementById(\\'acg-modprev\\').remove()" style="margin-left:auto;background:none;border:0;color:#fff;font-size:20px;cursor:pointer">✕</button></div>'
    +'<div style="padding:26px 28px"><div style="background:#fff;border:1px solid #E7EDF4;border-radius:16px;padding:26px 28px;box-shadow:0 3px 14px rgba(10,42,94,.06)">'
    +'<span class="pill" style="background:#EAF3FC;color:#1563C4">'+EH(p.categoria||'—')+'</span>'
    +'<h2 style="font:800 24px Bricolage Grotesque;color:#0A2A5E;margin:12px 0 8px;line-height:1.2">'+EH(p.titulo)+'</h2>'
    +'<p style="font:600 12.5px Public Sans;color:#8A99A8;margin:0 0 16px">'+(va?'Proposta ciutadana · rebuda el ':'Propuesta ciudadana · recibida el ')+String(p.created_at).slice(0,10)+'</p>'
    +'<div style="font:400 15px Public Sans;color:#33414F;line-height:1.7;white-space:pre-wrap">'+EH(p.descripcion||'')+'</div>'
    +(Array.isArray(p.imagenes)&&p.imagenes.length?'<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;margin-top:18px">'+p.imagenes.map(u=>'<a href="'+EH(u)+'" target="_blank" rel="noopener"><img src="'+EH(u)+'" style="width:100%;height:120px;object-fit:cover;border-radius:12px;border:1px solid #E7EDF4"></a>').join('')+'</div>':'')
    +'<div style="display:flex;gap:10px;margin-top:22px"><span style="background:#1563C4;color:#fff;border-radius:10px;padding:10px 18px;font:700 13.5px Public Sans">👍 '+(va?'Donar suport':'Apoyar')+'</span><span style="background:#EEF2F7;color:#42525F;border-radius:10px;padding:10px 18px;font:700 13.5px Public Sans">💬 '+(va?'Comentar':'Comentar')+'</span></div>'
    +'</div></div></div>';
  ov.addEventListener('click',function(e){if(e.target===ov)ov.remove();});
  document.body.appendChild(ov);
};
window.modAccion=async function(src,k,estado){
  const va=LANG==='va';
  const p=((window._modq||{})[src]||[])[k]; if(!p)return;
  let motivo=null;
  if(estado==='rechazada'){
    motivo=((document.getElementById('modmot-'+src+'-'+k)||{}).value||'').trim();
    if(motivo.length<5){ toast(va?'Escriu el motiu del rebuig':'Escribe el motivo del rechazo',{error:true}); return; }
  }
  const r=await call({action:'proposals-moderar',id:p.id,estado:estado,motivo:motivo});
  if(r.j&&r.j.ok){
    const av=r.j.emailed?(va?' · autor/a avisat per correu ✉️':' · autor/a avisado por correo ✉️'):'';
    toast((estado==='publicada'?(va?'Publicada ✓':'Publicada ✓'):estado==='en_estudio'?(va?'En estudi ✓':'En estudio ✓'):(va?'Rebutjada ✓':'Rechazada ✓'))+av);
    renderModeracion();
  } else toast((r.j.error&&r.j.error.message)||'Error',{error:true});
};

async function renderContactos(){
  const va=LANG==='va';
  $('#main').innerHTML='<div class="page"><h2>✉️ '+(va?'Contactes':'Contactos')+'</h2><p class="sub">'+T('cargando')+'</p></div>';
  const r=await call({action:'contactos-list'});
  if(!r.j||!r.j.ok){
    $('#main').innerHTML='<div class="page"><h2>✉️ '+(va?'Contactes':'Contactos')+'</h2><p class="warn">'+((r.j&&r.j.error&&r.j.error.message)||'Error')+'</p><p class="sub">Crea la tabla pegando <b>supabase/migrations/007_contact_messages.sql</b> en el SQL Editor de Supabase.</p></div>';return;
  }
  const items=r.j.items||[];
  const body=items.length?items.map(m=>'<div class="cm"><div class="h"><b>'+EH(m.nombre)+' '+EH(m.apellidos||'')+'</b> <a class="em" href="mailto:'+EH(m.email)+'">'+EH(m.email)+'</a> '+pill(m.estado)+'<span style="margin-left:auto;color:#8A99A8;font-size:12px">'+String(m.created_at).slice(0,10)+'</span></div>'+(m.asunto?'<div style="font-weight:700;font-size:13.5px;margin-bottom:4px">'+EH(m.asunto)+'</div>':'')+'<div class="t">'+EH(m.mensaje)+'</div><div class="acts"><button class="btn sm" data-crep="'+m.id+'">'+(va?'Respondre des del panell':'Responder desde el panel')+'</button><button class="btn sm gold" data-cid="'+m.id+'" data-est="leido">'+(va?'Marca llegit':'Marcar leído')+'</button><button class="btn sm ghost" data-cid="'+m.id+'" data-est="archivado">'+(va?'Arxivar':'Archivar')+'</button></div>'
    +'<div id="crep-'+m.id+'" style="display:none;margin-top:10px"><textarea id="crept-'+m.id+'" rows="4" placeholder="'+(va?'Escriu la resposta… S’envia des de noticias@ amb la plantilla del partit.':'Escribe la respuesta… Se envía desde noticias@ con la plantilla del partido.')+'"></textarea><div style="display:flex;gap:8px;margin-top:8px"><button class="btn sm gold" data-crepsend="'+m.id+'">'+(va?'Enviar resposta':'Enviar respuesta')+'</button><button class="btn sm ghost" data-crep="'+m.id+'">'+(va?'Cancel·lar':'Cancelar')+'</button></div></div></div>').join(''):'<p class="sub">'+(va?'Cap missatge encara.':'Sin mensajes todavía.')+'</p>';
  $('#main').innerHTML='<div class="page"><h2>✉️ '+(va?'Contactes':'Contactos')+'</h2><p class="sub">'+(va?'Missatges rebuts pel formulari de Contacte.':'Mensajes recibidos por el formulario de Contacto.')+'</p>'+(items.length>3?SRCH(va?'Busca per nom, email o text…':'Buscar por nombre, email o texto…'):'')+body+'</div>';
}
window.cEstado=async function(id,estado){ await call({action:'contactos-estado',id:id,estado:estado}); renderContactos(); };
window.cReply=async function(id,btn){
  const va=LANG==='va';
  const ta=document.getElementById('crept-'+id);
  const texto=(ta&&ta.value||'').trim();
  if(texto.length<2){ toast(va?'Escriu la resposta':'Escribe la respuesta',{error:true}); return; }
  if(btn){ btn.disabled=true; btn.textContent=va?'Enviant…':'Enviando…'; }
  const r=await call({action:'contactos-reply',id:id,texto:texto});
  if(r.j&&r.j.ok){ toast(va?'Resposta enviada ✓':'Respuesta enviada ✓'); renderContactos(); }
  else { if(btn){ btn.disabled=false; btn.textContent=va?'Enviar resposta':'Enviar respuesta'; } toast((r.j.error&&r.j.error.message)||'Error',{error:true}); }
};

// ---- Comentarios: todos publicados; sospechosos en rojo; borrado definitivo ----
var _MALAS=['puta','puto','putas','putos','puton','cabron','cabrones','cabro','gilipollas','gilipolles','gilipoll','capullo','capulla','imbecil','imbecils','subnormal','subnormals','retrasado','retrasada','mongolo','mongola','tarado','tarada','maricon','maricones','marica','zorra','zorras','mamon','mamones','pendejo','escoria','racista','nazi'];
function ofensivo(t){ var s=(''+(t||'')).toLowerCase().split('á').join('a').split('é').join('e').split('í').join('i').split('ó').join('o').split('ú').join('u'); if(s.indexOf('hijo de puta')>=0||s.indexOf('hija de puta')>=0||s.indexOf('fill de puta')>=0||s.indexOf('vete a la mierda')>=0) return true; var toks=s.split(/[^a-zñ]+/); for(var i=0;i<toks.length;i++){ if(_MALAS.indexOf(toks[i])>=0) return true; } return false; }
async function renderComments(){
  var va=LANG==='va', ttl='💬 '+(va?'Comentaris':'Comentarios');
  $('#main').innerHTML='<div class="page"><h2>'+ttl+'</h2><p class="sub">'+T('cargando')+'</p></div>';
  var r=await call({action:'comentarios-list'});
  if(!r.j||!r.j.ok){ $('#main').innerHTML='<div class="page"><h2>'+ttl+'</h2><p class="warn">'+((r.j&&r.j.error&&r.j.error.message)||'Error')+'</p></div>'; return; }
  var items=r.j.items||[];
  var flag=items.filter(function(c){return ofensivo(c.texto);}).length;
  var body=items.length?items.map(function(c){
    var of=ofensivo(c.texto);
    var autor=(c.profiles&&c.profiles.nombre)||(va?'Anònim':'Anónimo');
    var prop=(c.proposals&&c.proposals.titulo)||'—';
    return '<div class="cm" style="'+(of?'border:2px solid #D93B3B;background:#FDF2F2;':'')+'"><div class="h"><b>'+EH(autor)+'</b> '+pill(c.estado)+(of?' <span style="color:#D93B3B;font-weight:700;font-size:12px">⚠ '+(va?'possible contingut ofensiu':'posible contenido ofensivo')+'</span>':'')+'<span style="margin-left:auto;color:#8A99A8;font-size:12px">'+String(c.created_at).slice(0,10)+'</span></div><div style="font-size:12px;color:#8A99A8;margin-bottom:4px">'+(va?'A la proposta:':'En la propuesta:')+' '+EH(prop)+'</div><div class="t">'+EH(c.texto)+'</div><div class="acts"><button class="btn sm ghost" style="color:#C0392B" data-cdel="'+c.id+'">🗑 '+(va?'Esborrar':'Borrar')+'</button></div></div>';
  }).join(''):'<p class="sub">'+(va?'Cap comentari encara.':'Sin comentarios todavía.')+'</p>';
  $('#main').innerHTML='<div class="page"><h2>'+ttl+'</h2><p class="sub">'+(va?'Tots els comentaris publicats. Els sospitosos ixen en roig; revisa i esborra els que calga (definitiu).':'Todos los comentarios publicados. Los sospechosos salen en rojo; revisa y borra los que haga falta (definitivo).')+'</p>'+(flag?'<div class="warn" style="background:#FDF2F2;border-color:#F5C9C9;color:#C0392B">⚠ '+flag+' '+(va?'comentari(s) marcat(s) com a possiblement ofensiu(s).':'comentario(s) marcado(s) como posiblemente ofensivo(s).')+'</div>':'')+(items.length>3?SRCH(va?'Busca per text o autor…':'Buscar por texto o autor…'):'')+body+'</div>';
}
window.cDelComment=async function(id){ var va=LANG==='va'; if(!await askConfirm(va?'Esborrar este comentari definitivament? No es pot desfer.':'¿Borrar este comentario definitivamente? No se puede deshacer.',{danger:true,yes:va?'Esborrar':'Borrar'}))return; var r=await call({action:'comentario-borrar',id:id}); if(r.j&&r.j.ok){toast(va?'Comentari esborrat':'Comentario borrado');renderComments();}else toast((r.j&&r.j.error&&r.j.error.message)||'Error',{error:true}); };
document.addEventListener('click',function(e){if(!e.target||!e.target.closest)return;var d=e.target.closest('[data-cdel]');if(d)window.cDelComment(d.getAttribute('data-cdel'));});

async function renderReportes(){
  var va=LANG==='va', ttl='🚩 '+(va?'Denúncies de propostes':'Denuncias de propuestas');
  $('#main').innerHTML='<div class="page"><h2>'+ttl+'</h2><p class="sub">'+T('cargando')+'</p></div>';
  var r=await call({action:'reportes-list'});
  if(!r.j||!r.j.ok){ $('#main').innerHTML='<div class="page"><h2>'+ttl+'</h2><p class="warn">'+((r.j&&r.j.error&&r.j.error.message)||'Error')+'</p></div>'; return; }
  var items=r.j.items||[];
  var MOT={spam:'Spam',ofensivo:va?'Ofensiu':'Ofensivo',falso:va?'Info falsa':'Info falsa',duplicado:va?'Duplicada':'Duplicada',otro:va?'Altre motiu':'Otro motivo'};
  var groups={};
  items.forEach(function(x){ var g=groups[x.proposal_id]||(groups[x.proposal_id]={tit:(x.proposals&&x.proposals.titulo)||'—',pid:x.proposal_id,list:[]}); g.list.push(x); });
  var keys=Object.keys(groups);
  keys.sort(function(a,b){ return groups[b].list.length-groups[a].list.length; });
  var pend=items.filter(function(x){return x.estado==='pendiente';}).length;
  var body=keys.length?keys.map(function(k){
    var g=groups[k];
    var rows=g.list.map(function(x){
      return '<div style="border-top:1px solid #EEF2F7;padding-top:8px;margin-top:8px"><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><b style="color:#C0392B">'+EH(MOT[x.motivo]||x.motivo)+'</b> '+pill(x.estado)+'<span style="margin-left:auto;color:#8A99A8;font-size:12px">'+String(x.created_at).slice(0,10)+'</span></div>'+(x.nota?'<div style="color:#42525F;font-size:13px;margin-top:4px">'+EH(x.nota)+'</div>':'')+(x.estado==='pendiente'?'<div class="acts" style="margin-top:6px"><button class="btn sm ghost" data-rrev="'+x.id+'">✓ '+(va?'Marcar revisada':'Marcar revisada')+'</button></div>':'')+'</div>';
    }).join('');
    return '<div class="cm"><div class="h"><b>'+EH(g.tit)+'</b> <span style="background:#FDF2F2;color:#C0392B;font-weight:700;font-size:12px;padding:2px 9px;border-radius:20px">'+g.list.length+' '+(va?'denúncies':'denuncias')+'</span></div>'+rows+'<div class="acts" style="margin-top:10px;border-top:1px solid #EEF2F7;padding-top:10px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn sm ghost" data-rprev="'+g.pid+'">👁 '+(va?'Veure proposta':'Ver propuesta')+'</button><button class="btn sm ghost" data-rdesc="'+g.pid+'">✓ '+(va?'Descartar denúncies':'Descartar denuncias')+'</button><button class="btn sm ghost" style="color:#C0392B" data-rpdel="'+g.pid+'">🗑 '+(va?'Eliminar proposta':'Eliminar propuesta')+'</button></div></div>';
  }).join(''):'<p class="sub">'+(va?'Cap denúncia de moment.':'Ninguna denuncia de momento.')+'</p>';
  $('#main').innerHTML='<div class="page"><h2>'+ttl+'</h2><p class="sub">'+(va?'Propostes que la gent ha denunciat. Revisa-les i, si cal, oculta o esborra la proposta des de «Propostes ciutadanes».':'Propuestas que la gente ha denunciado. Revísalas y, si hace falta, oculta o borra la propuesta desde «Propuestas ciudadanas».')+'</p>'+(pend?'<div class="warn" style="background:#FDF2F2;border-color:#F5C9C9;color:#C0392B">🚩 '+pend+' '+(va?'denúncia(es) pendent(s) de revisar.':'denuncia(s) pendiente(s) de revisar.')+'</div>':'')+(keys.length>3?SRCH(va?'Busca per proposta o motiu…':'Buscar por propuesta o motivo…'):'')+body+'</div>';
}
function rBadges(){ call({action:'dashboard'}).then(function(r){ if(r.j&&r.j.data)updBadges(r.j.data); }); }
window.rRev=async function(id){ var va=LANG==='va'; var r=await call({action:'reporte-revisar',id:id}); if(r.j&&r.j.ok){toast(va?'Marcada com a revisada':'Marcada como revisada');renderReportes();rBadges();}else toast((r.j&&r.j.error&&r.j.error.message)||'Error',{error:true}); };
window.rDesc=async function(pid){ var va=LANG==='va'; if(!await askConfirm(va?'Descartar totes les denúncies d’esta proposta? La proposta es queda tal qual.':'¿Descartar todas las denuncias de esta propuesta? La propuesta se queda tal cual.'))return; var r=await call({action:'reportes-descartar',proposalId:pid}); if(r.j&&r.j.ok){toast(va?'Denúncies descartades':'Denuncias descartadas');renderReportes();rBadges();}else toast((r.j&&r.j.error&&r.j.error.message)||'Error',{error:true}); };
window.rPDel=async function(pid){ var va=LANG==='va'; if(!await askConfirm(va?'Eliminar definitivament esta proposta i tot el seu contingut (comentaris, vots i denúncies)? No es pot desfer.':'¿Eliminar definitivamente esta propuesta y todo su contenido (comentarios, votos y denuncias)? No se puede deshacer.',{danger:true,yes:va?'Eliminar':'Eliminar'}))return; var r=await call({action:'prop-eliminar',id:pid}); if(r.j&&r.j.ok){toast(va?'Proposta eliminada':'Propuesta eliminada');renderReportes();rBadges();}else toast((r.j&&r.j.error&&r.j.error.message)||'Error',{error:true}); };
window.rPrev=async function(pid){
  var va=LANG==='va';
  var o=document.createElement('div'); o.id='rprev-ov';
  o.style.cssText='position:fixed;inset:0;z-index:9999;background:rgba(7,30,69,.55);display:flex;padding:18px;overflow:auto';
  o.innerHTML='<div style="max-width:760px;width:100%;margin:auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 30px 80px rgba(7,30,69,.4)"><div style="display:flex;align-items:center;gap:10px;padding:13px 18px;border-bottom:1px solid #E7EDF4"><b style="font:800 15px Public Sans;color:#0A2A5E">'+(va?'Vista prèvia de la proposta':'Vista previa de la propuesta')+'</b><button id="rprev-x" style="margin-left:auto;border:1px solid #E2E9F1;background:#fff;color:#42525F;font:700 13px Public Sans;padding:7px 14px;border-radius:9px;cursor:pointer">'+(va?'Eixir ✕':'Salir ✕')+'</button></div><div id="rprev-body" style="padding:20px 22px"><p class="sub">'+T('cargando')+'</p></div></div>';
  document.body.appendChild(o);
  function cerrar(){o.remove();}
  o.addEventListener('click',function(e){if(e.target===o)cerrar();});
  document.getElementById('rprev-x').addEventListener('click',cerrar);
  var r=await call({action:'propuesta-get',id:pid});
  var bd=document.getElementById('rprev-body'); if(!bd)return;
  if(!r.j||!r.j.ok){ bd.innerHTML='<p class="warn">'+((r.j&&r.j.error&&r.j.error.message)||'Error')+'</p>'; return; }
  var p=r.j.propuesta;
  var imgs=Array.isArray(p.imagenes)?p.imagenes:[];
  var gal=imgs.length?'<div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0">'+imgs.map(function(u){return '<img src="'+EH(u)+'" style="width:130px;height:96px;object-fit:cover;border-radius:8px;border:1px solid #E4EBF2">';}).join('')+'</div>':'';
  bd.innerHTML='<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">'+pill(p.estado)+'<span style="background:#EAF3FC;color:#0A2A5E;font:700 11.5px Public Sans;padding:3px 9px;border-radius:20px">'+EH(p.categoria||'—')+'</span><span style="background:#E7F4EC;color:#1E7A45;font:700 11.5px Public Sans;padding:3px 9px;border-radius:20px">'+(p.aFavor||0)+' '+(va?'suports':'apoyos')+'</span></div><h3 style="font:800 21px Fraunces;color:#0A2A5E;margin:0 0 6px">'+EH(p.titulo||'—')+'</h3><div style="color:#8A99A8;font-size:12.5px;margin-bottom:6px">'+EH(p.contacto_nombre||(va?'Anònim':'Anónimo'))+' · '+String(p.created_at).slice(0,10)+'</div>'+gal+'<div style="color:#33414F;font-size:14.5px;line-height:1.6;white-space:pre-wrap">'+EH(p.descripcion||'')+'</div>';
};
document.addEventListener('click',function(e){if(!e.target||!e.target.closest)return;var d=e.target.closest('[data-rrev]');if(d)window.rRev(d.getAttribute('data-rrev'));var pv=e.target.closest('[data-rprev]');if(pv)window.rPrev(pv.getAttribute('data-rprev'));var ds=e.target.closest('[data-rdesc]');if(ds)window.rDesc(ds.getAttribute('data-rdesc'));var pd=e.target.closest('[data-rpdel]');if(pd)window.rPDel(pd.getAttribute('data-rpdel'));});

async function renderLeads(){
  const va=LANG==='va', ttl='📬 '+(va?'Subscriptors':'Suscriptores');
  $('#main').innerHTML='<div class="page"><h2>'+ttl+'</h2><p class="sub">'+T('cargando')+'</p></div>';
  const r=await call({action:'leads-list'});
  if(!r.j||!r.j.ok){ $('#main').innerHTML='<div class="page"><h2>'+ttl+'</h2><p class="warn">'+((r.j&&r.j.error&&r.j.error.message)||'Error')+'</p><p class="sub">'+(va?'Comprova que BREVO_API_KEY està a Netlify.':'Comprueba que BREVO_API_KEY está en Netlify.')+'</p></div>'; return; }
  const items=r.j.items||[]; window._leads=items;
  const excl=items.filter(m=>m.excluido).length;
  const rows=items.map((m,i)=>'<tr'+(m.excluido?' style="opacity:.55"':'')+'><td>'+EH(m.email)+'</td><td>'+String(m.lang||'').toUpperCase()+'</td><td>'+EH(m.alta)+'</td><td>'+(m.baja?'<span class="pill" style="background:#FDEAEA;color:#C0392B">'+(va?'baixa':'baja')+'</span>':m.excluido?'<span class="pill" style="background:#FBF0DC;color:#9A6208">'+(va?'exclòs':'excluido')+'</span>':'<span class="pill" style="background:#E7F4EC;color:#1E7A45">'+(va?'actiu':'activo')+'</span>')+'</td>'
    +'<td>'+(m.baja?'—':'<button class="btn sm '+(m.excluido?'gold':'ghost')+'" onclick="window.leadExcl('+i+')">'+(m.excluido?(va?'Tornar a incloure':'Volver a incluir'):(va?'Excloure dels enviaments':'Excluir de los envíos'))+'</button>')+'</td></tr>').join('');
  $('#main').innerHTML='<div class="page"><div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap"><div style="flex:1"><h2>'+ttl+'</h2><p class="sub" style="margin:0">'+(va?'Subscrits al newsletter i opt-in de màrqueting.':'Suscritos al newsletter y opt-in de marketing.')+'</p></div>'
    +'<button class="btn" style="background:#EEF2F7;color:#42525F" onclick="window.leadsCsv()">'+(va?'Exportar CSV':'Exportar CSV')+'</button></div>'
    +'<div class="stats" style="margin-top:16px"><div class="stat" style="background:#0A2A5E;border-color:#0A2A5E"><b style="color:#F6BE18">'+(r.j.total!=null?r.j.total:items.length)+'</b><span style="color:#cdd9ec;font-weight:600">'+(va?'subscriptors':'suscriptores')+'</span></div>'
    +(excl?'<div class="stat"><b style="color:#9A6208">'+excl+'</b>'+(va?'exclosos dels enviaments':'excluidos de los envíos')+'</div>':'')+'</div>'
    +'<div style="background:#fff;border:1px solid #E7EDF4;border-radius:16px;padding:18px;margin-bottom:20px;box-shadow:0 3px 14px rgba(10,42,94,.05)">'
    +'<h3 style="font:800 16px Bricolage Grotesque;color:#0A2A5E;margin:0 0 3px">📧 '+(va?'Enviar un correu als subscriptors':'Enviar un correo a los suscriptores')+'</h3>'
    +'<p class="sub" style="margin:0 0 12px">'+(va?'S’envia amb enllaç de baixa automàtic. Els exclosos no el reben.':'Se envía con enlace de baja automático. Los excluidos no lo reciben.')+'</p>'
    +'<label>'+(va?'Destinataris':'Destinatarios')+'</label><select id="laud" style="width:auto" onchange="window.leadsPrev()"><option value="todos">'+(va?'Tots els subscriptors':'Todos los suscriptores')+'</option><option value="es">'+(va?'Només castellà (ES)':'Solo castellano (ES)')+'</option><option value="va">'+(va?'Només valencià (VA)':'Solo valenciano (VA)')+'</option></select>'
    +'<label>'+(va?'Assumpte':'Asunto')+'</label><input id="lsubj" maxlength="150" placeholder="'+(va?'p. ex. Assemblea del dissabte':'p. ej. Asamblea del sábado')+'" oninput="window.leadsPrev()">'
    +'<label>'+(va?'Missatge':'Mensaje')+'</label><textarea id="lbody" rows="6" placeholder="'+(va?'Escriu el correu…':'Escribe el correo…')+'" oninput="window.leadsPrev()"></textarea>'
    +'<div style="display:flex;gap:10px;align-items:center;margin-top:12px;flex-wrap:wrap"><button class="btn gold" onclick="window.leadsSend()">'+(va?'Enviar el butlletí':'Enviar el boletín')+'</button><span id="lcount" class="sub" style="margin:0"></span></div>'
    +'<div style="margin-top:16px"><div style="font:700 12px Public Sans;color:#8A99A8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">'+(va?'Vista prèvia del correu':'Vista previa del correo')+'</div>'
    +'<iframe id="lprev" style="width:100%;height:360px;border:1px solid #E7EDF4;border-radius:12px;background:#F0F4F9"></iframe></div></div>'
    +(items.length?SRCH(va?'Busca un email…':'Buscar un email…')+'<table><thead><tr><th>Email</th><th>'+(va?'Idioma':'Idioma')+'</th><th>'+(va?'Alta':'Alta')+'</th><th>'+(va?'Estat':'Estado')+'</th><th></th></tr></thead><tbody>'+rows+'</tbody></table>':'<p class="sub">'+(va?'Encara no hi ha subscriptors confirmats.':'Aún no hay suscriptores confirmados.')+'</p>')
    +'</div>';
  window.leadsPrev();
}
// Vista previa en vivo del boletín (misma plantilla que usa el servidor) + contador de destinatarios
window.leadsPrev=function(){
  const f=$('#lprev'); if(!f)return;
  const va=LANG==='va';
  const esc=s=>String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
  const cuerpo=(($('#lbody')||{}).value||'')||(va?'(escriu el missatge per veure’l ací…)':'(escribe el mensaje para verlo aquí…)');
  const html='<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:16px auto;color:#17232F;border:1px solid #E9EEF4;border-radius:12px;overflow:hidden;background:#fff">'
    +'<div style="background:#0A2A5E;color:#fff;padding:18px 22px;font-weight:bold;font-size:18px"><img src="https://accioncivilgandia.netlify.app/assets/icon-192.png" width="36" height="36" style="vertical-align:middle;border-radius:9px;background:#fff;margin-right:10px">Acción Civil Gandia</div>'
    +'<div style="padding:24px;font-size:15px;line-height:1.6">'+esc(cuerpo).replace(/\\n/g,'<br>')+'</div>'
    +'<div style="padding:16px 22px;color:#8A99A8;font-size:12px;border-top:1px solid #eee">Recibes este correo porque te suscribiste a Acción Civil Gandia. <a href="#" style="color:#1563C4">Darse de baja</a>.</div></div>';
  f.srcdoc='<body style="margin:0;background:#F0F4F9">'+html+'</body>';
  const aud=(($('#laud')||{}).value)||'todos';
  const dest=(window._leads||[]).filter(m=>!m.baja&&!m.excluido&&(aud==='todos'||m.lang===aud)).length;
  const c=$('#lcount'); if(c)c.textContent=(va?'Arribarà a ':'Llegará a ')+dest+(va?' subscriptor(s)':' suscriptor(es)')+(aud!=='todos'?' ('+aud.toUpperCase()+')':'');
};
window.leadExcl=async function(i){
  const m=(window._leads||[])[i]; if(!m)return;
  const va=LANG==='va';
  if(!m.excluido&&!await askConfirm((va?'Excloure ':'¿Excluir a ')+m.email+(va?' dels enviaments del butlletí? Podràs tornar a incloure’l quan vulgues.':' de los envíos del boletín? Podrás volver a incluirlo cuando quieras.'),{yes:va?'Excloure':'Excluir'}))return;
  const r=await call({action:'leads-excluir',email:m.email,excluir:!m.excluido});
  if(r.j&&r.j.ok){ toast(m.excluido?(va?'Tornat a incloure ✓':'Incluido de nuevo ✓'):(va?'Exclòs ✓':'Excluido ✓')); renderLeads(); }
  else toast((r.j.error&&r.j.error.message)||'Error',{error:true});
};
window.leadsCsv=function(){
  const items=window._leads||[]; if(!items.length)return;
  const NL=String.fromCharCode(10);
  const csv='email,idioma,alta,estado'+NL+items.map(m=>[m.email,m.lang||'',m.alta||'',m.baja?'baja':'activo'].map(x=>'"'+String(x).replace(/"/g,'""')+'"').join(',')).join(NL);
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})); a.download='suscriptores-accioncivil.csv'; a.click();
};
window.leadsSend=async function(){
  const va=LANG==='va';
  const asunto=(($('#lsubj')||{}).value||'').trim(), cuerpo=(($('#lbody')||{}).value||'').trim();
  const aud=(($('#laud')||{}).value)||'todos';
  if(asunto.length<3||cuerpo.length<5){ toast(va?'Assumpte i missatge obligatoris':'Asunto y mensaje obligatorios',{error:true}); return; }
  const n=(window._leads||[]).filter(m=>!m.baja&&!m.excluido&&(aud==='todos'||m.lang===aud)).length;
  if(!await askConfirm((va?'Enviar este correu a ':'¿Enviar este correo a ')+n+(va?' subscriptor(s)':' suscriptor(es)')+(aud!=='todos'?' ('+aud.toUpperCase()+')':'')+'?',{yes:va?'Enviar':'Enviar'}))return;
  const btn=[].slice.call(document.querySelectorAll('button')).filter(function(b){return /Enviar el (butlletí|boletín)/.test(b.textContent);})[0];
  if(btn){ btn.disabled=true; btn.textContent=va?'Enviant…':'Enviando…'; }
  const r=await call({action:'leads-send',asunto:asunto,cuerpo:cuerpo,audiencia:aud});
  if(btn){ btn.disabled=false; btn.textContent=va?'Enviar el butlletí':'Enviar el boletín'; }
  if(r.j&&r.j.ok){ toast(va?'Correu enviat ✓':'Correo enviado ✓'); var s=$('#lsubj'),c=$('#lbody'); if(s)s.value=''; if(c)c.value=''; window.leadsPrev(); }
  else toast((r.j.error&&r.j.error.message)||'Error',{error:true});
};

// ===== REGISTROS WEB (cuentas creadas en la web) =====
async function renderRegistros(){
  const va=LANG==='va', ttl='🧑‍💻 '+(va?'Registres web':'Registros web');
  $('#main').innerHTML='<div class="page"><h2>'+ttl+'</h2><p class="sub">'+T('cargando')+'</p></div>';
  const r=await call({action:'registros-list'});
  if(!r.j||!r.j.ok){ $('#main').innerHTML='<div class="page"><h2>'+ttl+'</h2><p class="warn">'+((r.j&&r.j.error&&r.j.error.message)||'Error')+'</p></div>'; return; }
  const items=r.j.items||[]; window._registros=items;
  const fReg=iso=>{ if(!iso)return '—'; try{ return new Date(iso).toLocaleString('es-ES',{timeZone:'Europe/Madrid',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}); }catch(e){ return String(iso).slice(0,10); } };
  const ini=n=>((String(n||'').trim().split(/\s+/).map(w=>w[0]||'').join('').slice(0,2).toUpperCase())||'··');
  const via=v=>v==='google'
    ? '<span class="pill" style="background:#EAF3FC;color:#1563C4">Google</span>'
    : '<span class="pill" style="background:#EEF2F7;color:#5C6B7A">'+(va?'Correu':'Email')+'</span>';
  const badge=(t,bg,fg)=>'<span class="pill" style="background:'+bg+';color:'+fg+'">'+t+'</span>';
  const flags=m=>{ const a=[];
    if(m.afiliado)a.push(badge('⭐ '+(va?'Afiliat':'Afiliado'),'#FBF0DC','#9A6208'));
    if(m.voluntario)a.push(badge('🙋 '+(m.voluntario==='colaborador'?(va?'Col·laborador':'Colaborador'):(va?'Voluntari':'Voluntario')),'#E7F4EC','#1E7A45'));
    if(m.donante)a.push(badge('💛 '+(va?'Donant':'Donante'),'#FDEAEA','#C0392B'));
    if(m.bloqueado)a.push(badge('🚫 '+(va?'Bloquejat':'Bloqueado'),'#FDEAEA','#C0392B'));
    return a.join(' ')||'<span class="sub" style="margin:0">—</span>'; };
  const avat=m=> m.avatar
    ? '<img src="'+EH(m.avatar)+'" alt="" referrerpolicy="no-referrer" style="width:34px;height:34px;border-radius:50%;object-fit:cover;flex-shrink:0">'
    : '<span style="width:34px;height:34px;border-radius:50%;flex-shrink:0;background:#0B7580;color:#fff;font:800 12px Public Sans;display:inline-flex;align-items:center;justify-content:center">'+EH(ini(m.nombre||m.email))+'</span>';
  const rows=items.map(m=>'<tr>'
    +'<td><span style="display:inline-flex;align-items:center;gap:9px">'+avat(m)+'<b style="font-weight:700;color:#17232F">'+EH(m.nombre||(va?'(sense nom)':'(sin nombre)'))+'</b></span></td>'
    +'<td><a href="mailto:'+EH(m.email)+'" style="color:#1563C4">'+EH(m.email)+'</a></td>'
    +'<td style="white-space:nowrap">'+EH(fReg(m.alta))+(m.nuevoHoy?' <span class="pill" style="background:#E7F4EC;color:#1E7A45">'+(va?'nou':'nuevo')+'</span>':'')+'</td>'
    +'<td>'+via(m.via)+'</td>'
    +'<td>'+flags(m)+'</td></tr>').join('');
  $('#main').innerHTML='<div class="page">'
    +'<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap"><div style="flex:1"><h2>'+ttl+'</h2>'
    +'<p class="sub" style="margin:0">'+(va?'Persones que han creat un compte a la web. Ací els veus créixer.':'Personas que han creado una cuenta en la web. Aquí los ves crecer.')+'</p></div>'
    +'<button class="btn" style="background:#EEF2F7;color:#42525F" onclick="window.registrosCsv()">'+(va?'Exportar CSV':'Exportar CSV')+'</button></div>'
    +'<div class="stats" style="margin-top:16px">'
    +'<div class="stat" style="background:#0A2A5E;border-color:#0A2A5E"><b style="color:#F6BE18">'+items.length+'</b><span style="color:#cdd9ec;font-weight:600">'+(va?'registres reals':'registros reales')+'</span></div>'
    +(r.j.hoy?'<div class="stat"><b style="color:#1E7A45">+'+r.j.hoy+'</b>'+(va?'hui':'hoy')+'</div>':'')
    +'</div>'
    +(r.j.ocultas?'<p class="sub" style="margin:2px 0 10px;font-size:12.5px">'+(va?'S’oculten ':'Se ocultan ')+r.j.ocultas+(va?' comptes de sistema/proves (llavors, tests).':' cuentas de sistema/pruebas (semillas, tests).')+'</p>':'')
    +(items.length?SRCH(va?'Busca per nom o email…':'Buscar por nombre o email…')+'<table><thead><tr><th>'+(va?'Persona':'Persona')+'</th><th>Email</th><th>'+(va?'Alta':'Alta')+'</th><th>'+(va?'Via':'Vía')+'</th><th>'+(va?'Títols':'Títulos')+'</th></tr></thead><tbody>'+rows+'</tbody></table>':'<p class="sub">'+(va?'Encara no hi ha registres.':'Aún no hay registros.')+'</p>')
    +'</div>';
}
window.registrosCsv=function(){
  const items=window._registros||[]; if(!items.length)return;
  const esc=s=>'"'+String(s==null?'':s).replace(/"/g,'""')+'"';
  const head=['Nombre','Email','Alta','Via','Afiliado','Voluntario','Donante','Bloqueado'];
  const lines=items.map(m=>[m.nombre,m.email,m.alta,m.via,m.afiliado?'si':'',m.voluntario||'',m.donante?'si':'',m.bloqueado?'si':''].map(esc).join(','));
  const csv=head.map(esc).join(',')+'\\n'+lines.join('\\n');
  const a=document.createElement('a'); a.href='data:text/csv;charset=utf-8,﻿'+encodeURIComponent(csv); a.download='registros-web.csv'; a.click();
};

// ===== TIENDA (productos + pedidos) =====
async function renderTienda(){
  const va=LANG==='va';
  if(!window.SHOP_VIEW)window.SHOP_VIEW='productos';
  const v=window.SHOP_VIEW;
  const sbtn=(k,lab)=>'<button class="stab" data-sv="'+k+'" style="border:none;cursor:pointer;font:700 13px Public Sans;padding:8px 18px;border-radius:9px;background:'+(v===k?'#fff':'transparent')+';color:'+(v===k?'#0A2A5E':'#5C6B7A')+'">'+lab+'</button>';
  $('#main').innerHTML='<div class="page"><div style="margin-bottom:6px"><h2>🛍️ '+(va?'Botiga':'Tienda')+'</h2>'
    +'<p class="sub" style="margin:0">'+(va?'Productes de marxandatge i comandes rebudes.':'Productos de merchandising y pedidos recibidos.')+'</p></div>'
    +'<div style="display:inline-flex;background:#EAF1FB;border-radius:12px;padding:4px;margin:6px 0 16px">'+sbtn('productos',va?'Productes':'Productos')+sbtn('pedidos',va?'Comandes':'Pedidos')+'</div>'
    +'<div id="shopbody"><p class="sub">'+T('cargando')+'</p></div></div>';
  document.querySelectorAll('.stab').forEach(bt=>bt.addEventListener('click',function(){window.SHOP_VIEW=this.getAttribute('data-sv');renderTienda();}));
  if(v==='productos')shopProductos();else shopPedidos();
}
async function shopProductos(){
  const va=LANG==='va', body=document.getElementById('shopbody'); if(!body)return;
  const [rs,rp]=await Promise.all([call({action:'tienda-stats'}),call({action:'productos-list'})]);
  if(!rp.j||!rp.j.ok){ body.innerHTML='<p class="warn">'+((rp.j&&rp.j.error&&rp.j.error.message)||'Error')+'</p><p class="sub">'+(va?'Comprova que la migració de la botiga (products / product_variants) està aplicada a Supabase.':'Comprueba que la migración de la tienda (products / product_variants) está aplicada en Supabase.')+'</p>'; return; }
  window._PRODS=rp.j.items||[];
  const st=(rs.j&&rs.j.data)||{};
  const stats='<div class="stats" style="margin:0 0 16px"><div class="stat" style="background:#0A2A5E;border-color:#0A2A5E"><b style="color:#F6BE18">'+EUR(st.ingresosMesCents||0)+'</b><span style="color:#cdd9ec;font-weight:600">'+(va?'ingressos este mes':'ingresos este mes')+'</span></div>'
    +'<div class="stat"><b style="color:#1563C4">'+(st.pedidosTotal||0)+'</b>'+(va?'comandes totals':'pedidos totales')+'</div>'
    +(st.pendientes?'<div class="stat"><b style="color:#9A6208">'+st.pendientes+'</b>'+(va?'per preparar/enviar':'por preparar/enviar')+'</div>':'')+'</div>';
  const topP=(st.topProductos||[]);
  const topHtml=topP.length?'<div style="background:#F7FAFD;border:1px solid #E9EEF4;border-radius:14px;padding:14px 16px;margin-bottom:14px"><div style="font:700 12px Public Sans;color:#5C6B7A;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">'+(va?'Més venuts (unitats)':'Más vendidos (unidades)')+'</div>'+topP.map(t=>'<div style="display:flex;justify-content:space-between;font-size:13.5px;padding:3px 0"><span>'+EH(t.nombre)+'</span><b>'+t.unidades+'</b></div>').join('')+'</div>':'';
  const cards=window._PRODS.length?window._PRODS.map((p,i)=>{
    const vars=(p.product_variants||[]);
    const stock=vars.reduce((s,x)=>s+(x.stock||0),0);
    const nombre=va?(p.nombre_va||p.nombre_es):(p.nombre_es||p.nombre_va);
    return '<div style="background:#fff;border:1px solid #E7EDF4;border-radius:14px;padding:12px 14px;margin-bottom:10px;display:flex;gap:14px;align-items:center;box-shadow:0 2px 8px rgba(10,42,94,.05)">'
      +(p.imagen_url?'<img src="'+EH(p.imagen_url)+'" style="width:56px;height:56px;object-fit:cover;border-radius:10px;flex-shrink:0;background:#EEF3F9">':'<div style="width:56px;height:56px;border-radius:10px;background:#EEF3F9;flex-shrink:0"></div>')
      +'<div style="flex:1;min-width:0"><div style="font:700 15px Public Sans;color:#17232F">'+EH(nombre||'—')+'</div>'
      +'<div style="font-size:12.5px;color:#8A99A8;margin-top:2px">'+EH(p.categoria||'—')+' · '+EUR(p.precio_cents||0)+' · '+(va?'estoc':'stock')+' '+stock+(vars.length?' · '+vars.length+' '+(va?'talles':'tallas'):'')+'</div></div>'
      +'<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">'
      +(p.destacado?'<span class="pill" style="background:#FBF0DC;color:#9A6208">'+(va?'destacat':'destacado')+'</span>':'')
      +'<span class="pill" style="background:'+(p.activo?'#E7F4EC':'#EEF2F7')+';color:'+(p.activo?'#1E7A45':'#8A99A8')+'">'+(p.activo?(va?'actiu':'activo'):(va?'ocult':'oculto'))+'</span>'
      +'<button class="btn sm" data-pedit="'+i+'" style="margin:0">'+(va?'Editar':'Editar')+'</button></div></div>';
  }).join(''):'<p class="sub">'+(va?'Encara no hi ha productes. Crea el primer.':'Aún no hay productos. Crea el primero.')+'</p>';
  body.innerHTML=stats+'<button class="btn gold" data-pnew="1" style="margin-bottom:14px">'+(va?'＋ Nou producte':'＋ Nuevo producto')+'</button>'+topHtml+cards+'<div id="pform"></div>';
  document.querySelectorAll('[data-pedit]').forEach(bt=>bt.addEventListener('click',function(){shopProductoForm(Number(this.getAttribute('data-pedit')));}));
  const nb=document.querySelector('[data-pnew]'); if(nb)nb.addEventListener('click',function(){shopProductoForm();});
}
function shopProductoForm(i){
  const va=LANG==='va';
  const p=(i===undefined||i===null)?{}:(window._PRODS[i]||{});
  window._shopEdit={id:p.id||null,delVars:[]};
  const box=document.getElementById('pform'); if(!box)return;
  const val=k=>p[k]==null?'':String(p[k]);
  const vars=(p.product_variants||[]).slice().sort((a,b2)=>(a.orden||0)-(b2.orden||0));
  box.innerHTML='<div class="form" style="margin-top:6px"><h3 style="font-family:Bricolage Grotesque;color:#0A2A5E;margin:0">'+(p.id?(va?'Editar producte':'Editar producto'):(va?'Nou producte':'Nuevo producto'))+'</h3>'
    +'<p class="sub" style="margin:6px 0 0">🌐 '+T('autotrad')+'</p>'
    +'<label>'+(va?'Nom (ES)':'Nombre (ES)')+'</label><input id="pf_nombre_es" value="'+EH(val('nombre_es'))+'">'
    +'<label>'+(va?'Nom (VA) — buit = es tradueix sol':'Nombre (VA) — vacío = se traduce solo')+'</label><input id="pf_nombre_va" value="'+EH(val('nombre_va'))+'">'
    +'<label>'+(va?'Descripció (ES)':'Descripción (ES)')+'</label><textarea id="pf_descripcion_es" rows="3">'+EH(val('descripcion_es'))+'</textarea>'
    +'<label>'+(va?'Descripció (VA)':'Descripción (VA)')+'</label><textarea id="pf_descripcion_va" rows="3">'+EH(val('descripcion_va'))+'</textarea>'
    +'<label>'+(va?'Categoria':'Categoría')+'</label><input id="pf_categoria" value="'+EH(val('categoria'))+'" placeholder="'+(va?'p. ex. samarretes, tasses…':'p. ej. camisetas, tazas…')+'">'
    +'<label>'+(va?'Preu base (€)':'Precio base (€)')+'</label><input id="pf_precio" value="'+(p.precio_cents!=null?String(p.precio_cents/100).replace('.',','):'')+'" placeholder="12,50">'
    +'<label>'+(va?'Ordre (0 = primer)':'Orden (0 = primero)')+'</label><input id="pf_orden" type="number" value="'+(p.orden!=null?p.orden:0)+'">'
    +'<div style="display:flex;gap:22px;margin-top:12px;flex-wrap:wrap"><label style="display:flex;gap:8px;align-items:center;margin:0"><input type="checkbox" id="pf_activo" style="width:19px;height:19px" '+(p.id?(p.activo?'checked':''):'checked')+'>'+(va?'Visible a la botiga':'Visible en la tienda')+'</label>'
    +'<label style="display:flex;gap:8px;align-items:center;margin:0"><input type="checkbox" id="pf_destacado" style="width:19px;height:19px" '+(p.destacado?'checked':'')+'>'+(va?'Destacat':'Destacado')+'</label></div>'
    +'<label>'+(va?'Imatge':'Imagen')+'</label><div class="drop" data-k="imagen_url">'+(val('imagen_url')?'<img src="'+EH(val('imagen_url'))+'">':'')+'<span>'+(val('imagen_url')?T('cambiar'):T('arrastra'))+'</span><input type="file" id="file_imagen_url" accept="image/*" style="display:none"></div><input type="hidden" id="f_imagen_url" value="'+EH(val('imagen_url'))+'">'
    +'<label style="margin-top:16px">'+(va?'Talles / variants (estoc)':'Tallas / variantes (stock)')+'</label>'
    +'<p class="sub" style="margin:0 0 8px">'+(va?'Deixa «Talla» buida per a un producte sense talles. Preu buit = usa el preu base.':'Deja «Talla» vacía para un producto sin tallas. Precio vacío = usa el precio base.')+'</p>'
    +'<div id="varrows"></div>'
    +'<button class="btn sm" data-varadd="1" style="margin:4px 0 0;background:#EEF2F7;color:#0A2A5E">'+(va?'＋ Afegir talla/variant':'＋ Añadir talla/variante')+'</button>'
    +'<div style="display:flex;gap:10px;margin-top:20px"><button class="btn" data-psave="1">'+T('guardar')+'</button>'
    +(p.id?'<button class="btn ghost" data-pdelprod="'+EH(p.id)+'">'+T('borrar')+'</button>':'')
    +'<button class="btn" style="background:#EEF2F7;color:#42525F" data-pcancel="1">'+T('cancelar')+'</button></div><div id="pfmsg" class="msg"></div></div>';
  if(vars.length)vars.forEach(x=>shopAddVarRow(x)); else shopAddVarRow({});
  const z=box.querySelector('.drop[data-k="imagen_url"]'), fi=document.getElementById('file_imagen_url');
  z.addEventListener('click',()=>fi.click());
  z.addEventListener('dragover',e=>{e.preventDefault();z.classList.add('over');});
  z.addEventListener('dragleave',()=>z.classList.remove('over'));
  z.addEventListener('drop',e=>{e.preventDefault();z.classList.remove('over');if(e.dataTransfer.files[0])subirImg('imagen_url',e.dataTransfer.files[0]);});
  fi.addEventListener('change',()=>{if(fi.files[0])subirImg('imagen_url',fi.files[0]);});
  box.querySelector('[data-varadd]').addEventListener('click',()=>shopAddVarRow({}));
  box.querySelector('[data-psave]').addEventListener('click',shopProductoSave);
  box.querySelector('[data-pcancel]').addEventListener('click',()=>{box.innerHTML='';});
  const pd=box.querySelector('[data-pdelprod]'); if(pd)pd.addEventListener('click',function(){shopProductoDel(this.getAttribute('data-pdelprod'));});
  box.scrollIntoView({behavior:'smooth'});
}
function shopAddVarRow(x){
  x=x||{}; const va=LANG==='va';
  const vr=document.getElementById('varrows'); if(!vr)return;
  const row=document.createElement('div');
  row.className='varrow';
  row.style.cssText='display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap';
  if(x.id)row.setAttribute('data-vid',x.id);
  row.innerHTML='<input class="v_talla" placeholder="'+(va?'Talla':'Talla')+'" value="'+EH(x.talla==null?'':x.talla)+'" style="flex:1;min-width:70px;margin:0">'
    +'<input class="v_sku" placeholder="SKU" value="'+EH(x.sku==null?'':x.sku)+'" style="flex:1;min-width:80px;margin:0">'
    +'<input class="v_stock" type="number" min="0" placeholder="'+(va?'Estoc':'Stock')+'" value="'+(x.stock!=null?x.stock:'')+'" style="width:88px;margin:0">'
    +'<input class="v_precio" placeholder="'+(va?'Preu €':'Precio €')+'" value="'+(x.precio_cents!=null?String(x.precio_cents/100).replace('.',','):'')+'" style="width:96px;margin:0">'
    +'<button class="btn sm ghost" data-varrm="1" style="margin:0;color:#C0392B;padding:8px 12px">✕</button>';
  row.querySelector('[data-varrm]').addEventListener('click',function(){
    const vid=row.getAttribute('data-vid');
    if(vid&&window._shopEdit)window._shopEdit.delVars.push(vid);
    row.remove();
  });
  vr.appendChild(row);
}
async function shopProductoSave(){
  const va=LANG==='va', msg=document.getElementById('pfmsg');
  const g=id=>{const e=document.getElementById(id);return e?e.value.trim():'';};
  const nombre_es=g('pf_nombre_es'), nombre_va=g('pf_nombre_va');
  if(!nombre_es&&!nombre_va){ if(msg)msg.innerHTML='<span class="warn">'+(va?'Posa almenys el nom en un idioma.':'Pon al menos el nombre en un idioma.')+'</span>'; return; }
  const precioEur=g('pf_precio').replace(',','.');
  const producto={
    id:(window._shopEdit&&window._shopEdit.id)||undefined,
    nombre_es:nombre_es||null, nombre_va:nombre_va||null,
    descripcion_es:g('pf_descripcion_es')||null, descripcion_va:g('pf_descripcion_va')||null,
    categoria:g('pf_categoria')||null,
    precio_cents:precioEur?Math.round(parseFloat(precioEur)*100):0,
    imagen_url:(document.getElementById('f_imagen_url')||{}).value||null,
    orden:Number(g('pf_orden'))||0,
    activo:!!(document.getElementById('pf_activo')||{}).checked,
    destacado:!!(document.getElementById('pf_destacado')||{}).checked,
  };
  const variantes=[];
  [].slice.call(document.querySelectorAll('#varrows .varrow')).forEach((row,idx)=>{
    const talla=(row.querySelector('.v_talla').value||'').trim();
    const sku=(row.querySelector('.v_sku').value||'').trim();
    const stockV=(row.querySelector('.v_stock').value||'').trim();
    const precioV=(row.querySelector('.v_precio').value||'').trim().replace(',','.');
    if(!talla&&!sku&&!stockV&&!precioV&&!row.getAttribute('data-vid'))return;
    variantes.push({
      id:row.getAttribute('data-vid')||undefined,
      talla:talla||null, sku:sku||null,
      stock:stockV===''?0:Math.max(0,Math.round(Number(stockV))||0),
      precio_cents:precioV===''?null:Math.round(parseFloat(precioV)*100),
      orden:idx,
    });
  });
  if(msg)msg.innerHTML='<span style="color:#5C6B7A">'+T('guardando')+'</span>';
  const r=await call({action:'producto-guardar',producto:producto,variantes:variantes,borrarVariantes:(window._shopEdit&&window._shopEdit.delVars)||[]});
  if(r.j&&r.j.ok){ toast(T('guardado')); shopProductos(); }
  else if(msg)msg.innerHTML='<span class="warn">'+((r.j&&r.j.error&&r.j.error.message)||'Error')+'</span>';
}
async function shopProductoDel(id){
  const va=LANG==='va';
  if(!await askConfirm(va?'Eliminar este producte i totes les seues variants? No es pot desfer.':'¿Eliminar este producto y todas sus variantes? No se puede deshacer.',{danger:true,yes:va?'Eliminar':'Eliminar'}))return;
  const r=await call({action:'producto-borrar',id:id});
  if(r.j&&r.j.ok){ toast(va?'Producte eliminat':'Producto eliminado'); shopProductos(); }
  else toast((r.j&&r.j.error&&r.j.error.message)||'Error',{error:true});
}
const SHOP_EST={
  pendiente_pago:['#FBF0DC','#9A6208','Pendiente de pago','Pendent de pagament'],
  pagado:['#E7F4EC','#1E7A45','Pagado','Pagat'],
  preparando:['#EAF3FC','#1563C4','Preparando','Preparant'],
  listo_recogida:['#EAF3FC','#0FA6B6','Listo para recoger','Llest per a recollir'],
  enviado:['#EDE7FB','#5B3FBF','Enviado','Enviat'],
  entregado:['#E7F4EC','#1E7A45','Entregado','Lliurat'],
  cancelado:['#FDEAEA','#C0392B','Cancelado','Cancel·lat']
};
const SHOP_EST_ORDER=['pendiente_pago','pagado','preparando','listo_recogida','enviado','entregado','cancelado'];
function shopEstLabel(e){const va=LANG==='va';const s=SHOP_EST[e];return s?(va?s[3]:s[2]):(e||'—');}
function shopPill(e){const s=SHOP_EST[e]||['#EEF2F7','#5C6B7A'];return '<span class="pill" style="background:'+s[0]+';color:'+s[1]+'">'+shopEstLabel(e)+'</span>';}
function shopDir(d){
  if(!d)return'';
  if(typeof d==='string'){try{d=JSON.parse(d);}catch(e){return d;}}
  return [d.direccion||d.calle||d.linea1,d.cp||d.codigo_postal,d.ciudad||d.poblacion,d.provincia].filter(Boolean).join(', ');
}
async function shopPedidos(estadoFiltro){
  const va=LANG==='va', body=document.getElementById('shopbody'); if(!body)return;
  window._SHOP_FILTRO=estadoFiltro||window._SHOP_FILTRO||'todos';
  const r=await call({action:'pedidos-list',estado:window._SHOP_FILTRO});
  if(!r.j||!r.j.ok){ body.innerHTML='<p class="warn">'+((r.j&&r.j.error&&r.j.error.message)||'Error')+'</p>'; return; }
  window._PEDIDOS=r.j.items||[];
  const filtros='<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">'+['todos'].concat(SHOP_EST_ORDER).map(e=>{
    const on=window._SHOP_FILTRO===e; const lab=e==='todos'?(va?'Tots':'Todos'):shopEstLabel(e);
    return '<button class="btn sm" data-pf="'+e+'" style="margin:0;'+(on?'background:#0A2A5E;color:#fff':'background:#EEF2F7;color:#42525F')+'">'+lab+'</button>';
  }).join('')+'</div>';
  const meth=m=>m==='envio'?(va?'Enviament':'Envío'):(va?'Recollida en seu':'Recogida en sede');
  const lista=window._PEDIDOS.length?window._PEDIDOS.map(o=>{
    const items=(o.order_items||[]);
    const opts=SHOP_EST_ORDER.map(e=>'<option value="'+e+'"'+(o.estado===e?' selected':'')+'>'+shopEstLabel(e)+'</option>').join('');
    return '<div style="background:#fff;border:1px solid #E7EDF4;border-radius:14px;padding:14px 16px;margin-bottom:12px;box-shadow:0 2px 8px rgba(10,42,94,.05)">'
      +'<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap"><b style="font:800 15px Bricolage Grotesque;color:#0A2A5E">#'+EH(o.numero||o.id)+'</b>'
      +shopPill(o.estado)+'<span style="color:#8A99A8;font-size:12.5px">'+String(o.created_at||'').slice(0,10)+'</span>'
      +'<span style="color:#5C6B7A;font-size:12.5px">'+meth(o.metodo_entrega)+'</span>'
      +'<b style="margin-left:auto;color:#1E7A45">'+EUR(o.total_cents||0)+'</b></div>'
      +'<div style="font-size:13px;color:#42525F;margin-top:6px">'+EH(o.nombre||'—')+(o.email?' · <a href="mailto:'+EH(o.email)+'" style="color:#1563C4">'+EH(o.email)+'</a>':'')+'</div>'
      +'<div style="margin-top:8px;border-top:1px dashed #EEF2F7;padding-top:8px">'+(items.length?items.map(it=>'<div style="display:flex;justify-content:space-between;font-size:13px;padding:2px 0"><span>'+(it.cantidad||1)+'× '+EH(it.nombre)+(it.talla?' <span style="color:#8A99A8">('+EH(it.talla)+')</span>':'')+'</span><span style="color:#5C6B7A">'+EUR((it.precio_cents||0)*(it.cantidad||1))+'</span></div>').join(''):'<span class="sub">'+(va?'Sense línies':'Sin líneas')+'</span>')
      +(o.envio_cents?'<div style="display:flex;justify-content:space-between;font-size:12.5px;color:#8A99A8;padding:2px 0"><span>'+(va?'Enviament':'Envío')+'</span><span>'+EUR(o.envio_cents)+'</span></div>':'')+'</div>'
      +(o.direccion&&o.metodo_entrega==='envio'?'<div style="font-size:12px;color:#8A99A8;margin-top:6px">📦 '+EH(shopDir(o.direccion))+'</div>':'')
      +'<div style="display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap"><label style="margin:0;font:600 12px Public Sans;color:#5C6B7A">'+(va?'Estat':'Estado')+'</label><select data-pest="'+EH(o.id)+'" style="width:auto;margin:0">'+opts+'</select>'
      +(o.estado==='cancelado'?'<button class="btn sm" data-peddel="'+EH(o.id)+'" data-pnum="'+EH(o.numero||o.id)+'" style="margin:0 0 0 auto;background:#FBECEC;color:#C0392B;border:1px solid #F5C9C9">🗑 '+(va?'Eliminar comanda':'Eliminar pedido')+'</button>':'')
      +'</div>'
      +'</div>';
  }).join(''):'<p class="sub">'+(va?'Cap comanda'+(window._SHOP_FILTRO!=='todos'?' amb este estat':'')+'.':'Ningún pedido'+(window._SHOP_FILTRO!=='todos'?' con este estado':'')+'.')+'</p>';
  body.innerHTML=filtros+lista;
  document.querySelectorAll('[data-pf]').forEach(bt=>bt.addEventListener('click',function(){shopPedidos(this.getAttribute('data-pf'));}));
  document.querySelectorAll('[data-pest]').forEach(sel=>sel.addEventListener('change',function(){window.shopEstado(this.getAttribute('data-pest'),this.value);}));
  document.querySelectorAll('[data-peddel]').forEach(bt=>bt.addEventListener('click',function(){window.shopEliminar(this.getAttribute('data-peddel'),this.getAttribute('data-pnum'));}));
}
window.shopEstado=async function(id,estado){
  const va=LANG==='va';
  const r=await call({action:'pedido-estado',id:id,estado:estado});
  if(r.j&&r.j.ok){ toast(va?'Estat actualitzat ✓':'Estado actualizado ✓'); shopPedidos(); }
  else toast((r.j&&r.j.error&&r.j.error.message)||'Error',{error:true});
};
window.shopEliminar=async function(id,num){
  const va=LANG==='va';
  const motivo=await askPrompt(va?'Motiu de l’esborrat de la comanda #'+num+' (obligatori):':'Motivo del borrado del pedido #'+num+' (obligatorio):','');
  if(motivo===null)return;
  if(!String(motivo).trim()){ toast(va?'Cal indicar un motiu.':'Hay que indicar un motivo.',{error:true}); return; }
  const ok=await askConfirm((va?'Eliminar DEFINITIVAMENT la comanda #':'Eliminar DEFINITIVAMENTE el pedido #')+num+(va?'? No es pot desfer.':'? No se puede deshacer.'),{danger:true,yes:'Eliminar'});
  if(!ok)return;
  const r=await call({action:'pedido-eliminar',id:id,motivo:String(motivo).trim()});
  if(r.j&&r.j.ok){ toast(va?'Comanda eliminada ✓':'Pedido eliminado ✓'); shopPedidos(); }
  else toast((r.j&&r.j.error&&r.j.error.message)||'Error',{error:true});
};

window.cuotasPanel=function(){
  const va=LANG==='va';
  const o=document.createElement('div'); o.id='cmodal';
  o.style.cssText='position:fixed;inset:0;z-index:9700;background:rgba(7,30,69,.55);display:flex;align-items:flex-start;justify-content:center;padding:24px;overflow-y:auto';
  o.innerHTML='<div style="background:#fff;border-radius:20px;max-width:520px;width:100%;padding:26px;margin:auto;box-shadow:0 30px 80px rgba(10,42,94,.35)">'
    +'<h3 style="font:800 20px Bricolage Grotesque;color:#0A2A5E;margin:0 0 4px">'+(va?'Registrar quotes del mes':'Registrar cuotas del mes')+'</h3>'
    +'<p class="sub">'+(va?'Marca qui ha pagat. Suma la seua quota al total i crea un ingrés a tresoreria.':'Marca quién ha pagado. Suma su cuota al total y crea un ingreso en tesorería.')+'</p>'
    +'<label>'+(va?'Mes':'Mes')+'</label><input type="month" id="cper">'
    +'<div style="display:flex;justify-content:space-between;align-items:center;margin:14px 0 6px"><b style="font:700 13px Public Sans;color:#42525F">'+(va?'Afiliats actius':'Afiliados activos')+'</b><label style="margin:0;display:flex;gap:6px;align-items:center;font:600 12px Public Sans;color:#5C6B7A;cursor:pointer"><input type="checkbox" id="ctodos" checked style="width:15px;height:15px">'+(va?'Tots':'Todos')+'</label></div>'
    +'<div id="clist" style="max-height:40vh;overflow-y:auto;border:1px solid #E7EDF4;border-radius:12px;padding:6px"></div>'
    +'<div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;font:700 15px Public Sans;color:#0A2A5E"><span>'+(va?'Total a ingressar':'Total a ingresar')+'</span><span id="ctotal">0 €</span></div>'
    +'<p class="sub" style="margin:6px 0 0">'+(va?'S’ingressarà a tresoreria com «Cuotas afiliados» d’este mes.':'Se ingresará en tesorería como «Cuotas afiliados» de este mes.')+'</p>'
    +'<div id="cmsg" style="display:none;font-weight:600;margin-top:10px"></div>'
    +'<div style="display:flex;gap:10px;margin-top:16px"><button class="btn" id="cgo" style="flex:1">'+(va?'Registrar seleccionats':'Registrar seleccionados')+'</button><button class="btn ghost" id="cclose">'+(va?'Tancar':'Cerrar')+'</button></div></div>';
  document.body.appendChild(o);
  const now=new Date(); $('#cper').value=now.toISOString().slice(0,7);
  o.addEventListener('click',e=>{if(e.target===o)o.remove();});
  $('#cclose').addEventListener('click',()=>o.remove());
  $('#cgo').addEventListener('click',window.cuotasRegistrar);
  $('#cper').addEventListener('change',window._cuotasList);
  $('#ctodos').addEventListener('change',function(){document.querySelectorAll('#clist input[data-aid]:not([disabled])').forEach(c=>{c.checked=$('#ctodos').checked;});window._cuotasTotal();});
  window._cuotasList();
};
window._cuotasTotal=function(){
  const el=$('#ctotal'); if(!el)return;
  let sum=0;
  [].slice.call(document.querySelectorAll('#clist input[data-aid]:checked')).forEach(function(c){
    const a=ROWS.filter(x=>x.id===c.getAttribute('data-aid'))[0]; if(a) sum+=Number(a.cuota||0);
  });
  el.textContent=sum.toLocaleString('es-ES',{minimumFractionDigits:0,maximumFractionDigits:2})+' €';
};
window._cuotasList=async function(){
  const box=$('#clist'); if(!box)return; const va=LANG==='va';
  const per=$('#cper').value;
  box.innerHTML='<div class="sub" style="padding:8px;margin:0">'+T('cargando')+'</div>';
  const r=await call({action:'cuotas-periodo',periodo:per});
  const pagados=new Set((r.j&&r.j.pagados)||[]);
  const activos=ROWS.filter(x=>x.estado==='activo'&&Number(x.cuota)>0);
  box.innerHTML=activos.length?activos.map(a=>{
    const ya=pagados.has(a.id);
    return '<label style="display:flex;align-items:center;gap:10px;padding:8px 6px;border-bottom:1px solid #F1F4F8;'+(ya?'opacity:.55':'cursor:pointer')+'"><input type="checkbox" data-aid="'+a.id+'" '+(ya?'disabled':'checked')+' style="width:16px;height:16px;flex-shrink:0"><span style="flex:1;font:600 13.5px Public Sans;color:#17232F">'+EH(a.nombre)+' '+EH(a.apellidos)+'</span><span style="font:700 13px Public Sans;color:#1E7A45">'+Number(a.cuota)+' €</span>'+(ya?'<span style="font:700 10.5px Public Sans;color:#8A99A8;text-transform:uppercase">'+(va?'ja pagat':'ya pagado')+'</span> <span class="x" data-anular="'+a.id+'" style="font:700 10.5px Public Sans;color:#C0392B;cursor:pointer;text-decoration:underline;text-transform:uppercase">'+(va?'anul·lar':'anular')+'</span>':'')+'</label>';
  }).join(''):'<div class="sub" style="padding:8px;margin:0">'+(va?'Cap afiliat actiu amb quota.':'Ningún afiliado activo con cuota.')+'</div>';
  [].slice.call(box.querySelectorAll('input[data-aid]')).forEach(function(c){ c.addEventListener('change',window._cuotasTotal); });
  window._cuotasTotal();
};
window.cuotasRegistrar=async function(){
  const per=$('#cper').value, va=LANG==='va';
  const checks=[].slice.call(document.querySelectorAll('#clist input[data-aid]:checked'));
  const ids=checks.map(c=>c.getAttribute('data-aid'));
  const msg=$('#cmsg'), btn=$('#cgo');
  if(!ids.length){ msg.style.display='block';msg.style.color='#C0392B';msg.textContent=va?'No has marcat ningú.':'No has marcado a nadie.'; return; }
  btn.disabled=true; btn.textContent=va?'Registrant…':'Registrando…';
  const r=await call({action:'cuotas-registrar',periodo:per,ids:ids});
  btn.disabled=false; btn.textContent=va?'Registrar seleccionats':'Registrar seleccionados';
  if(r.j&&r.j.ok){ msg.style.display='block';msg.style.color='#1E7A45';msg.textContent=(va?'Registrats ':'Registrados ')+r.j.registrados+(va?' · ingrés a tresoreria +':' · ingreso en tesorería +')+r.j.suma+' €'; window._cuotasList(); render(); }
  else { msg.style.display='block';msg.style.color='#C0392B';msg.textContent=(r.j.error&&r.j.error.message)||'Error'; }
};
window.cuotasAnular=async function(id){
  const per=$('#cper').value, va=LANG==='va';
  const r=await call({action:'cuotas-anular',periodo:per,ids:[id]});
  if(r.j&&r.j.ok){ const m=$('#cmsg'); if(m){m.style.display='block';m.style.color='#5C6B7A';m.textContent=va?'Anul·lat.':'Anulado.';} window._cuotasList(); render(); }
  else { const m=$('#cmsg'); if(m){m.style.display='block';m.style.color='#C0392B';m.textContent=(r.j.error&&r.j.error.message)||'Error';} }
};

document.addEventListener('click',function(e){
  const g=e.target.closest('[data-go]'); if(g){TAB=g.getAttribute('data-go');render();return;}
  const an=e.target.closest('[data-anular]'); if(an){window.cuotasAnular(an.getAttribute('data-anular'));return;}
  const h=e.target.closest('[data-hide]'); if(h){window.chatHide(h.getAttribute('data-hide'),h.getAttribute('data-show')==='1');return;}
  const bd=e.target.closest('[data-bcdel]'); if(bd){window.bcDel(bd.getAttribute('data-bcdel'));return;}
  const cx=e.target.closest('[data-chatdel]'); if(cx){window.chatDel(cx.getAttribute('data-chatdel'));return;}
  const bk=e.target.closest('[data-block]'); if(bk){window.chatBlock(bk.getAttribute('data-block'), bk.getAttribute('data-blockon')!=='1');return;}
  const c=e.target.closest('[data-cid]'); if(c){window.cEstado(c.getAttribute('data-cid'),c.getAttribute('data-est'));}
  const cr=e.target.closest('[data-crep]'); if(cr){const bx=document.getElementById('crep-'+cr.getAttribute('data-crep')); if(bx){bx.style.display=bx.style.display==='none'?'block':'none'; const ta=bx.querySelector('textarea'); if(bx.style.display==='block'&&ta)ta.focus();}}
  const cs=e.target.closest('[data-crepsend]'); if(cs){window.cReply(cs.getAttribute('data-crepsend'),cs);}
});
// Diálogos internos (sustituyen a los confirm()/alert() nativos del navegador)
function askConfirm(msg,opts){
  opts=opts||{}; var va=LANG==='va';
  return new Promise(function(res){
    var o=document.createElement('div');
    o.style.cssText='position:fixed;inset:0;z-index:9800;background:rgba(7,30,69,.55);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:24px';
    var yes=opts.yes||(va?'Confirmar':'Confirmar');
    o.innerHTML='<div style="background:#fff;border-radius:18px;max-width:410px;width:100%;padding:26px;box-shadow:0 30px 80px rgba(10,42,94,.35)">'
      +'<p style="font:600 15px Public Sans;color:#17232F;margin:0 0 20px;line-height:1.5"></p>'
      +'<div style="display:flex;gap:10px"><button class="btn ghost" id="_cno" style="flex:1;color:#42525F;border-color:#E4EBF2">'+(va?'Cancel·lar':'Cancelar')+'</button>'
      +'<button class="btn" id="_cyes" style="flex:1'+(opts.danger?';background:#C0392B':'')+'">'+yes+'</button></div></div>';
    o.querySelector('p').textContent=msg;
    document.body.appendChild(o);
    var done=function(v){ o.remove(); res(v); };
    o.querySelector('#_cno').onclick=function(){done(false);};
    o.querySelector('#_cyes').onclick=function(){done(true);};
    o.addEventListener('click',function(e){if(e.target===o)done(false);});
  });
}
function askPrompt(msg,def){
  return new Promise(function(res){
    var va=LANG==='va';
    var o=document.createElement('div');
    o.style.cssText='position:fixed;inset:0;z-index:9800;background:rgba(7,30,69,.55);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:24px';
    o.innerHTML='<div style="background:#fff;border-radius:18px;max-width:410px;width:100%;padding:26px;box-shadow:0 30px 80px rgba(10,42,94,.35)">'
      +'<p style="font:600 15px Public Sans;color:#17232F;margin:0 0 14px;line-height:1.5"></p>'
      +'<input id="_pin" style="width:100%;margin:0 0 18px" value="">'
      +'<div style="display:flex;gap:10px"><button class="btn ghost" id="_pno" style="flex:1;color:#42525F;border-color:#E4EBF2">'+(va?'Cancel·lar':'Cancelar')+'</button>'
      +'<button class="btn" id="_pok" style="flex:1">'+(va?'Guardar':'Guardar')+'</button></div></div>';
    o.querySelector('p').textContent=msg;
    document.body.appendChild(o);
    var inp=o.querySelector('#_pin'); inp.value=def||''; inp.focus(); inp.select();
    var done=function(v){o.remove();res(v);};
    o.querySelector('#_pno').onclick=function(){done(null);};
    o.querySelector('#_pok').onclick=function(){done(inp.value);};
    inp.addEventListener('keydown',function(e){if(e.key==='Enter')done(inp.value);if(e.key==='Escape')done(null);});
    o.addEventListener('click',function(e){if(e.target===o)done(null);});
  });
}
function toast(msg,opts){
  opts=opts||{};
  var t=document.createElement('div');
  t.style.cssText='position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:9900;background:'+(opts.error?'#C0392B':'#0A2A5E')+';color:#fff;font:700 14px Public Sans;padding:12px 20px;border-radius:12px;box-shadow:0 12px 32px rgba(10,42,94,.3);max-width:90vw;text-align:center';
  t.textContent=msg; document.body.appendChild(t);
  setTimeout(function(){ t.style.transition='opacity .4s'; t.style.opacity='0'; setTimeout(function(){t.remove();},400); }, opts.ms||2600);
}
window.form=function(i){
  const f=F[TAB];
  if(!f.campos.length)return;
  if(WIX[TAB])return wixEdit(i);
  const row=i===undefined?{}:ROWS[i];
  window._editRow=row;
  let ro='';
  if(f.ro&&i!==undefined)ro='<div style="background:#F7FAFD;border:1px solid #E9EEF4;border-radius:12px;padding:14px;margin-bottom:6px">'+f.ro.map(k=>row[k]?'<p style="margin:4px 0;font-size:14px"><b style="color:#42525F">'+k.replace(/_/g,' ')+':</b> '+String(row[k]).replace(/</g,'&lt;')+'</p>':'').join('')+'</div>';
  const PREVTABS=['equipo'];
  const prev=PREVTABS.includes(TAB)?'<div class="prev"><div class="prevhead">'+T('vista')+'<span><button class="ptab'+(PL==='es'?' on':'')+'" onclick="setPL(\\'es\\')">ES</button><button class="ptab'+(PL==='va'?' on':'')+'" onclick="setPL(\\'va\\')">VA</button></span></div><div id="pbody"></div></div>':'';
  const tieneVa=f.campos.some(c=>c[0].endsWith('_va'));
  $('#fbox').innerHTML=(prev?'<div class="editwrap">':'')+'<div class="form"><h3 style="font-family:Bricolage Grotesque;color:#0A2A5E;margin:0">'+(i===undefined?T('nuevoReg'):T('editar'))+'</h3>'+
    (tieneVa?'<p class="sub" style="margin:6px 0 0">🌐 '+T('autotrad')+'</p>':'')+ro+
    f.campos.map(c=>{
      const[k,lab,tipo,ops]=c;
      let v=row[k];
      if(k==='importe_eur')v=row.importe_cents!=null?(row.importe_cents/100).toString().replace('.',','):'';
      v=v==null?'':v;
      if(tipo==='select')return '<label>'+lab+'</label><select id="f_'+k+'">'+ops.map(o=>'<option '+(o===row[k]?'selected':'')+'>'+o+'</option>').join('')+'</select>';
      if(tipo==='cat_tes')return '<label>'+lab+'</label><select id="f_'+k+'">'+[...CATS_TES.ingreso,...CATS_TES.gasto].map(o=>'<option '+(o===row[k]?'selected':'')+'>'+o+'</option>').join('')+'</select>';
      if(tipo==='barrio')return '<label>'+lab+'</label><select id="f_'+k+'"><option value="">—</option>'+BARRIOS.map(b=>'<option value="'+b.id+'" '+(b.id===row[k]?'selected':'')+'>'+b.nombre_es+'</option>').join('')+'</select>';
      if(k==='imagen'||k==='foto')return '<label>'+lab+'</label><div class="drop" data-k="'+k+'">'+(v?'<img src="'+String(v).replace(/"/g,'&quot;')+'">':'')+'<span>'+(v?T('cambiar'):T('arrastra'))+'</span><input type="file" id="file_'+k+'" accept="image/*" style="display:none"></div><input type="hidden" id="f_'+k+'" value="'+String(v).replace(/"/g,'&quot;')+'">';
      if(tipo==='textarea')return '<label>'+lab+'</label><textarea id="f_'+k+'">'+String(v).replace(/</g,'&lt;')+'</textarea>';
      if(tipo==='check')return '<label>'+lab+'</label><input type="checkbox" id="f_'+k+'" style="width:20px;height:20px" '+(row[k]?'checked':'')+'>';
      if(tipo==='map'){const la=row.lat!=null?row.lat:'',lo=row.lng!=null?row.lng:'';return '<label>'+lab+'</label><div style="display:flex;gap:8px;margin-bottom:8px"><input id="f_mapdir" placeholder="'+(LANG==='va'?'Busca una adreça (ex. passeig Germanies 33)':'Busca una dirección (ej. paseo Germanías 33)')+'" style="flex:1" onkeydown="if(event.key===\\'Enter\\'){event.preventDefault();mapGeo();}"><button type="button" id="f_mapgeobtn" class="btn" style="margin:0" onclick="mapGeo()">Buscar</button></div><div id="mapbox" data-lat="'+la+'" data-lng="'+lo+'" style="height:250px;border:1px solid #E4EBF2;border-radius:10px;overflow:hidden;margin-bottom:6px;background:#EEF3F9"></div><div style="display:flex;gap:8px"><input type="number" step="any" id="f_lat" placeholder="Lat" value="'+la+'" style="flex:1"><input type="number" step="any" id="f_lng" placeholder="Lng" value="'+lo+'" style="flex:1"></div><p class="sub" style="font-size:11.5px;margin:4px 0 0">'+T('mapaHint')+'</p>';}
      if(tipo==='repeater')return '<label>'+lab+'</label><div class="rep" id="rep_'+k+'"></div><button type="button" class="btn ghost" style="margin:8px 0 2px;padding:7px 14px" onclick="repAdd(\\''+k+'\\')">'+T('anadirItem')+'</button>';
      return '<label>'+lab+'</label><input type="'+(tipo||'text')+'" id="f_'+k+'" value="'+String(v).replace(/"/g,'&quot;')+'">';
    }).join('')+
    '<div style="display:flex;gap:10px;margin-top:20px"><button class="btn" onclick="save('+(i===undefined?'':i)+')">'+T('guardar')+'</button>'+
    (i!==undefined&&TABLAS_EDIT(TAB)?'<button class="btn ghost" onclick="del('+i+')">'+T('borrar')+'</button>':'')+
    '<button class="btn" style="background:#EEF2F7;color:#42525F" onclick="document.getElementById(\\'fbox\\').innerHTML=\\'\\'">'+T('cancelar')+'</button></div><div id="fmsg" class="msg"></div></div>'+
    prev+(prev?'</div>':'');
  if(prev){$('#fbox').addEventListener('input',updPrev);$('#fbox').addEventListener('change',updPrev);updPrev();}
  document.querySelectorAll('.drop').forEach(z=>{
    const k=z.dataset.k, inp=document.getElementById('file_'+k);
    z.addEventListener('click',()=>inp.click());
    z.addEventListener('dragover',e=>{e.preventDefault();z.classList.add('over');});
    z.addEventListener('dragleave',()=>z.classList.remove('over'));
    z.addEventListener('drop',e=>{e.preventDefault();z.classList.remove('over');if(e.dataTransfer.files[0])subirImg(k,e.dataTransfer.files[0]);});
    inp.addEventListener('change',()=>{if(inp.files[0])subirImg(k,inp.files[0]);});
  });
  document.querySelectorAll('.rep').forEach(function(el){var rk=el.id.slice(4);repInit(rk,row[rk]);});
  var _mb=document.getElementById('mapbox');if(_mb)initMapa(_mb);
  if(TAB==='denuncias'&&i!==undefined&&row.codigo)denHiloBox(row.codigo);
  $('#fbox').scrollIntoView({behavior:'smooth'});
};
async function denHiloBox(codigo){
  const box=document.createElement('div');
  box.id='denHilo';
  box.style.cssText='background:#fff;border:1px solid #E7EDF4;border-radius:14px;padding:16px 18px;margin-top:10px';
  box.innerHTML='<h3 style="font:800 14px Bricolage Grotesque;color:#0A2A5E;margin:0 0 8px">💬 '+(LANG==='va'?'Conversa amb l’informant':'Conversación con el informante')+' <span style="color:#8A99A8;font-weight:600">'+codigo+'</span></h3><div id="denMsgs" class="sub">'+T('cargando')+'</div>'
    +'<div style="display:flex;gap:8px;margin-top:10px"><input id="denTxt" placeholder="'+(LANG==='va'?'Escriu un missatge per a l’informant…':'Escribe un mensaje para el informante…')+'" style="flex:1"><button class="btn" id="denSend" style="margin:0">'+(LANG==='va'?'Enviar':'Enviar')+'</button></div>'
    +'<p class="sub" style="font-size:11.5px;margin:6px 0 0">'+(LANG==='va'?'L’informant ho llegirà amb el seu codi. Si va deixar contacte, rebrà un avís per correu (sense el contingut).':'El informante lo leerá con su código. Si dejó contacto, recibirá un aviso por correo (sin el contenido).')+'</p>';
  document.getElementById('fbox').appendChild(box);
  async function pinta(){
    const r=await call({action:'den-hilo',codigo:codigo});
    const ms=(r.j&&r.j.items)||[];
    document.getElementById('denMsgs').innerHTML=ms.length?ms.map(m=>'<div style="border-radius:12px;padding:9px 13px;margin-top:7px;font-size:13px;max-width:88%;'+(m.autor==='equipo'?'background:#EAF3FC;border:1px solid #CFE0F5':'background:#F0F4F9;border:1px solid #E4EBF2;margin-left:auto')+'"><div style="font:700 10.5px Public Sans;color:#5C6B7A;text-transform:uppercase;letter-spacing:.04em;margin-bottom:2px">'+(m.autor==='equipo'?(LANG==='va'?'Equip':'Equipo'):(LANG==='va'?'Informant':'Informante'))+' · '+m.fecha+'</div>'+EH(m.texto)+'</div>').join('')
      :'<p class="sub" style="margin:0">'+(LANG==='va'?'Encara no hi ha missatges al fil.':'Aún no hay mensajes en el hilo.')+'</p>';
  }
  pinta();
  document.getElementById('denSend').addEventListener('click',async function(){
    const t=document.getElementById('denTxt').value.trim(); if(t.length<2)return;
    this.disabled=true;
    const r=await call({action:'den-msg',codigo:codigo,texto:t});
    this.disabled=false;
    if(r.j&&r.j.ok){document.getElementById('denTxt').value='';pinta();badges();}
    else toast((r.j&&r.j.error&&r.j.error.message)||'Error',{error:true});
  });
}
function repSchema(k){var c=(F[TAB].campos||[]).find(function(x){return x[0]===k});return (c&&c[3])||[];}
function repInit(k,val){var box=document.getElementById('rep_'+k);if(!box)return;box.innerHTML='';(Array.isArray(val)?val:[]).forEach(function(it){repRow(k,it);});}
window.repAdd=function(k){repRow(k,{});};
function repRow(k,item){var box=document.getElementById('rep_'+k);if(!box)return;var sub=repSchema(k);var single=sub.length===1&&sub[0][0]==='';var r=document.createElement('div');r.className='repitem';r.style.cssText='display:flex;gap:6px;align-items:flex-start;margin-bottom:6px';var inner='';sub.forEach(function(sf){var sk=sf[0],slab=sf[1]||'',st=sf[2]||'text';var v=single?(typeof item==='string'?item:''):(item&&item[sk]!=null?item[sk]:'');if(st==='select'){var ops=sf[3]||[];inner+='<select data-sk="'+sk+'" title="'+slab+'" style="flex:1;min-width:0"><option value="">'+slab+'…</option>'+ops.map(function(o){var ov=String(o).split('"').join('&quot;');return '<option value="'+ov+'"'+(String(v)===String(o)?' selected':'')+'>'+ov+'</option>';}).join('')+'</select>';}else{v=String(v).split('"').join('&quot;');inner+='<input data-sk="'+sk+'" type="'+st+'" placeholder="'+slab+'" value="'+v+'" style="flex:1;min-width:0">';}});r.innerHTML=inner+'<button type="button" class="btn ghost" style="padding:6px 11px;margin:0" onclick="this.parentNode.remove();if(window.updPrev)window.updPrev()">×</button>';box.appendChild(r);if(window.updPrev)window.updPrev();}
function repVal(k){var box=document.getElementById('rep_'+k);if(!box)return [];var sub=repSchema(k),single=sub.length===1&&sub[0][0]==='';var out=[];box.querySelectorAll('.repitem').forEach(function(r){if(single){var vv=r.querySelector('input').value.trim();if(vv)out.push(vv);return;}var o={},any=false;r.querySelectorAll('input,select').forEach(function(inp){var sk=inp.getAttribute('data-sk');var v=inp.value.trim();if(sk){o[sk]=(inp.type==='number'&&v!=='')?Number(v):v;if(v)any=true;}});if(any)out.push(o);});return out;}
function initMapa(el){if(!window.L){el.innerHTML='<p class="sub" style="padding:12px 14px">Mapa no disponible</p>';return;}var la=parseFloat(el.getAttribute('data-lat')),lo=parseFloat(el.getAttribute('data-lng'));var hasP=!isNaN(la)&&!isNaN(lo);var c=hasP?[la,lo]:[38.9686,-0.1817];var map=L.map(el).setView(c,hasP?16:13);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);var mk=L.marker(c,{draggable:true}).addTo(map);function set(ll){var a=document.getElementById('f_lat'),b=document.getElementById('f_lng');if(a)a.value=ll.lat.toFixed(6);if(b)b.value=ll.lng.toFixed(6);if(window.updPrev)window.updPrev();}mk.on('dragend',function(){set(mk.getLatLng());});map.on('click',function(e){try{map.invalidateSize({pan:false,animate:false});}catch(e2){}var ll=e.latlng;try{if(e.originalEvent)ll=map.mouseEventToLatLng(e.originalEvent)||e.latlng;}catch(e2){}mk.setLatLng(ll);set(ll);});window._formMap={map:map,mk:mk,set:set};function kick(){try{map.invalidateSize();}catch(e){}}setTimeout(kick,250);setTimeout(kick,800);setTimeout(kick,1800);try{new IntersectionObserver(function(es,obs){es.forEach(function(en){if(en.isIntersecting){kick();obs.disconnect();}});}).observe(el);}catch(e){}}
window.mapGeo=async function(){
  const q=document.getElementById('f_mapdir');if(!q||!q.value.trim())return;
  const btn=document.getElementById('f_mapgeobtn');if(btn)btn.disabled=true;
  const hit=await geoBuscar(q.value.trim());
  if(hit&&window._formMap){const ll={lat:Number(hit.lat),lng:Number(hit.lon)};window._formMap.mk.setLatLng(ll);window._formMap.map.setView(ll,17);window._formMap.set(ll);}
  else toast(LANG==='va'?'No trobat per Gandia; prova amb carrer i número':'No encontrado por Gandia; prueba con calle y número',{error:true});
  if(btn)btn.disabled=false;};
window.subirImg=async function(k,file){
  const z=document.querySelector('.drop[data-k="'+k+'"]'), sp=z.querySelector('span');
  sp.textContent=T('subiendo');
  try{
    const bmp=await createImageBitmap(file);
    const sc=Math.min(1,1600/bmp.width);
    const c=document.createElement('canvas');c.width=Math.round(bmp.width*sc);c.height=Math.round(bmp.height*sc);
    c.getContext('2d').drawImage(bmp,0,0,c.width,c.height);
    const blob=await new Promise(res=>c.toBlob(res,'image/webp',.82));
    const b64=await new Promise(res=>{const fr=new FileReader();fr.onload=()=>res(String(fr.result).split(',')[1]);fr.readAsDataURL(blob);});
    const r=await call({action:'upload',nombre:file.name,tipo:'image/webp',data:b64});
    if(r.j.url){
      document.getElementById('f_'+k).value=r.j.url;
      let im=z.querySelector('img');
      if(!im){im=document.createElement('img');z.insertBefore(im,z.firstChild);}
      im.src=r.j.url;sp.textContent=T('cambiar');
      if(window.updPrev)updPrev();
    } else sp.textContent=(r.j.error&&r.j.error.message)||'Error';
  }catch(e){sp.textContent='Error: '+e.message;}
};
let PL=LANG;
window.setPL=function(l){PL=l;document.querySelectorAll('.ptab').forEach(b=>b.classList.toggle('on',b.textContent.toLowerCase()===l));updPrev();};
function pv(k){const el=document.getElementById('f_'+k);return el?el.value.trim():'';}
function pesc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;')}
window.updPrev=function(){
  const box=document.getElementById('pbody');if(!box)return;
  const l=PL, alt=l==='va'?'es':'va';
  const val=b=>pv(b+'_'+l)||pv(b+'_'+alt);
  const titulo=val('titulo')||pv('nombre')||'';
  const cargo=val('cargo'), sub=val('extracto')||val('descripcion')||val('bio');
  const cuerpo=val('cuerpo'), img=pv('imagen')||pv('foto');
  const fecha=pv('fecha'), lugar=pv('lugar'), prog=pv('progreso');
  box.innerHTML='<div style="background:#fff;border:1px solid #E9EEF4;border-radius:16px;overflow:hidden;max-width:430px;margin:0 auto;box-shadow:0 8px 22px rgba(10,42,94,.07)">'+
    (img?'<img src="'+pesc(img)+'" style="width:100%;max-height:300px;object-fit:contain;background:#0F2A55;display:block" onerror="this.style.display=\\'none\\'">':'')+
    '<div style="padding:18px 20px">'+
    (cargo?'<div style="font:700 11px Public Sans;color:#0FA6B6;text-transform:uppercase;letter-spacing:.07em;margin-bottom:4px">'+pesc(cargo)+'</div>':'')+
    ((fecha||lugar)?'<div style="font:700 11.5px Public Sans;color:#9A6208;margin-bottom:4px">'+pesc(fecha)+(lugar?' · '+pesc(lugar):'')+'</div>':'')+
    '<div style="font:800 19px Bricolage Grotesque;color:#0A2A5E;margin:0 0 8px">'+(pesc(titulo)||T('sinTitulo'))+'</div>'+
    (sub?'<div style="font-size:13.5px;color:#5C6B7A;margin-bottom:8px">'+pesc(sub)+'</div>':'')+
    (cuerpo?'<div style="font-size:13px;color:#42525F;white-space:pre-wrap;max-height:150px;overflow:hidden">'+pesc(cuerpo)+'</div>':'')+
    (prog?'<div style="margin-top:10px;background:#EEF2F7;border-radius:999px;height:9px;overflow:hidden"><div style="width:'+Math.min(100,Number(prog)||0)+'%;height:100%;background:#F6BE18"></div></div>':'')+
    '</div></div>';
};
window.save=async function(i){
  const f=F[TAB], row={};
  if(i!==undefined&&i!=='')row.id=ROWS[i].id;
  for(const c of f.campos){
    if(c[2]==='repeater'){row[c[0]]=repVal(c[0]);continue;}
    if(c[2]==='map'){const _la=$('#f_lat'),_lo=$('#f_lng');row.lat=_la&&_la.value!==''?Number(_la.value):null;row.lng=_lo&&_lo.value!==''?Number(_lo.value):null;
      // WYSIWYG: si el usuario fijó punto, guardar la posición REAL del marcador visible (inmune a clics desviados)
      try{if(row.lat!=null&&window._formMap&&window._formMap.mk){const _mp=window._formMap.mk.getLatLng();row.lat=+Number(_mp.lat).toFixed(6);row.lng=+Number(_mp.lng).toFixed(6);}}catch(_e){}
      continue;}
    const el=$('#f_'+c[0]); if(!el)continue;
    let v=c[2]==='check'?el.checked:el.value;
    if(c[0]==='importe_eur'){row.importe_cents=Math.round(parseFloat(String(v).replace(',','.'))*100)||0;continue;}
    if(c[2]==='number')v=v===''?null:Number(v);
    if(v==='')v=null;
    row[c[0]]=v;
  }
  $('#fmsg').innerHTML='<span style="color:#5C6B7A">'+T('guardando')+'</span>';
  const r=await call({action:'save',tabla:TAB,row});
  if(r.j.ok){$('#fmsg').innerHTML='<span style="color:#1E7A45">'+T('guardado')+'</span>';setTimeout(render,500);}
  else $('#fmsg').innerHTML='<span class="warn">'+((r.j.error&&r.j.error.message)||'Error')+'</span>';
};
window.del=async function(i){
  if(!await askConfirm(T('confirmBorrar'),{danger:true,yes:T('borrar')}))return;
  const r=await call({action:'del',tabla:TAB,id:ROWS[i].id});
  if(r.j.ok){render();toast(T('guardado'));}else toast(T('noBorrar'),{error:true});
};
// ================= Editor visual (modo Wix): la página real, editable in-place =================
const WIX={posts:1,events:1,campaigns:1,actuaciones:1};
let WL=LANG;                                  // idioma que se está editando
const NL=String.fromCharCode(10);
function wv(k){const r=(window._wix&&window._wix.row)||{};return r[k]!=null?String(r[k]):'';}
function wED(k,ph,st,tag){tag=tag||'div';return '<'+tag+' class="ed" data-k="'+k+'" data-ph="'+ph+'" contenteditable="true" style="'+st+'">'+EH(wv(k)).split(NL).join('<br>')+'</'+tag+'>';}
function wChipTxt(t,bg,col){return '<span style="background:'+bg+';color:'+col+';font:700 10.5px Public Sans;text-transform:uppercase;letter-spacing:.07em;padding:4px 11px;border-radius:999px">'+EH(t)+'</span>';}
function wSel(wk,lab,ops){const cur=wv(wk);return '<label>'+lab+'<select data-wk="'+wk+'">'+ops.map(function(o){return '<option value="'+o+'"'+(o===cur?' selected':'')+'>'+o+'</option>';}).join('')+'</select></label>';}
function wBarrioSel(){const cur=wv('barrio_id');return '<label>'+(WL==='va'?'Barri':'Barrio')+'<select data-wk="barrio_id"><option value="">—</option>'+BARRIOS.map(function(b){return '<option value="'+b.id+'"'+(b.id===cur?' selected':'')+'>'+EH(b.nombre_es)+'</option>';}).join('')+'</select></label>';}
function wChk(wk,lab){return '<label style="flex-direction:row;align-items:center;gap:7px;color:#cdd9ec;font:600 12px Public Sans;text-transform:none;letter-spacing:0"><input type="checkbox" data-wk="'+wk+'"'+(window._wix.row[wk]?' checked':'')+' style="width:17px;height:17px">'+lab+'</label>';}
function wIn(wk,lab,type,st){return '<label>'+lab+'<input type="'+type+'" data-wk="'+wk+'" value="'+EH(wv(wk))+'" style="'+(st||'')+'"></label>';}
function wImg(k,h,ph){const v=wv(k);
  return '<div class="wiximg" data-wimg="'+k+'" style="height:'+h+';background:#EEF3F9 center/cover no-repeat'+(v?';background-image:url('+v.split("'").join('').split('"').join('')+')':'')+'">'
   +(v?'':'<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#8A99A8;font:700 13px Public Sans">📷 '+ph+'</div>')
   +'<div class="cam">📷 '+(WL==='va'?'Canviar imatge':'Cambiar imagen')+'</div></div>';}
function wImgV(k,ph){const v=wv(k);
  return '<div class="wiximg" data-wimg="'+k+'" style="height:320px;max-width:220px;border-radius:10px;overflow:hidden;background:#0F2A55 center/contain no-repeat'+(v?';background-image:url('+v.split("'").join('').split('"').join('')+')':'')+'">'
   +(v?'':'<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#9AA8B8;font:700 12px Public Sans;text-align:center;padding:10px">📱 '+ph+'</div>')
   +'<div class="cam">📷 '+(WL==='va'?'Canviar':'Cambiar')+'</div></div>';}
function wBar(extra){
  const va=WL==='va', i=window._wix.i;
  return '<div class="wixbar">'
    +'<button class="btn gold" onclick="wixSave()">'+T('guardar')+'</button>'
    +(i!==undefined&&i!==''?'<button class="btn ghost" style="color:#F5C9C9" onclick="del('+i+')">'+T('borrar')+'</button>':'')
    +'<button class="btn" style="background:#12294E;color:#cdd9ec" onclick="document.getElementById(\\'fbox\\').innerHTML=\\'\\'">'+T('cancelar')+'</button>'
    +'<span style="display:flex;background:#12294E;border-radius:8px;padding:3px">'
      +'<button class="btn" style="margin:0;padding:6px 12px;font-size:12px;background:'+(WL==='es'?'#F6BE18':'transparent')+';color:'+(WL==='es'?'#0A2A5E':'#cdd9ec')+'" onclick="setWL(\\'es\\')">ES</button>'
      +'<button class="btn" style="margin:0;padding:6px 12px;font-size:12px;background:'+(WL==='va'?'#F6BE18':'transparent')+';color:'+(WL==='va'?'#0A2A5E':'#cdd9ec')+'" onclick="setWL(\\'va\\')">VA</button>'
    +'</span>'
    +(extra||'')
    +'<span id="wixmsg" style="color:#F6BE18;font:700 12px Public Sans"></span>'
    +'<span style="color:#9FB2CC;font:600 11px Public Sans;margin-left:auto">✏️ '+(va?'Fes clic sobre qualsevol text per a editar-lo · el que faltes es tradueix en guardar':'Haz clic sobre cualquier texto para editarlo · lo que falte se traduce al guardar')+'</span>'
    +'</div>';}
function wRepTl(rk,accent,addLab,simple){
  const arr=Array.isArray(window._wix.row[rk])?window._wix.row[rk]:[];
  let h='<div data-rep="'+rk+'">';
  for(let x=0;x<arr.length;x++){const it=arr[x]||{};
    h+='<div class="wixitem" style="display:flex;gap:12px;align-items:flex-start;margin-bottom:2px">'
     +'<div style="display:flex;flex-direction:column;align-items:center;align-self:stretch"><span style="width:12px;height:12px;border-radius:50%;background:'+accent+';margin-top:7px;flex-shrink:0"></span><span style="width:2px;flex:1;background:#E4EBF2"></span></div>'
     +'<div style="flex:1;min-width:0;padding-bottom:14px">'
     +'<span class="ed" data-sk="date" data-ph="'+(WL==='va'?'Data (ex. 12 mar 2026)':'Fecha (ej. 12 mar 2026)')+'" contenteditable="true" style="display:inline-block;font:700 10.5px Public Sans;color:#8A99A8;text-transform:uppercase;letter-spacing:.05em;min-width:80px">'+EH(it.date||it.fecha||'')+'</span>'
     +(simple?'':'<div class="ed" data-sk="title" data-ph="'+(WL==='va'?'Títol de la fita':'Título del hito')+'" contenteditable="true" style="font:700 14.5px Public Sans;color:#17232F">'+EH(it.title||it.titulo||'')+'</div>')
     +'<div class="ed" data-sk="text" data-ph="'+(simple?(WL==='va'?'Què va passar en esta data...':'Qué pasó en esta fecha...'):(WL==='va'?'Detall (opcional)':'Detalle (opcional)'))+'" contenteditable="true" style="font:'+(simple?'600 14px Public Sans;color:#33414F':'400 13px Public Sans;color:#5C6B7A')+'">'+EH(it.text||it.texto||'')+'</div>'
     +'</div><button class="wixdel" onclick="wixRepDel(\\''+rk+'\\','+x+')">×</button></div>';}
  return h+'<button class="wixadd" onclick="wixRepAdd(\\''+rk+'\\')">'+addLab+'</button></div>';}
function wRepList(rk,addLab,ph){
  const arr=Array.isArray(window._wix.row[rk])?window._wix.row[rk]:[];
  let h='<div data-rep="'+rk+'" data-single="1">';
  for(let x=0;x<arr.length;x++){const it=arr[x];const v=typeof it==='string'?it:((it&&it.text)||'');
    h+='<div class="wixitem" style="display:flex;gap:9px;align-items:flex-start;margin-bottom:6px"><span style="color:#2E9E5B;font-weight:800;margin-top:1px">✓</span>'
     +'<div class="ed" data-sk="text" data-ph="'+ph+'" contenteditable="true" style="flex:1;font:400 14px Public Sans;color:#42525F">'+EH(v)+'</div>'
     +'<button class="wixdel" onclick="wixRepDel(\\''+rk+'\\','+x+')">×</button></div>';}
  return h+'<button class="wixadd" onclick="wixRepAdd(\\''+rk+'\\')">'+addLab+'</button></div>';}
function wRepDocs(addLab){
  const arr=Array.isArray(window._wix.row.docs)?window._wix.row.docs:[];
  let h='<div data-rep="docs">';
  for(let x=0;x<arr.length;x++){const it=arr[x]||{};
    h+='<div class="wixitem" style="display:flex;gap:10px;align-items:center;border:1px solid #E4EBF2;border-radius:10px;padding:10px 13px;margin-bottom:7px"><span style="font-size:17px">📄</span>'
     +'<div style="flex:1;min-width:0">'
     +'<div class="ed" data-sk="name" data-ph="'+(WL==='va'?'Nom del document':'Nombre del documento')+'" contenteditable="true" style="font:700 13px Public Sans;color:#17232F">'+EH(it.name||'')+'</div>'
     +'<span class="ed" data-sk="size" data-ph="PDF · 2 MB" contenteditable="true" style="display:inline-block;font:400 11px Public Sans;color:#8A99A8;min-width:70px">'+EH(it.size||'')+'</span>'
     +'<div class="ed" data-sk="href" data-ph="https://... (enllaç)" contenteditable="true" style="font:400 11px Public Sans;color:#1563C4;word-break:break-all">'+EH(it.href||'')+'</div>'
     +'</div><button class="wixdel" onclick="wixRepDel(\\'docs\\','+x+')">×</button></div>';}
  return h+'<button class="wixadd" id="wixdocadd">📎 '+addLab+' — '+(WL==='va'?'fes clic o arrossega un PDF ací':'haz clic o arrastra un PDF aquí')+'</button>'
    +'<button class="wixadd" style="margin-left:8px" onclick="wixRepAdd(\\'docs\\')">'+(WL==='va'?'+ enllaç manual':'+ enlace manual')+'</button></div>';}
window.wixRepAdd=function(rk){wixCollect();const r=window._wix.row;if(!Array.isArray(r[rk]))r[rk]=[];r[rk].push({});wixRender();};
window.wixRepDel=function(rk,x){wixCollect();const r=window._wix.row;if(Array.isArray(r[rk]))r[rk].splice(x,1);wixRender();};
window.setWL=function(l){wixCollect();WL=l;wixRender();};
window.wixCollect=function(){
  const r=window._wix.row;
  document.querySelectorAll('#fbox .ed[data-k]').forEach(function(el){r[el.getAttribute('data-k')]=el.innerText.trim();});
  document.querySelectorAll('#fbox [data-wk]').forEach(function(el){
    const k=el.getAttribute('data-wk');
    if(el.type==='checkbox'){r[k]=el.checked;return;}
    let v=el.value;
    if(el.type==='number')v=(v===''?null:Number(v));
    if(v==='')v=null;
    r[k]=v;});
  document.querySelectorAll('#fbox [data-rep]').forEach(function(box){
    const rk=box.getAttribute('data-rep'), single=box.getAttribute('data-single')==='1';
    const out=[];
    box.querySelectorAll('.wixitem').forEach(function(it){
      if(single){const e=it.querySelector('.ed');const v=e?e.innerText.trim():'';if(v)out.push(v);return;}
      const o={};let any=false;
      it.querySelectorAll('.ed[data-sk]').forEach(function(e){const v=e.innerText.trim();o[e.getAttribute('data-sk')]=v;if(v)any=true;});
      if(any)out.push(o);});
    r[rk]=out;});};
window.wixEdit=function(i){
  const row=i===undefined?{}:JSON.parse(JSON.stringify(ROWS[i]||{}));
  window._wix={i:i,row:row};
  WL=LANG;
  wixRender();
  document.getElementById('fbox').scrollIntoView({behavior:'smooth'});};
window.wixRender=function(){
  const va=WL==='va', r=window._wix.row;
  let bar='',page='';
  const H3='font:800 17px Fraunces;color:#0A2A5E;margin:22px 0 10px';
  if(TAB==='posts'){
    bar=wBar(wSel('tipo',(va?'Tipus':'Tipo'),['noticia','comunicado','video','entrevista'])+wSel('estado','Estado',['borrador','publicado','archivado']));
    page='<div class="wixpage">'+wImg('imagen','240px',(va?'Fes clic per a pujar la imatge de la notícia':'Haz clic para subir la imagen de la noticia'))
      +'<div style="padding:26px 30px 30px;max-width:780px">'
      +'<div style="font:600 11px Public Sans;color:#8A99A8;margin-bottom:10px">'+(va?'Inici · Actualitat':'Inicio · Actualidad')+'</div>'
      +wED('titulo_'+WL,(va?'Fes clic i escriu el títol de la notícia...':'Haz clic y escribe el título de la noticia...'),'font:800 30px Fraunces;color:#0A2A5E;letter-spacing:-.01em;line-height:1.15;margin:0 0 12px')
      +wED('extracto_'+WL,(va?'Entradeta breu (ix a les targetes)...':'Entradilla breve (sale en las tarjetas)...'),'font:600 15.5px Public Sans;color:#33414F;line-height:1.6;margin:0 0 14px')
      +wED('cuerpo_'+WL,(va?'Cos de la notícia. Cada salt de línia és un paràgraf nou...':'Cuerpo de la noticia. Cada salto de línea es un párrafo nuevo...'),'font:400 15px Public Sans;color:#42525F;line-height:1.75;min-height:130px')
      +'<div id="wixvidrow" style="margin-top:18px;display:flex;gap:8px;align-items:center;background:#F7FAFD;border:1px dashed #C9D6E4;border-radius:10px;padding:9px 13px"><span style="font:700 11px Public Sans;color:#8A99A8;text-transform:uppercase;flex-shrink:0">▶ Vídeo</span>'+wED('video_url',(va?'Enganxa un enllaç de YouTube, o fes clic al clip / arrossega un vídeo curt...':'Pega un enlace de YouTube, o haz clic en el clip / arrastra un vídeo corto...'),'font:400 12.5px Public Sans;color:#1563C4;flex:1','span')+'<button class="wixadd" style="margin:0;padding:6px 11px" onclick="wixVidPick()">📎</button></div>'
      +(r.tipo==='video'?'<div style="margin-top:14px"><div style="font:700 11px Public Sans;color:#8A99A8;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">📱 '+(va?'Miniatura vertical (per a l Inici) — opcional':'Miniatura vertical (para el Inicio) — opcional')+'</div><div style="font:400 12px Public Sans;color:#8A99A8;margin-bottom:8px">'+(va?'La horitzontal de dalt s usa a la pàgina i a Actualitat; esta vertical, al tile de l Inici.':'La horizontal de arriba se usa en la página y en Actualidad; esta vertical, en el tile del Inicio.')+'</div>'+wImgV('imagen_vertical',(va?'Arrossega la miniatura vertical':'Arrastra la miniatura vertical'))+'</div>':'')
      +'</div></div>';
  } else if(TAB==='events'){
    bar=wBar(wIn('fecha',(va?'Data':'Fecha'),'date')+wIn('hora_inicio',(va?'Inici':'Inicio'),'time')+wIn('hora_fin','Fin','time')+wBarrioSel()+wSel('estado','Estado',['borrador','publicado','cancelado'])+wChk('inscribible',(va?'Admet inscripció':'Admite inscripción')));
    let dd=null;try{if(r.fecha)dd=new Date(String(r.fecha).slice(0,10)+'T00:00:00');}catch(e){}
    const dia=dd&&!isNaN(dd)?String(dd.getDate()):'··', mes=dd&&!isNaN(dd)?dd.toLocaleDateString(va?'ca':'es-ES',{month:'short'}):(va?'mes':'mes');
    page='<div class="wixpage"><div style="background:linear-gradient(135deg,#0A2A5E,#1563C4);padding:26px 30px;color:#fff;display:flex;gap:18px;align-items:flex-start">'
      +'<div style="background:#fff;color:#0A2A5E;border-radius:12px;min-width:68px;text-align:center;padding:10px;flex-shrink:0"><div id="wixdd" style="font:800 26px Fraunces;line-height:1">'+EH(dia)+'</div><div id="wixmm" style="font:700 10.5px Public Sans;text-transform:uppercase;letter-spacing:.05em;margin-top:3px">'+EH(mes)+'</div></div>'
      +'<div style="min-width:0;flex:1">'
      +wED('titulo_'+WL,(va?'Fes clic i escriu el nom de l acte...':'Haz clic y escribe el nombre del acto...'),'font:800 24px Fraunces;letter-spacing:-.01em;line-height:1.15;color:#fff;margin:0 0 8px')
      +'<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;font:600 13px Public Sans;color:#cdd9ec"><span id="wixhoras">🕐 '+EH(String(r.hora_inicio||'--:--').slice(0,5))+(r.hora_fin?' – '+EH(String(r.hora_fin).slice(0,5)):'')+'</span><span>📍</span>'+wED('lugar',(va?'Lloc (ex. Casa de Cultura)':'Lugar (ej. Casa de Cultura)'),'font:600 13px Public Sans;color:#fff;min-width:140px;display:inline-block','span')+'</div>'
      +'</div></div>'
      +'<div style="padding:22px 30px 28px;max-width:780px">'
      +'<div style="display:flex;gap:8px;align-items:center;margin-bottom:12px"><span style="font:700 11px Public Sans;color:#8A99A8;text-transform:uppercase;flex-shrink:0">'+(va?'Adreça':'Dirección')+'</span>'+wED('direccion',(va?'Carrer i número...':'Calle y número...'),'font:600 13px Public Sans;color:#42525F;flex:1','span')+'</div>'
      +wED('descripcion_'+WL,(va?'Descripció de l acte: què es farà, per a qui, per què val la pena anar...':'Descripción del acto: qué se hará, para quién, por qué merece la pena ir...'),'font:400 15px Public Sans;color:#42525F;line-height:1.7;min-height:90px')
      +'<div style="margin-top:18px"><span style="display:inline-block;background:'+(r.inscribible?'#F6BE18':'#EEF2F7')+';color:'+(r.inscribible?'#0A2A5E':'#5C6B7A')+';font:800 14px Public Sans;padding:13px 24px;border-radius:10px">'+(r.inscribible?(va?'Inscripció oberta':'Inscribirme'):(va?'Més informació':'Más información'))+'</span></div>'
      +'</div></div>';
  } else if(TAB==='campaigns'){
    bar=wBar(wSel('estado','Estado',['borrador','activa','finalizada'])+wIn('progreso','%','number','width:64px')+wChk('destacada',(va?'Destacada a la Home':'Destacada en Home')));
    const prog=Math.max(0,Math.min(100,Number(r.progreso)||0));
    page='<div class="wixpage">'+wImg('imagen','210px',(va?'Fes clic per a pujar la imatge de la campanya':'Haz clic para subir la imagen de la campaña'))
      +'<div style="background:linear-gradient(135deg,#0A2A5E,#0E3D7A);padding:24px 30px;color:#fff">'
      +wChipTxt(r.estado==='finalizada'?(va?'Finalitzada':'Finalizada'):(r.estado==='borrador'?(va?'Esborrany':'Borrador'):(va?'Campanya activa':'Campaña activa')),'rgba(255,255,255,.16)','#F6BE18')
      +wED('titulo_'+WL,(va?'Fes clic i escriu el títol de la campanya...':'Haz clic y escribe el título de la campaña...'),'font:800 26px Fraunces;color:#fff;letter-spacing:-.01em;line-height:1.15;margin:12px 0 12px')
      +'<div style="display:flex;align-items:center;gap:10px"><div style="flex:1;height:10px;background:rgba(255,255,255,.25);border-radius:999px;overflow:hidden"><div id="wixpb" style="width:'+prog+'%;height:100%;background:#F6BE18"></div></div><span id="wixpt" style="font:800 14px Public Sans">'+prog+'%</span></div>'
      +'</div>'
      +'<div style="padding:22px 30px 28px;max-width:780px">'
      +wED('descripcion_'+WL,(va?'Descripció de la campanya: què demaneu i per què...':'Descripción de la campaña: qué pedís y por qué...'),'font:400 15px Public Sans;color:#42525F;line-height:1.7;min-height:80px')
      +'<h3 style="'+H3+'">'+(va?'Objectius':'Objetivos')+'</h3>'+wRepList('objetivos',(va?'+ Afegir objectiu':'+ Añadir objetivo'),(va?'Escriu un objectiu...':'Escribe un objetivo...'))
      +'<h3 style="'+H3+'">'+(va?'Cronologia':'Cronología')+'</h3>'+wRepTl('cronologia','#1563C4',(va?'+ Afegir fita':'+ Añadir hito'),true)
      +'<h3 style="'+H3+'">'+(va?'Documents':'Documentos')+'</h3>'+wRepDocs((va?'+ Afegir document':'+ Añadir documento'))
      +'</div></div>';
  } else if(TAB==='actuaciones'){
    bar=wBar(wSel('estado','Estado',['propuesta','en_curso','completada'])+wBarrioSel());
    const eA=r.estado==='completada'?[(va?'Completada':'Completada'),'#E7F4EC','#1E7A45']:(r.estado==='en_curso'?[(va?'En curs':'En curso'),'#EAF3FC','#1563C4']:[(va?'Proposta':'Propuesta'),'#FDF3D7','#9A6208']);
    page='<div class="wixpage"><div style="background:linear-gradient(135deg,#0A2A5E,#0E3D7A);padding:24px 30px;color:#fff">'
      +wChipTxt(eA[0],eA[1],eA[2])
      +wED('titulo_'+WL,(va?'Fes clic i escriu el títol de l actuació...':'Haz clic y escribe el título de la actuación...'),'font:800 25px Fraunces;color:#fff;letter-spacing:-.01em;line-height:1.15;margin:12px 0 0')
      +'</div><div style="padding:22px 30px 28px;max-width:780px">'
      +wED('descripcion_'+WL,(va?'Descripció: què s ha fet o què es proposa fer...':'Descripción: qué se ha hecho o qué se propone hacer...'),'font:400 15px Public Sans;color:#42525F;line-height:1.7;min-height:80px')
      +'<h3 style="'+H3+'">'+(va?'Ubicació al mapa':'Ubicación en el mapa')+'</h3>'
      +'<div style="display:flex;gap:8px;margin-bottom:8px"><input id="wixdir" placeholder="'+(va?'Escriu una adreça (ex. Passeig Germanies 33) i prem Buscar':'Escribe una dirección (ej. Passeig Germanies 33) y pulsa Buscar')+'" style="flex:1" onkeydown="if(event.key===\\'Enter\\')wixGeo()"><button id="wixgeobtn" class="btn" style="margin:0" onclick="wixGeo()">'+(va?'Buscar':'Buscar')+'</button></div>'
      +'<div id="wixmap" style="height:270px;border:1px solid #E4EBF2;border-radius:12px;overflow:hidden;background:#EEF3F9"></div>'
      +'<div id="wixcoords" style="font:600 12px Public Sans;color:#1563C4;margin-top:6px">'+((r.lat!=null&&r.lat!=='')?('📍 '+r.lat+', '+r.lng):(va?'Fes clic al mapa o busca una adreça per a fixar el punt':'Pincha en el mapa o busca una dirección para fijar el punto'))+'</div>'
      +'<h3 style="'+H3+'">'+(va?'Recorregut de l actuació':'Recorrido de la actuación')+'</h3>'+wRepTl('cronologia',eA[2],(va?'+ Afegir fita':'+ Añadir hito'))
      +'</div></div>';
  }
  document.getElementById('fbox').innerHTML=bar+page;
  document.querySelectorAll('#fbox .wiximg').forEach(function(z){
    const k=z.getAttribute('data-wimg');
    z.addEventListener('click',function(){
      const inp=document.createElement('input');inp.type='file';inp.accept='image/*';
      inp.onchange=function(){if(inp.files[0])wixUpImg(k,inp.files[0]);};
      inp.click();});
    z.addEventListener('dragover',function(e){e.preventDefault();});
    z.addEventListener('drop',function(e){e.preventDefault();if(e.dataTransfer.files[0])wixUpImg(k,e.dataTransfer.files[0]);});});
  const da=document.getElementById('wixdocadd');
  if(da){
    da.addEventListener('click',function(){
      const inp=document.createElement('input');inp.type='file';inp.accept='application/pdf,image/*';
      inp.onchange=function(){if(inp.files[0])wixDocFile(inp.files[0]);};
      inp.click();});
    da.addEventListener('dragover',function(e){e.preventDefault();da.classList.add('over');});
    da.addEventListener('dragleave',function(){da.classList.remove('over');});
    da.addEventListener('drop',function(e){e.preventDefault();da.classList.remove('over');if(e.dataTransfer.files[0])wixDocFile(e.dataTransfer.files[0]);});}
  const vr=document.getElementById('wixvidrow');
  if(vr){
    vr.addEventListener('dragover',function(e){e.preventDefault();vr.style.borderColor='#1563C4';});
    vr.addEventListener('dragleave',function(){vr.style.borderColor='#C9D6E4';});
    vr.addEventListener('drop',function(e){e.preventDefault();vr.style.borderColor='#C9D6E4';if(e.dataTransfer.files[0])wixVidFile(e.dataTransfer.files[0]);});}
  // Selects y checkboxes: elegir una opción sí refresca la página (no se teclea en ellos).
  document.querySelectorAll('#fbox .wixbar select, #fbox .wixbar input[type=checkbox]').forEach(function(el){
    el.addEventListener('change',function(){wixCollect();wixRender();});});
  // Fecha/hora/número: NUNCA re-renderizar mientras se teclea (echaba del campo);
  // se actualizan en vivo solo las piezas afectadas (día, horas, % de progreso).
  document.querySelectorAll('#fbox .wixbar input[type=date], #fbox .wixbar input[type=time], #fbox .wixbar input[type=number]').forEach(function(el){
    el.addEventListener('input',function(){wixCollect();wixLight();});
    el.addEventListener('change',function(){wixCollect();wixLight();});});
  if(TAB==='actuaciones')wixMapInit();};
function wixLight(){
  const r=window._wix.row;
  const dd=document.getElementById('wixdd'), mm=document.getElementById('wixmm');
  if(dd){let d=null;try{if(r.fecha)d=new Date(String(r.fecha).slice(0,10)+'T00:00:00');}catch(e){}
    dd.textContent=(d&&!isNaN(d))?String(d.getDate()):'··';
    if(mm)mm.textContent=(d&&!isNaN(d))?d.toLocaleDateString(WL==='va'?'ca':'es-ES',{month:'short'}):'mes';}
  const hs=document.getElementById('wixhoras');
  if(hs)hs.textContent='🕐 '+String(r.hora_inicio||'--:--').slice(0,5)+(r.hora_fin?' – '+String(r.hora_fin).slice(0,5):'');
  const pb=document.getElementById('wixpb'), pt=document.getElementById('wixpt');
  if(pb){const p=Math.max(0,Math.min(100,Number(r.progreso)||0));pb.style.width=p+'%';if(pt)pt.textContent=p+'%';}}
window.wixUpRaw=async function(file,cb){
  try{
    if(file.size>4500000){toast(WL==='va'?'Arxiu massa gran (màx 4,5 MB). Si és un vídeo, puja-l a YouTube i enganxa l enllaç.':'Archivo demasiado grande (máx 4,5 MB). Si es un vídeo, súbelo a YouTube y pega el enlace.',{error:true});return;}
    const b64=await new Promise(function(res){const fr=new FileReader();fr.onload=function(){res(String(fr.result).split(',')[1]);};fr.readAsDataURL(file);});
    const rr=await call({action:'upload',nombre:file.name,tipo:file.type||'application/octet-stream',data:b64});
    if(rr.j&&rr.j.url)cb(rr.j.url);
    else toast((rr.j&&rr.j.error&&rr.j.error.message)||'Error de subida',{error:true});
  }catch(e){toast('Error: '+e.message,{error:true});}};
window.wixDocFile=function(file){
  wixUpRaw(file,function(url){
    wixCollect();
    const r=window._wix.row;if(!Array.isArray(r.docs))r.docs=[];
    const mb=file.size/1048576;
    const tipoTxt=file.type==='application/pdf'?'PDF':String(file.type||'DOC').split('/').pop().toUpperCase();
    const sz=tipoTxt+' · '+(mb<0.1?Math.round(file.size/1024)+' KB':mb.toFixed(1).replace('.',',')+' MB');
    const base=file.name.indexOf('.')>0?file.name.split('.').slice(0,-1).join('.'):file.name;
    r.docs.push({name:base,size:sz,href:url});
    wixRender();toast(T('guardado'));});};
window.wixVidFile=function(file){
  const t=String(file.type||'');
  if(t.indexOf('video/')!==0){toast(WL==='va'?'Aquest arxiu no és un vídeo. També pots pegar un enllaç de YouTube a dalt.':'Ese archivo no es un vídeo. También puedes pegar un enlace de YouTube arriba.',{error:true});return;}
  if(file.size>52428800){toast(WL==='va'?'El vídeo supera els 50 MB. Per a vídeos llargs, puja l a YouTube i pega l enllaç (recomanat).':'El vídeo supera los 50 MB. Para vídeos largos, súbelo a YouTube y pega el enlace (recomendado).',{error:true});return;}
  // Subida DIRECTA a Storage con URL firmada: NO pasa por la función → sin el tope de ~4,5 MB.
  toast(WL==='va'?'Pujant vídeo…':'Subiendo vídeo…');
  (async function(){
    try{
      const sig=await call({action:'sign-upload',nombre:file.name,tipo:file.type});
      if(!sig.j||!sig.j.signedUrl){toast((sig.j&&sig.j.error&&sig.j.error.message)||(WL==='va'?'No s ha pogut pujar':'No se pudo subir'),{error:true});return;}
      const put=await fetch(sig.j.signedUrl,{method:'PUT',headers:{'content-type':file.type||'video/mp4'},body:file});
      if(!put.ok){toast(WL==='va'?'Error en pujar el vídeo':'Error al subir el vídeo',{error:true});return;}
      wixCollect();window._wix.row.video_url=sig.j.publicUrl;
      // Fijar la URL directamente en el campo editable: así, al guardar, wixCollect lee la URL COMPLETA
      // (no se trunca si wixRender no repinta ese span). Sin esto el video_url se guardaba a medias.
      var _ed=document.querySelector('#fbox .ed[data-k="video_url"]'); if(_ed) _ed.innerText=sig.j.publicUrl;
      wixRender();
      var _ed2=document.querySelector('#fbox .ed[data-k="video_url"]'); if(_ed2) _ed2.innerText=sig.j.publicUrl;
      toast(WL==='va'?'Vídeo pujat ✓ Recorda desar':'Vídeo subido ✓ Recuerda guardar');
    }catch(e){toast('Error: '+String(e&&e.message||e),{error:true});}
  })();};
window.wixVidPick=function(){
  const inp=document.createElement('input');inp.type='file';inp.accept='video/*';
  inp.onchange=function(){if(inp.files[0])wixVidFile(inp.files[0]);};
  inp.click();};
function wixMapInit(){
  const el=document.getElementById('wixmap');if(!el||!window.L)return;
  const r=window._wix.row;
  const has=r.lat!=null&&r.lat!==''&&r.lng!=null&&r.lng!=='';
  const c=has?[Number(r.lat),Number(r.lng)]:[38.9686,-0.1817];
  const map=L.map(el).setView(c,has?16:13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);
  const mk=L.marker(c,{draggable:true}).addTo(map);
  function set(ll){r.lat=+Number(ll.lat).toFixed(6);r.lng=+Number(ll.lng).toFixed(6);const t=document.getElementById('wixcoords');if(t)t.textContent='📍 '+r.lat+', '+r.lng;}
  mk.on('dragend',function(){set(mk.getLatLng());});
  map.on('click',function(e){try{map.invalidateSize({pan:false,animate:false});}catch(er){}var ll=e.latlng;try{if(e.originalEvent)ll=map.mouseEventToLatLng(e.originalEvent)||e.latlng;}catch(er){}mk.setLatLng(ll);set(ll);});
  window._wixMap={map:map,mk:mk,set:set};
  function kick(){try{map.invalidateSize();}catch(e){}}
  setTimeout(kick,250);setTimeout(kick,800);setTimeout(kick,1800);
  try{new IntersectionObserver(function(es,obs){es.forEach(function(en){if(en.isIntersecting){kick();obs.disconnect();}});}).observe(el);}catch(e){}}
// Geocodificador permisivo: prueba la consulta tal cual y traducida ES<->VA
// (calle/carrer, plaza/plaça...), siempre acotado a Gandia y alrededores (viewbox).
function geoVariants(q){
  const E2V={'calle':'carrer','avenida':'avinguda','avda':'avinguda','av':'avinguda','plaza':'plaça','paseo':'passeig','camino':'camí','iglesia':'església','ayuntamiento':'ajuntament','playa':'platja','puerto':'port','mercado':'mercat','san':'sant','nueva':'nova','mayor':'major','parque':'parc','estación':'estació','estacion':'estació','jardín':'jardí','jardin':'jardí','río':'riu','rio':'riu','centro':'centre','ciudad':'ciutat','colegio':'escola','teatro':'teatre','museo':'museu','puente':'pont','castillo':'castell','cementerio':'cementeri','polideportivo':'poliesportiu','estadio':'estadi'};
  const V2E={'carrer':'calle','avinguda':'avenida','plaça':'plaza','passeig':'paseo','camí':'camino','cami':'camino','església':'iglesia','esglesia':'iglesia','ajuntament':'ayuntamiento','platja':'playa','port':'puerto','mercat':'mercado','sant':'san','nova':'nueva','major':'mayor','parc':'parque','estació':'estación','estacio':'estación','jardí':'jardín','jardi':'jardín','riu':'río','centre':'centro','ciutat':'ciudad','escola':'colegio','teatre':'teatro','museu':'museo','pont':'puente','castell':'castillo','cementeri':'cementerio','poliesportiu':'polideportivo','estadi':'estadio'};
  function swap(s,map){return s.split(' ').map(function(w){const lw=w.toLowerCase();return map[lw]||w;}).join(' ');}
  const out=[q,swap(q,E2V),swap(q,V2E)];
  return out.filter(function(v,i){return out.indexOf(v)===i;});}
async function geoBuscar(texto){
  const enCaja=function(c){return c[1]>=38.84&&c[1]<=39.12&&c[0]>=-0.36&&c[0]<=-0.01;};   // Gandia y alrededores
  for(const v of geoVariants(texto)){
    try{                                                     // Photon: tolerante a erratas y multiidioma, sesgado a Gandia
      const rq=await fetch('https://photon.komoot.io/api/?q='+encodeURIComponent(v)+'&lat=38.9686&lon=-0.1817&limit=5');
      const j=await rq.json();
      const f=(j.features||[]).filter(function(x){return enCaja(x.geometry.coordinates);})[0];
      if(f)return {lat:f.geometry.coordinates[1],lon:f.geometry.coordinates[0]};
    }catch(e){}}
  try{                                                       // último intento: Nominatim anclado a Gandia
    const rq=await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=es&q='+encodeURIComponent(texto+', Gandia, Valencia'));
    const j=await rq.json();
    if(j&&j[0])return j[0];
  }catch(e){}
  return null;}
window.wixGeo=async function(){
  const q=document.getElementById('wixdir');if(!q||!q.value.trim())return;
  const btn=document.getElementById('wixgeobtn');if(btn)btn.disabled=true;
  const hit=await geoBuscar(q.value.trim());
  if(hit&&window._wixMap){const ll={lat:Number(hit.lat),lng:Number(hit.lon)};window._wixMap.mk.setLatLng(ll);window._wixMap.map.setView(ll,17);window._wixMap.set(ll);}
  else toast(WL==='va'?'No trobat per Gandia; prova amb carrer i número':'No encontrado por Gandia; prueba con calle y número',{error:true});
  if(btn)btn.disabled=false;};
window.wixUpImg=async function(k,file){
  try{
    const bmp=await createImageBitmap(file);
    const sc=Math.min(1,1600/bmp.width);
    const c=document.createElement('canvas');c.width=Math.round(bmp.width*sc);c.height=Math.round(bmp.height*sc);
    c.getContext('2d').drawImage(bmp,0,0,c.width,c.height);
    const blob=await new Promise(function(res){c.toBlob(res,'image/webp',.82);});
    const b64=await new Promise(function(res){const fr=new FileReader();fr.onload=function(){res(String(fr.result).split(',')[1]);};fr.readAsDataURL(blob);});
    const rr=await call({action:'upload',nombre:file.name,tipo:'image/webp',data:b64});
    if(rr.j&&rr.j.url){wixCollect();window._wix.row[k]=rr.j.url;wixRender();toast(T('guardado'));}
    else toast((rr.j&&rr.j.error&&rr.j.error.message)||'Error de subida',{error:true});
  }catch(e){toast('Error: '+e.message,{error:true});}};
window.wixSave=async function(){
  wixCollect();
  const row=Object.assign({},window._wix.row);
  const i=window._wix.i;
  if(i!==undefined&&i!==''&&ROWS[i])row.id=ROWS[i].id;
  const m=document.getElementById('wixmsg');if(m)m.textContent=T('guardando');
  const res=await call({action:'save',tabla:TAB,row:row});
  if(res.j&&res.j.ok){toast(T('guardado'));document.getElementById('fbox').innerHTML='';render();}
  else if(m)m.textContent=(res.j&&res.j.error&&res.j.error.message)||'Error';};
if(TOKEN)start();
</script></body></html>`;

export default async (req, context) => {
  const url = new URL(req.url);
  if (url.pathname === '/api/admin') return api(req, context);
  return new Response(APP, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'x-robots-tag': 'noindex' } });
};

export const config = { path: ['/admin', '/api/admin'] };
