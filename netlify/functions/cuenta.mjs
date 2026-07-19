// Área ciudadana — GET /cuenta (página) + POST /api/cuenta (acciones).
// Registro/login contra Supabase Auth (clave anon, pública por diseño) desde el navegador;
// las acciones de datos van por esta función con service_role tras verificar el JWT.
// RGPD: export completo y borrado de cuenta (anonimiza propuestas publicadas).
// Env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
import { getUser } from './lib/auth.mjs';
import { supa, supaConfigured, jsonErr, jsonOk } from './lib/supa.mjs';
import { rateLimited, sendEmail, emailShell } from './contacto.mjs';
import { cleanName, SPECIAL_ACCOUNTS, withHonor } from './lib/names.mjs';
import { titulosPayload } from './lib/titulos.mjs';

async function api(req, context) {
  if (!supaConfigured()) return jsonErr(503, 'unconfigured', 'No disponible todavía');
  let b;
  try { b = await req.json(); } catch { return jsonErr(400, 'bad_json', 'Cuerpo inválido'); }

  if (b.action === 'privacy-consent') {          // registro del consentimiento en el alta
    const ip = req.headers.get('cf-connecting-ip') || context.ip || req.headers.get('x-nf-client-connection-ip') || '0.0.0.0';
    if (rateLimited('consent:' + ip, 10)) return jsonErr(429, 'rate_limited', 'Espera un momento');
    const email = String(b.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return jsonErr(400, 'invalid_email', 'Email no válido');
    // dedupe: el login con Google pasa por aquí en cada entrada
    const ya = await supa('GET', `consents?email=eq.${encodeURIComponent(email)}&tipo=eq.privacidad&select=id&limit=1`);
    if (!(ya.json || []).length)
      await supa('POST', 'consents', { email, tipo: 'privacidad', texto_version: 'privacidad-v2026-07', ip });
    return jsonOk();
  }

  if (b.action === 'marketing-consent') {        // opt-in del registro (RGPD: activo, jamás premarcado)
    const ip = req.headers.get('cf-connecting-ip') || context.ip || req.headers.get('x-nf-client-connection-ip') || '0.0.0.0';
    if (rateLimited('consent:' + ip, 10)) return jsonErr(429, 'rate_limited', 'Espera un momento');
    const email = String(b.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return jsonErr(400, 'invalid_email', 'Email no válido');
    const lang = b.lang === 'va' ? 'va' : 'es';
    const ya = await supa('GET', `consents?email=eq.${encodeURIComponent(email)}&tipo=eq.marketing&select=id&limit=1`);
    if (!(ya.json || []).length)
      await supa('POST', 'consents', { email, tipo: 'marketing', texto_version: 'marketing-registro-v2026-07', ip });
    const key = process.env.BREVO_API_KEY;
    if (key) {
      const listId = Number(lang === 'va' ? process.env.BREVO_LIST_ID_VA : process.env.BREVO_LIST_ID_ES) || undefined;
      await fetch('https://api.brevo.com/v3/contacts', {
        method: 'POST',
        headers: { 'api-key': key, 'content-type': 'application/json' },
        body: JSON.stringify({
          email, updateEnabled: true,
          attributes: { LANG: lang, CONSENT_TS: new Date().toISOString(), CONSENT_SOURCE: 'registro-optin' },
          ...(listId ? { listIds: [listId] } : {}),
        }),
      }).catch(() => {});
    }
    return jsonOk();
  }

  const user = await getUser(req);
  if (!user) return jsonErr(401, 'login_required', 'Sesión no válida');
  const special = SPECIAL_ACCOUNTS[String(user.email || '').toLowerCase()];

  if (b.action === 'mis-datos') {
    const [prof, props, votos, coms, dens, ords] = await Promise.all([
      supa('GET', `profiles?id=eq.${user.id}&select=nombre,apellidos,lang,rol,created_at,avatar_url,bloqueado,bloqueo_motivo,apelacion_texto,es_donante,es_afiliado,voluntariado`),
      supa('GET', `proposals?user_id=eq.${user.id}&select=id,titulo,estado,motivo_rechazo,created_at,proposal_vote_counts:proposal_vote_counts(a_favor,en_contra),comments:comments(count)&order=created_at.desc`),
      supa('GET', `votes?user_id=eq.${user.id}&select=proposal_id,valor`),
      supa('GET', `comments?user_id=eq.${user.id}&select=id,texto,estado,created_at,proposals:proposals(id,titulo)&order=created_at.desc&limit=100`),
      supa('GET', `denuncias?user_id=eq.${user.id}&select=codigo,estado,created_at&order=created_at.desc&limit=20`),
      supa('GET', `orders?user_id=eq.${user.id}&select=id,numero,estado,metodo_entrega,total_cents,envio_cents,created_at,order_items:order_items(nombre,talla,cantidad,precio_cents)&order=created_at.desc&limit=50`),
    ]);
    const perfil = prof.json?.[0] || {};
    // Likes recibidos en mis comentarios (si la migración 014 ya está aplicada)
    const misComs = coms.json || [];
    let likesMap = {}, likesOn = false;
    if (misComs.length) {
      const lr = await supa('GET', `comment_likes?comment_id=in.(${misComs.map((c) => c.id).join(',')})&select=comment_id`);
      if (lr.ok) { likesOn = true; for (const row of lr.json || []) likesMap[row.comment_id] = (likesMap[row.comment_id] || 0) + 1; }
    } else {
      likesOn = (await supa('GET', 'comment_likes?select=comment_id&limit=1')).ok;
    }
    const comentarios = misComs.map((c) => ({
      id: c.id, texto: c.texto, estado: c.estado, fecha: String(c.created_at).slice(0, 10),
      propuesta: c.proposals?.titulo || '—', propuestaId: c.proposals?.id || null,
      likes: likesMap[c.id] || 0,
    }));
    if (special) {   // cuenta especial: honorífico + rol impuestos por el sistema (self-heal al entrar)
      const desired = withHonor(special.honor, perfil.nombre || '');
      if (perfil.nombre !== desired || perfil.rol !== special.rol) {
        await supa('POST', 'profiles', { id: user.id, nombre: desired, rol: special.rol },
          { prefer: 'resolution=merge-duplicates,return=minimal' });
        perfil.nombre = desired; perfil.rol = special.rol;
      }
    }
    const propuestas = (props.json || []).map((p) => {
      const vc = Array.isArray(p.proposal_vote_counts) ? p.proposal_vote_counts[0] : p.proposal_vote_counts;
      return {
        id: p.id, titulo: p.titulo, estado: p.estado, motivo_rechazo: p.motivo_rechazo,
        fecha: String(p.created_at).slice(0, 10),
        aFavor: (vc && vc.a_favor) || 0, enContra: (vc && vc.en_contra) || 0,
        comentarios: Array.isArray(p.comments) ? (p.comments[0] ? p.comments[0].count : 0) : 0,
      };
    });
    const stats = {
      propuestas: propuestas.length,
      apoyosRecibidos: propuestas.reduce((s, p) => s + p.aFavor, 0),
      comentariosHechos: comentarios.length,
      likesRecibidos: comentarios.reduce((s, c) => s + c.likes, 0),
      votosEmitidos: (votos.json || []).length,
    };
    const denuncias = (dens.json || []).map((d) => ({ codigo: d.codigo, estado: d.estado, fecha: String(d.created_at).slice(0, 10) }));
    const pedidos = (ords.json || []).map((o) => ({
      id: o.id,
      numero: o.numero || o.id,
      estado: o.estado,
      metodoEntrega: o.metodo_entrega,
      totalCents: o.total_cents || 0,
      envioCents: o.envio_cents || 0,
      fecha: String(o.created_at).slice(0, 10),
      items: (o.order_items || []).map((it) => ({
        nombre: it.nombre, talla: it.talla || null,
        cantidad: it.cantidad || 1, precioCents: it.precio_cents || 0,
      })),
    }));
    // Títulos: donante se refresca en vivo por email (para que un donante reciente lo vea ya);
    // afiliado/voluntariado vienen del flag mantenido por webhook/sync. Máx. 2 insignias.
    // Donante se refresca en vivo por email (barato y exacto). Afiliado viene del flag guardado,
    // que mantienen el webhook (invoice.paid) y la acción admin sync-titulos (Stripe por email).
    const donanteLive = ((await supa('GET', `donations?donor_email=eq.${encodeURIComponent(user.email)}&estado=eq.pagada&select=id&limit=1`)).json || []).length > 0;
    if (donanteLive !== !!perfil.es_donante) {
      await supa('PATCH', `profiles?id=eq.${user.id}`, { es_donante: donanteLive }).catch(() => {});
      perfil.es_donante = donanteLive;
    }
    const titulos = titulosPayload({ nombre: perfil.nombre, voluntariado: perfil.voluntariado, es_afiliado: perfil.es_afiliado, es_donante: donanteLive }, perfil.lang === 'va' ? 'va' : 'es', true);
    return jsonOk({ ok: true, email: user.email, perfil, titulos, propuestas, comentarios, denuncias, pedidos, stats, likesOn, votos: stats.votosEmitidos });
  }
  if (b.action === 'apelar') {                    // usuario bloqueado: manda su alegación al equipo
    const texto = String(b.texto || '').trim().slice(0, 2000);
    if (texto.length < 10) return jsonErr(400, 'short', 'Explica tu apelación con un poco más de detalle');
    const pr = await supa('GET', `profiles?id=eq.${user.id}&select=bloqueado,nombre`);
    if (!(pr.json && pr.json[0] && pr.json[0].bloqueado)) return jsonErr(400, 'not_blocked', 'Tu cuenta no está bloqueada');
    const up = await supa('PATCH', `profiles?id=eq.${user.id}`, { apelacion_texto: texto, apelacion_at: new Date().toISOString() });
    if (!up.ok) return jsonErr(502, 'db_error', 'No se pudo enviar la apelación');
    const safe = (s) => String(s || '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
    sendEmail({
      to: process.env.CONTACT_INBOX || 'accioncivilgandia@gmail.com',
      subject: 'Apelación de un usuario bloqueado — Acción Civil Gandia', replyTo: user.email,
      html: emailShell({ title: 'Apelación de bloqueo', body: `<p><b>${safe(pr.json[0].nombre || user.email)}</b> (${safe(user.email)}) apela su bloqueo:</p><p style="background:#F7FAFD;border-left:3px solid #1563C4;padding:10px 14px;border-radius:6px">${safe(texto).replace(/\n/g, '<br>')}</p><p>Puedes revisarlo en el panel → Comunidad → Miembros bloqueados, y desbloquear si procede.</p>` }),
    }).catch(() => {});
    return jsonOk({ ok: true });
  }
  if (b.action === 'avatar') {                   // subida propia (dataURL webp/jpeg ≤ 300 KB)
    const m = String(b.dataUrl || '').match(/^data:image\/(webp|jpeg|png);base64,([A-Za-z0-9+/=]+)$/);
    if (!m) return jsonErr(400, 'bad_image', 'Imagen no válida');
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 300 * 1024) return jsonErr(400, 'too_big', 'La imagen es demasiado grande');
    const path = `avatares/${user.id}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
    const up = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/media/${path}`, {
      method: 'POST',
      headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': `image/${m[1]}`, 'x-upsert': 'true' },
      body: buf,
    });
    if (!up.ok) return jsonErr(502, 'upload_failed', 'No se pudo subir la foto');
    const avatarUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/media/${path}?v=${Date.now()}`;
    await supa('POST', 'profiles', { id: user.id, avatar_url: avatarUrl }, { prefer: 'resolution=merge-duplicates,return=minimal' });
    return jsonOk({ ok: true, avatar: avatarUrl });
  }
  if (b.action === 'avatar-google') {            // captura el avatar de Google y lo guarda en NUESTRO storage
    const gu = String(b.url || '');
    if (!/^https:\/\/lh[0-9a-z.-]*\.googleusercontent\.com\//.test(gu)) return jsonErr(400, 'bad_url', 'URL no válida');
    const prof2 = await supa('GET', `profiles?id=eq.${user.id}&select=avatar_url`);
    const cur = prof2.json?.[0]?.avatar_url || '';
    // Si ya tiene una foto propia guardada en nuestro storage, no tocar. (Si es una URL de Google vieja, la migramos.)
    if (cur && cur.indexOf('googleusercontent.com') === -1) return jsonOk({ ok: true, avatar: cur });
    // Descargamos la imagen en el servidor (sin problema de referrer) y la subimos a media/avatares.
    try {
      const ab = await fetch(gu.replace(/=s\d+-c$/, '=s256-c')).then((x) => (x.ok ? x.arrayBuffer() : null)).catch(() => null);
      if (ab) {
        const buf = Buffer.from(ab);
        if (buf.length && buf.length <= 800 * 1024) {
          const path = `avatares/${user.id}-g.jpg`;
          const up = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/media/${path}`, {
            method: 'POST',
            headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'image/jpeg', 'x-upsert': 'true' },
            body: buf,
          });
          if (up.ok) {
            const avatarUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/media/${path}?v=${Date.now()}`;
            await supa('POST', 'profiles', { id: user.id, avatar_url: avatarUrl }, { prefer: 'resolution=merge-duplicates,return=minimal' });
            return jsonOk({ ok: true, avatar: avatarUrl });
          }
        }
      }
    } catch {}
    // Fallback: guardar la URL de Google (se mostrará con referrerpolicy no-referrer).
    await supa('POST', 'profiles', { id: user.id, avatar_url: gu }, { prefer: 'resolution=merge-duplicates,return=minimal' });
    return jsonOk({ ok: true, avatar: gu });
  }
  if (b.action === 'avatar-quitar') {            // ir sin foto: marca 'none' para que no se re-aplique la de Google
    for (const p of [`avatares/${user.id}.jpg`, `avatares/${user.id}.webp`, `avatares/${user.id}.png`, `avatares/${user.id}-g.jpg`]) {
      fetch(`${process.env.SUPABASE_URL}/storage/v1/object/media/${p}`, { method: 'DELETE', headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` } }).catch(() => {});
    }
    await supa('POST', 'profiles', { id: user.id, avatar_url: 'none' }, { prefer: 'resolution=merge-duplicates,return=minimal' });
    return jsonOk({ ok: true, avatar: '' });
  }
  if (b.action === 'perfil') {
    if (special) {   // no puede quitarse el honorífico; se recompone siempre
      const c = cleanName(b.nombre);
      const nombre = withHonor(special.honor, c.ok ? c.nombre : 'Acción Civil');
      const r = await supa('PATCH', `profiles?id=eq.${user.id}`, { nombre, rol: special.rol });
      return r.ok ? jsonOk({ ok: true, nombre }) : jsonErr(502, 'db_error', 'No se pudo guardar');
    }
    const c = cleanName(b.nombre);
    if (!c.ok) return jsonErr(400, 'nombre_invalido',
      c.reason === 'lenguaje' ? 'Ese nombre contiene lenguaje no permitido.'
        : c.reason === 'cargo' ? 'No puedes usar cargos ni títulos en el nombre público.'
          : 'El nombre es demasiado corto (mínimo 2 letras).');
    const r = await supa('PATCH', `profiles?id=eq.${user.id}`, { nombre: c.nombre });
    return r.ok ? jsonOk({ ok: true, nombre: c.nombre }) : jsonErr(502, 'db_error', 'No se pudo guardar');
  }
  if (b.action === 'export') {                    // RGPD: derecho de acceso/portabilidad
    const [prof, props, votos, coms, cons] = await Promise.all([
      supa('GET', `profiles?id=eq.${user.id}&select=*`),
      supa('GET', `proposals?user_id=eq.${user.id}&select=*`),
      supa('GET', `votes?user_id=eq.${user.id}&select=*`),
      supa('GET', `comments?user_id=eq.${user.id}&select=*`),
      supa('GET', `consents?email=eq.${encodeURIComponent(user.email)}&select=tipo,texto_version,created_at`),
    ]);
    return jsonOk({
      ok: true, exportadoEl: new Date().toISOString(),
      cuenta: { id: user.id, email: user.email, creada: user.created_at },
      perfil: prof.json?.[0] || null, propuestas: props.json || [],
      votos: votos.json || [], comentarios: coms.json || [], consentimientos: cons.json || [],
    });
  }
  if (b.action === 'borrar') {                    // RGPD: derecho de supresión
    // anonimizar propuestas (el debate publicado se conserva sin autor), borrar el resto en cascada
    await supa('PATCH', `proposals?user_id=eq.${user.id}`, { user_id: null, contacto_nombre: null, contacto_email: null });
    const r = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users/${user.id}`, {
      method: 'DELETE',
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });
    if (!r.ok) { console.error('delete user fail', r.status, await r.text()); return jsonErr(502, 'db_error', 'No se pudo eliminar la cuenta'); }
    await supa('POST', 'audit_log', { accion: 'borrado_rgpd', tabla: 'auth.users', registro_id: user.id, detalle: {} }).catch(() => {});
    return jsonOk({ ok: true, eliminada: true });
  }
  return jsonErr(400, 'bad_action', 'Acción desconocida');
}

const PAGE = (SUPA, ANON) => `<!doctype html><html lang="es"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Área ciudadana — Acción Civil Gandia</title>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@800&family=Public+Sans:wght@400;600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box}body{margin:0;font-family:Public Sans,sans-serif;background:#F4F7FB;color:#17232F;line-height:1.6}
.card{background:#fff;border:1px solid #E9EEF4;border-radius:22px;padding:36px 42px;max-width:940px;margin:34px auto;box-shadow:0 10px 30px rgba(10,42,94,.06)}
@media(max-width:720px){.card{padding:24px 18px;margin:16px 10px}}
.lista{max-height:330px;overflow-y:auto;padding-right:6px}
.lista::-webkit-scrollbar{width:8px}.lista::-webkit-scrollbar-thumb{background:#D7E0EA;border-radius:99px}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:0 36px}
@media(max-width:820px){.cols{grid-template-columns:1fr}}
.avwrap{display:flex;align-items:center;gap:18px;margin:4px 0 6px}
.av{width:76px;height:76px;border-radius:50%;object-fit:cover;background:#EAF3FC;color:#1563C4;display:flex;align-items:center;justify-content:center;font:800 26px Bricolage Grotesque;flex-shrink:0;border:2px solid #E4EBF2}
.linkbtn{background:none;border:none;color:#1563C4;font:700 13px Public Sans;cursor:pointer;padding:0}
.del{background:none;border:none;color:#C0392B;font:700 12px Public Sans;cursor:pointer;padding:0;margin-left:10px}
h1{font-family:Bricolage Grotesque;font-size:26px;color:#0A2A5E;margin:0 0 6px}
h3{font-family:Bricolage Grotesque;font-size:17px;color:#0A2A5E;margin:22px 0 8px}
.muted{color:#5C6B7A;font-size:13.5px}
label{display:block;font:600 12.5px Public Sans;color:#42525F;margin:13px 0 5px}
input{width:100%;border:1.5px solid #E4EBF2;border-radius:10px;padding:11px 13px;font:400 14.5px Public Sans;outline:none}
.btn{border:none;cursor:pointer;background:#1563C4;color:#fff;font:700 14.5px Public Sans;padding:12px 22px;border-radius:11px;margin-top:16px}
.btn.gold{background:#F6BE18;color:#0A2A5E}.btn.danger{background:#fff;color:#C0392B;border:1.5px solid #F0D5D0}
.tabs{display:flex;background:#F0F4F9;border-radius:11px;padding:4px;margin-bottom:6px}
.tabs button{flex:1;border:none;background:none;cursor:pointer;font:700 13.5px Public Sans;color:#5C6B7A;padding:9px;border-radius:8px}
.tabs button.on{background:#fff;color:#0A2A5E;box-shadow:0 2px 8px rgba(10,42,94,.08)}
.msg{margin-top:12px;font-weight:600;font-size:14px}.ok{color:#1E7A45}.err{color:#C0392B}
.prop{border:1px solid #EEF2F7;border-radius:12px;padding:12px 14px;margin-top:10px;font-size:14px}
.pill{display:inline-block;font:700 11px Public Sans;padding:2px 10px;border-radius:999px;background:#EEF2F7;color:#5C6B7A}
a{color:#1563C4}
</style></head><body>
<div class="card" id="box"><p class="muted">Cargando…</p></div>
<p style="text-align:center;margin:0 0 40px"><a href="/" style="font-size:14px">← Volver a la web</a></p>
<script>
const SUPA='${SUPA}', ANON='${ANON}';
const $=q=>document.querySelector(q);
function askConfirm(msg,yes){
  return new Promise(function(res){
    var o=document.createElement('div');
    o.style.cssText='position:fixed;inset:0;z-index:9800;background:rgba(7,30,69,.5);display:flex;align-items:center;justify-content:center;padding:22px';
    o.innerHTML='<div style="background:#fff;border-radius:18px;max-width:400px;width:100%;padding:26px;box-shadow:0 30px 80px rgba(10,42,94,.3)"><p style="font:600 15px Public Sans;color:#17232F;margin:0 0 20px;line-height:1.55"></p><div style="display:flex;gap:10px"><button class="btn" id="_no" style="flex:1;background:#EEF2F7;color:#42525F">Cancelar</button><button class="btn danger" id="_yes" style="flex:1">'+(yes||'Confirmar')+'</button></div></div>';
    o.querySelector('p').textContent=msg;
    document.body.appendChild(o);
    var d=function(v){o.remove();res(v);};
    o.querySelector('#_no').onclick=function(){d(false);};
    o.querySelector('#_yes').onclick=function(){d(true);};
    o.addEventListener('click',function(e){if(e.target===o)d(false);});
  });
}
const S={get t(){return localStorage.getItem('acg_session')||''},set t(v){v?localStorage.setItem('acg_session',v):localStorage.removeItem('acg_session')},
         get r(){return localStorage.getItem('acg_refresh')||''},set r(v){v?localStorage.setItem('acg_refresh',v):localStorage.removeItem('acg_refresh')}};
async function auth(path,body){
  const r=await fetch(SUPA+'/auth/v1/'+path,{method:'POST',headers:{apikey:ANON,'content-type':'application/json'},body:JSON.stringify(body)});
  return {s:r.status,j:await r.json().catch(()=>({}))};
}
async function api(body){
  let r=await fetch('/api/cuenta',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+S.t},body:JSON.stringify(body)});
  if(r.status===401&&S.r){ // intenta refrescar la sesión una vez
    const rf=await auth('token?grant_type=refresh_token',{refresh_token:S.r});
    if(rf.j.access_token){S.t=rf.j.access_token;S.r=rf.j.refresh_token;
      r=await fetch('/api/cuenta',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+S.t},body:JSON.stringify(body)});}
  }
  return {s:r.status,j:await r.json().catch(()=>({}))};
}
function loginView(tab){
  tab=tab||'entrar';
  $('#box').innerHTML='<h1>Área ciudadana</h1><p class="muted">Tu cuenta para proponer, votar y seguir tus propuestas.</p>'+
  '<div class="tabs"><button id="t1" class="'+(tab==='entrar'?'on':'')+'">Entrar</button><button id="t2" class="'+(tab==='registro'?'on':'')+'">Crear cuenta</button></div>'+
  (tab==='entrar'
    ?'<label>Email</label><input id="em" type="email"><label>Contraseña</label><input id="pw" type="password"><button class="btn" style="width:100%" onclick="doLogin()">Entrar</button><p class="muted" style="margin-top:10px"><a href="#" onclick="doReset();return false">He olvidado mi contraseña</a></p>'
    :'<label>Nombre (como quieres aparecer)</label><input id="nm"><label>Email</label><input id="em" type="email"><label>Contraseña (mínimo 10 caracteres)</label><input id="pw" type="password"><label style="display:flex;gap:9px;align-items:flex-start;font-weight:400;font-size:13px;color:#5C6B7A;margin-top:14px"><input id="priv" type="checkbox" style="width:18px;height:18px;flex-shrink:0;margin-top:2px">Acepto la <a href="/privacidad" target="_blank">política de privacidad</a>. Mis datos se usan solo para gestionar mi participación.</label><label style="display:flex;gap:9px;align-items:flex-start;font-weight:400;font-size:12px;color:#8A97A5;margin-top:8px"><input id="mkt" type="checkbox" style="width:16px;height:16px;flex-shrink:0;margin-top:1px">Quiero recibir novedades y comunicaciones de Acción Civil por email (opcional, baja en un clic).</label><button class="btn gold" style="width:100%" onclick="doSignup()">Crear cuenta</button>')+
  '<div style="display:flex;align-items:center;gap:10px;margin:18px 0 0;color:#8A97A5;font-size:12px"><span style="flex:1;height:1px;background:#E4EBF2"></span>o<span style="flex:1;height:1px;background:#E4EBF2"></span></div>'+
  '<button class="btn" style="width:100%;background:#fff;color:#17232F;border:1.5px solid #E4EBF2;display:flex;align-items:center;justify-content:center;gap:9px" onclick="doGoogle()"><svg width="17" height="17" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.8 6.1C12.3 13.1 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z"/><path fill="#FBBC05" d="M10.4 28.7c-.5-1.5-.8-3-.8-4.7s.3-3.2.8-4.7l-7.8-6.1C.9 16.5 0 20.1 0 24s.9 7.5 2.6 10.8l7.8-6.1z"/><path fill="#34A853" d="M24 48c6.2 0 11.4-2 15.2-5.5l-7.5-5.8c-2.1 1.4-4.7 2.2-7.7 2.2-6.3 0-11.7-3.6-13.6-8.9l-7.8 6.1C6.5 42.6 14.6 48 24 48z"/></svg>Continuar con Google</button>'+
  '<p class="muted" style="font-size:11.5px;margin:8px 0 0;text-align:center">Al continuar con Google aceptas la <a href="/privacidad" target="_blank">política de privacidad</a>.</p>'+
  '<div id="m" class="msg"></div>';
  $('#t1').onclick=()=>loginView('entrar');$('#t2').onclick=()=>loginView('registro');
}
async function doLogin(){
  const r=await auth('token?grant_type=password',{email:$('#em').value.trim(),password:$('#pw').value});
  if(r.j.access_token){S.t=r.j.access_token;S.r=r.j.refresh_token;volver();}
  else $('#m').innerHTML='<span class="err">'+(r.j.error_description||r.j.msg||'Email o contraseña incorrectos, o cuenta sin confirmar.')+'</span>';
}
async function doSignup(){
  if(!$('#priv').checked)return $('#m').innerHTML='<span class="err">Debes aceptar la política de privacidad.</span>';
  if(($('#pw').value||'').length<10)return $('#m').innerHTML='<span class="err">La contraseña debe tener al menos 10 caracteres.</span>';
  const em=$('#em').value.trim();
  const r=await auth('signup',{email:em,password:$('#pw').value,data:{nombre:$('#nm').value.trim()}});
  if(r.s===200&&(r.j.id||r.j.user)){
    fetch('/api/cuenta',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'privacy-consent',email:em})});
    if($('#mkt')&&$('#mkt').checked)fetch('/api/cuenta',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'marketing-consent',email:em,lang:localStorage.getItem('acg_lang')||'es'})});
    $('#m').innerHTML='<span class="ok">Cuenta creada. Revisa tu correo y pulsa el enlace de confirmación; después vuelve aquí y entra.</span>';
  } else $('#m').innerHTML='<span class="err">'+(r.j.error_description||r.j.msg||'No se pudo crear la cuenta.')+'</span>';
}
async function doReset(){
  const em=$('#em').value.trim();
  if(!em)return $('#m').innerHTML='<span class="err">Escribe tu email arriba y vuelve a pulsar.</span>';
  await auth('recover',{email:em});
  $('#m').innerHTML='<span class="ok">Si la cuenta existe, te hemos enviado un correo para restablecerla.</span>';
}
const ESTADO_PILL={
  pendiente:['#FBF0DC','#9A6208','Pendiente de moderación'],
  publicado:['#E7F4EC','#1E7A45','Publicado ✓'],
  rechazado:['#FBECEC','#C0392B','No publicado'],
  publicada:['#E7F4EC','#1E7A45','Publicada ✓'],
  aprobada:['#E7F4EC','#1E7A45','Aceptada ✓'],
  en_estudio:['#EAF3FC','#1563C4','En estudio técnico'],
  rechazada:['#FBECEC','#C0392B','No publicada'],
  recibida:['#FBF0DC','#9A6208','Pendiente de revisión']
};
function pill(estado){
  const e=ESTADO_PILL[estado]||['#EEF2F7','#5C6B7A',String(estado||'').replace(/_/g,' ')];
  return '<span class="pill" style="background:'+e[0]+';color:'+e[1]+'">'+e[2]+'</span>';
}
function esc(x){return String(x==null?'':x).replace(/</g,'&lt;');}
async function doApelar(btn){
  const ta=document.getElementById('apeltxt'), m=document.getElementById('m'); if(!ta)return;
  const t=ta.value.trim();
  if(t.length<10){ if(m)m.innerHTML='<span class="err">Explica un poco más por qué apelas (mínimo 10 caracteres).</span>'; return; }
  if(btn)btn.disabled=true;
  const r=await api({action:'apelar',texto:t});
  if(r.j&&r.j.ok){ home(); }
  else { if(btn)btn.disabled=false; if(m)m.innerHTML='<span class="err">'+((r.j&&r.j.error&&r.j.error.message)||'No se pudo enviar la apelación.')+'</span>'; }
}
async function doQuitarFoto(){
  if(!await askConfirm('¿Quitar tu foto y usar tus iniciales?','Quitar'))return;
  const r=await api({action:'avatar-quitar'});
  if(r.j&&r.j.ok)home();else{$('#m').innerHTML='<span class="err">'+((r.j&&r.j.error&&r.j.error.message)||'No se pudo quitar la foto.')+'</span>';}
}
async function home(){
  const r=await api({action:'mis-datos'});
  if(!r.j.ok){S.t='';S.r='';return loginView();}
  const d=r.j, st=d.stats||{};
  window._MD=d;
  const bloqueado=!!d.perfil.bloqueado, motivoBloqueo=esc(d.perfil.bloqueo_motivo||''), yaApelo=!!d.perfil.apelacion_texto;
  const banner=bloqueado?'<div style="border:3px solid #C0392B;background:#FBECEC;border-radius:14px;padding:22px 18px;margin-bottom:20px;text-align:center;overflow:hidden">'
    +'<div style="font:900 44px Fraunces;letter-spacing:.12em;color:#C0392B;transform:rotate(-3deg);text-shadow:2px 2px 0 rgba(192,57,43,.15)">BLOQUEADO</div>'
    +'<p style="font:700 14px Public Sans;color:#7A2620;margin:10px 0 0">Tu cuenta está bloqueada hasta nuevo aviso. No puedes publicar en el chat, comentar ni crear propuestas.</p>'
    +(motivoBloqueo?'<p style="font:500 13.5px Public Sans;color:#7A2620;margin:6px 0 0"><b>Motivo:</b> '+motivoBloqueo+'</p>':'')
    +(yaApelo?'<p style="font:700 13.5px Public Sans;color:#1E7A45;margin:14px 0 0">✔ Tu apelación se ha enviado. El equipo la revisará.</p>'
      :'<div style="margin-top:14px"><textarea id="apeltxt" rows="3" placeholder="Explica por qué crees que es un error y quieres apelar…" style="width:100%;max-width:460px"></textarea><br><button class="btn danger" style="margin-top:8px" onclick="doApelar(this)">Apelar el bloqueo</button></div>')
    +'</div>':'';
  const statCard=(n,l,c)=>'<div style="flex:1;min-width:110px;background:#F7FAFD;border:1px solid #E9EEF4;border-radius:14px;padding:14px 10px;text-align:center"><div style="font:800 24px Bricolage Grotesque;color:'+c+'">'+n+'</div><div style="font:600 11.5px Public Sans;color:#5C6B7A;margin-top:2px">'+l+'</div></div>';
  const ini=esc((d.perfil.nombre||d.email)).split(/\\s+/).map(w=>w[0]||'').join('').slice(0,2).toUpperCase();
  const hasAv=d.perfil.avatar_url&&d.perfil.avatar_url!=='none';
  const avatar=hasAv?'<img class="av" src="'+esc(d.perfil.avatar_url)+'" alt="Tu foto" referrerpolicy="no-referrer">':'<div class="av">'+ini+'</div>';
  const _tit=Array.isArray(d.titulos)?d.titulos:[];
  const titHtml=_tit.length?'<div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0 2px">'+_tit.map(function(t){return '<span title="'+esc(t.label)+'" style="display:inline-flex;align-items:center;gap:6px;background:'+(t.bg||'#EEF2F7')+';color:'+(t.color||'#42525F')+';font:700 12.5px Public Sans;padding:5px 13px;border-radius:999px">'+(t.emoji?t.emoji+' ':'')+esc(t.label)+'</span>';}).join('')+'</div>':'';
  $('#box').innerHTML=banner+'<div style="position:relative">'+'<div class="avwrap">'+avatar+'<div><h1 style="margin:0">Hola, '+esc(d.perfil.nombre||d.email)+'</h1><p class="muted" style="margin:2px 0 6px">'+esc(d.email)+' · miembro desde '+String(d.perfil.created_at||'').slice(0,10)+'</p>'
  +'<button class="linkbtn" onclick="document.getElementById(\\'avfile\\').click()">Cambiar foto</button>'+(hasAv?' · <button class="linkbtn" onclick="doQuitarFoto()" style="color:#C0392B">Quitar foto</button>':'')+' <input id="avfile" type="file" accept="image/*" style="display:none"></div></div>'
  +titHtml
  +'<div style="display:flex;gap:10px;flex-wrap:wrap;margin:16px 0 4px">'
    +statCard(st.propuestas||0,'Propuestas','#0A2A5E')
    +statCard(st.apoyosRecibidos||0,'Apoyos recibidos','#1E7A45')
    +statCard(st.comentariosHechos||0,'Comentarios','#1563C4')
    +statCard(st.likesRecibidos||0,'Likes recibidos','#D24B4B')
  +'</div>'
  +'<p class="muted" style="margin:8px 0 0">Has votado en <b>'+(d.votos||0)+'</b> propuesta(s) de otros vecinos.</p>'
  +'<div class="cols"><div>'
  +'<h3>Mis propuestas ('+d.propuestas.length+')</h3>'
  +(d.propuestas.length?'<div class="lista">'+d.propuestas.map(p=>'<div class="prop">'+
      (['publicada','aprobada','en_estudio'].includes(p.estado)?'<a href="/propuesta-ciudadana?id='+p.id+'" style="font-weight:700;text-decoration:none">'+esc(p.titulo)+'</a>':'<b>'+esc(p.titulo)+'</b>')+
      '<div style="margin-top:6px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">'+pill(p.estado)+
      '<span class="muted" style="font-size:12.5px">👍 '+(p.aFavor||0)+' · 👎 '+(p.enContra||0)+' · 💬 '+(p.comentarios||0)+' · '+esc(p.fecha)+'</span></div>'+
      (p.motivo_rechazo?'<div class="muted" style="margin-top:5px;font-size:12.5px">Motivo: '+esc(p.motivo_rechazo)+'</div>':'')+
    '</div>').join('')+'</div>':'<p class="muted">Aún no has enviado ninguna. <a href="/crear-propuesta">Crea la primera</a>.</p>')
  +'</div><div>'
  +'<h3>Mis comentarios ('+(d.comentarios||[]).length+')</h3>'
  +((d.comentarios||[]).length?'<div class="lista">'+d.comentarios.map(c=>'<div class="prop">'+
      '<span class="muted" style="font-size:12px">En '+(c.propuestaId?'<a href="/propuesta-ciudadana?id='+c.propuestaId+'">'+esc(c.propuesta)+'</a>':esc(c.propuesta))+' · '+esc(c.fecha)+'</span>'+
      '<div style="margin:5px 0 7px">'+esc(c.texto.length>140?c.texto.slice(0,140)+'…':c.texto)+'</div>'+
      '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">'+pill(c.estado)+
      (d.likesOn?'<span class="muted" style="font-size:12.5px">❤ '+(c.likes||0)+' me gusta</span>':'')+
      '<button class="del" data-delc="'+c.id+'">Borrar</button></div>'+
    '</div>').join('')+'</div>':'<p class="muted">Todavía no has comentado. Participa en el <a href="/participacion">debate ciudadano</a>.</p>')
  +'</div></div>'
  +((d.denuncias||[]).length?'<h3>Mis denuncias confidenciales ('+d.denuncias.length+')</h3><div class="lista" style="max-height:180px">'+d.denuncias.map(x=>'<div class="prop" style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap"><span style="font:700 14px monospace;color:#0A2A5E">'+esc(x.codigo)+'</span>'+pill(x.estado==='nueva'?'recibida':x.estado)+'<span class="muted" style="font-size:12px">'+esc(x.fecha)+'</span><a href="/denuncias?ver='+esc(x.codigo)+'" style="font:700 13px Public Sans">Ver conversación →</a></div>').join('')+'</div>':'')
  +'<div class="cols" style="margin-top:8px"><div>'
  +'<h3>Tu cuenta</h3><label>Nombre público (apodo)</label><input id="nm" value="'+String(d.perfil.nombre||'').replace(/"/g,'&quot;')+'"><button class="btn" onclick="savePerfil()">Guardar</button>'
  +'</div><div>'
  +'<h3>Tus derechos (RGPD)</h3><div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn" style="background:#EEF2F7;color:#42525F" onclick="doExportPrint()">Copia legible (PDF)</button><button class="btn danger" onclick="doDelete()">Darme de baja</button></div>'
  +'</div></div>'
  +'<button class="btn" style="background:#0A2A5E;width:100%;margin-top:22px" onclick="S.t=\\'\\';S.r=\\'\\';loginView()">Cerrar sesión</button><div id="m" class="msg"></div>'+(bloqueado?'<div style="position:absolute;inset:0;background:repeating-linear-gradient(-45deg,transparent 0,transparent 20px,rgba(192,57,43,.13) 20px,rgba(192,57,43,.13) 22px);pointer-events:none;border-radius:8px"></div>':'')+'</div>';
  const av=document.getElementById('avfile');
  if(av)av.addEventListener('change',function(){
    const file=this.files&&this.files[0]; if(!file)return;
    const img=new Image();
    img.onload=async function(){
      const c=document.createElement('canvas');const S2=256;c.width=S2;c.height=S2;
      const mLado=Math.min(img.width,img.height);
      c.getContext('2d').drawImage(img,(img.width-mLado)/2,(img.height-mLado)/2,mLado,mLado,0,0,S2,S2);
      URL.revokeObjectURL(img.src);
      const du=c.toDataURL('image/webp',0.85);
      const r2=await api({action:'avatar',dataUrl:du});
      if(r2.j&&r2.j.ok)home();else{$('#m').innerHTML='<span class="err">'+((r2.j&&r2.j.error&&r2.j.error.message)||'No se pudo subir la foto.')+'</span>';}
    };
    img.src=URL.createObjectURL(file);
  });
  document.querySelectorAll('[data-delc]').forEach(b2=>b2.addEventListener('click',async function(){
    if(!await askConfirm('¿Borrar este comentario? No se puede deshacer.','Sí, borrar'))return;
    const r2=await fetch('/api/comentarios',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+S.t},body:JSON.stringify({action:'borrar',commentId:this.dataset.delc})});
    const j2=await r2.json().catch(()=>({}));
    if(j2.ok)home();else{$('#m').innerHTML='<span class="err">No se pudo borrar.</span>';}
  }));
}
function doExportPrint(){
  api({action:'export'}).then(r=>{
    if(!r.j.ok)return;
    const d=r.j;
    const seccion=(t,inner)=>'<h2 style="font:800 17px sans-serif;color:#0A2A5E;border-bottom:2px solid #E4EBF2;padding-bottom:5px;margin:26px 0 10px">'+t+'</h2>'+inner;
    const fila=(k,v)=>'<tr><td style="padding:5px 14px 5px 0;color:#5C6B7A;white-space:nowrap;vertical-align:top">'+k+'</td><td style="padding:5px 0;color:#17232F">'+String(v==null?'—':v).replace(/</g,'&lt;')+'</td></tr>';
    const w=window.open('','_blank');
    w.document.write('<html><head><title>Mis datos — Acción Civil Gandia</title></head><body style="font-family:sans-serif;max-width:720px;margin:30px auto;line-height:1.6;color:#17232F">'
      +'<div style="background:#0A2A5E;color:#fff;padding:16px 22px;border-radius:12px"><b style="font-size:17px">Acción Civil Gandia</b><br><span style="font-size:13px;opacity:.8">Copia de tus datos personales (RGPD art. 15) · '+new Date().toLocaleDateString('es-ES')+'</span></div>'
      +seccion('Tu cuenta','<table>'+fila('Email',d.cuenta.email)+fila('Creada',String(d.cuenta.creada).slice(0,10))+fila('Nombre público',d.perfil&&d.perfil.nombre)+'</table>')
      +seccion('Propuestas enviadas ('+d.propuestas.length+')',d.propuestas.length?d.propuestas.map(p=>'<p style="margin:6px 0"><b>'+String(p.titulo).replace(/</g,'&lt;')+'</b><br><span style="color:#5C6B7A;font-size:13px">'+p.estado+' · '+String(p.created_at).slice(0,10)+'</span></p>').join(''):'<p style="color:#5C6B7A">Ninguna</p>')
      +seccion('Comentarios ('+d.comentarios.length+')',d.comentarios.length?d.comentarios.map(c=>'<p style="margin:6px 0">'+String(c.texto).replace(/</g,'&lt;')+'<br><span style="color:#5C6B7A;font-size:13px">'+c.estado+' · '+String(c.created_at).slice(0,10)+'</span></p>').join(''):'<p style="color:#5C6B7A">Ninguno</p>')
      +seccion('Votos emitidos','<p>'+d.votos.length+' voto(s)</p>')
      +seccion('Consentimientos','<table>'+d.consentimientos.map(x=>fila(x.tipo,x.texto_version+' · '+String(x.created_at).slice(0,10))).join('')+'</table>')
      +'<p style="color:#8A99A8;font-size:12px;margin-top:30px">Documento generado desde tu área ciudadana de Acción Civil Gandia (RGPD art. 15).</p>'
      +'<script>window.print()</'+'script></body></html>');
    w.document.close();
  });
}
async function savePerfil(){const r=await api({action:'perfil',nombre:$('#nm').value});if(r.j.ok){if(r.j.nombre)$('#nm').value=r.j.nombre;$('#m').innerHTML='<span class="ok">Guardado ✓</span>';}else $('#m').innerHTML='<span class="err">'+((r.j.error&&r.j.error.message)||'Error')+'</span>';}
async function doExport(){
  const r=await api({action:'export'});
  if(!r.j.ok)return;
  const blob=new Blob([JSON.stringify(r.j,null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='mis-datos-acciongandia.json';a.click();
}
async function doDelete(){
  if(!await askConfirm('Se eliminará tu cuenta, tus votos y comentarios. Tus propuestas ya publicadas se conservarán como anónimas.','Sí, eliminar mi cuenta'))return;
  const r=await api({action:'borrar'});
  if(r.j.ok){S.t='';S.r='';$('#box').innerHTML='<h1>Cuenta eliminada</h1><p class="muted">Tus datos personales han sido borrados. Gracias por haber participado.</p>';}
  else $('#m').innerHTML='<span class="err">No se pudo eliminar. Escríbenos a accioncivilgandia@gmail.com</span>';
}
function doGoogle(){
  location.href=SUPA+'/auth/v1/authorize?provider=google&redirect_to='+encodeURIComponent(location.origin+'/cuenta');
}
// Callback OAuth (flujo implícito de Supabase): tokens en el hash
(function(){
  if(location.hash.indexOf('access_token')>-1){
    const h=new URLSearchParams(location.hash.slice(1));
    if(h.get('access_token')){
      S.t=h.get('access_token');S.r=h.get('refresh_token')||'';
      try{const pl=JSON.parse(atob(S.t.split('.')[1]));
        if(pl.email)fetch('/api/cuenta',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'privacy-consent',email:pl.email})});
        const gpic=(pl.user_metadata&&(pl.user_metadata.avatar_url||pl.user_metadata.picture))||'';
        if(gpic)fetch('/api/cuenta',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+S.t},body:JSON.stringify({action:'avatar-google',url:gpic})});}catch(e){}
    }
    history.replaceState(null,'',location.pathname);
  }
})();
function volver(){var _r;try{_r=localStorage.getItem('acg_return');}catch(e){}if(_r){try{localStorage.removeItem('acg_return');}catch(e){}location.replace(_r);return;}home();}
S.t?volver():loginView();
</script></body></html>`;

export default async (req, context) => {
  const url = new URL(req.url);
  if (url.pathname === '/api/cuenta') return api(req, context);
  return new Response(PAGE(process.env.SUPABASE_URL || '', process.env.SUPABASE_ANON_KEY || ''), {
    status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'x-robots-tag': 'noindex' },
  });
};

export const config = { path: ['/cuenta', '/api/cuenta'] };
