// Área ciudadana — GET /cuenta (página) + POST /api/cuenta (acciones).
// Registro/login contra Supabase Auth (clave anon, pública por diseño) desde el navegador;
// las acciones de datos van por esta función con service_role tras verificar el JWT.
// RGPD: export completo y borrado de cuenta (anonimiza propuestas publicadas).
// Env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
import { getUser } from './lib/auth.mjs';
import { supa, supaConfigured, jsonErr, jsonOk } from './lib/supa.mjs';
import { rateLimited } from './contacto.mjs';

async function api(req, context) {
  if (!supaConfigured()) return jsonErr(503, 'unconfigured', 'No disponible todavía');
  let b;
  try { b = await req.json(); } catch { return jsonErr(400, 'bad_json', 'Cuerpo inválido'); }

  if (b.action === 'privacy-consent') {          // registro del consentimiento en el alta
    const ip = context.ip || '0.0.0.0';
    if (rateLimited('consent:' + ip, 10)) return jsonErr(429, 'rate_limited', 'Espera un momento');
    const email = String(b.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return jsonErr(400, 'invalid_email', 'Email no válido');
    await supa('POST', 'consents', { email, tipo: 'privacidad', texto_version: 'privacidad-v2026-07', ip });
    return jsonOk();
  }

  const user = await getUser(req);
  if (!user) return jsonErr(401, 'login_required', 'Sesión no válida');

  if (b.action === 'mis-datos') {
    const [prof, props, votos] = await Promise.all([
      supa('GET', `profiles?id=eq.${user.id}&select=nombre,apellidos,lang,rol,created_at`),
      supa('GET', `proposals?user_id=eq.${user.id}&select=id,titulo,estado,motivo_rechazo,created_at&order=created_at.desc`),
      supa('GET', `votes?user_id=eq.${user.id}&select=proposal_id,valor`),
    ]);
    return jsonOk({
      ok: true, email: user.email,
      perfil: prof.json?.[0] || {},
      propuestas: props.json || [],
      votos: (votos.json || []).length,
    });
  }
  if (b.action === 'perfil') {
    const nombre = String(b.nombre || '').trim().slice(0, 80);
    const r = await supa('PATCH', `profiles?id=eq.${user.id}`, { nombre });
    return r.ok ? jsonOk() : jsonErr(502, 'db_error', 'No se pudo guardar');
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
.card{background:#fff;border:1px solid #E9EEF4;border-radius:20px;padding:32px;max-width:520px;margin:34px auto;box-shadow:0 10px 30px rgba(10,42,94,.06)}
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
    :'<label>Nombre (como quieres aparecer)</label><input id="nm"><label>Email</label><input id="em" type="email"><label>Contraseña (mínimo 10 caracteres)</label><input id="pw" type="password"><label style="display:flex;gap:9px;align-items:flex-start;font-weight:400;font-size:13px;color:#5C6B7A;margin-top:14px"><input id="priv" type="checkbox" style="width:18px;height:18px;flex-shrink:0;margin-top:2px">Acepto la <a href="/privacidad" target="_blank">política de privacidad</a>. Mis datos se usan solo para gestionar mi participación.</label><button class="btn gold" style="width:100%" onclick="doSignup()">Crear cuenta</button>')+
  '<div id="m" class="msg"></div>';
  $('#t1').onclick=()=>loginView('entrar');$('#t2').onclick=()=>loginView('registro');
}
async function doLogin(){
  const r=await auth('token?grant_type=password',{email:$('#em').value.trim(),password:$('#pw').value});
  if(r.j.access_token){S.t=r.j.access_token;S.r=r.j.refresh_token;home();}
  else $('#m').innerHTML='<span class="err">'+(r.j.error_description||r.j.msg||'Email o contraseña incorrectos, o cuenta sin confirmar.')+'</span>';
}
async function doSignup(){
  if(!$('#priv').checked)return $('#m').innerHTML='<span class="err">Debes aceptar la política de privacidad.</span>';
  if(($('#pw').value||'').length<10)return $('#m').innerHTML='<span class="err">La contraseña debe tener al menos 10 caracteres.</span>';
  const em=$('#em').value.trim();
  const r=await auth('signup',{email:em,password:$('#pw').value,data:{nombre:$('#nm').value.trim()}});
  if(r.s===200&&(r.j.id||r.j.user)){
    fetch('/api/cuenta',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'privacy-consent',email:em})});
    $('#m').innerHTML='<span class="ok">Cuenta creada. Revisa tu correo y pulsa el enlace de confirmación; después vuelve aquí y entra.</span>';
  } else $('#m').innerHTML='<span class="err">'+(r.j.error_description||r.j.msg||'No se pudo crear la cuenta.')+'</span>';
}
async function doReset(){
  const em=$('#em').value.trim();
  if(!em)return $('#m').innerHTML='<span class="err">Escribe tu email arriba y vuelve a pulsar.</span>';
  await auth('recover',{email:em});
  $('#m').innerHTML='<span class="ok">Si la cuenta existe, te hemos enviado un correo para restablecerla.</span>';
}
async function home(){
  const r=await api({action:'mis-datos'});
  if(!r.j.ok){S.t='';S.r='';return loginView();}
  const d=r.j;
  $('#box').innerHTML='<h1>Hola, '+((d.perfil.nombre||d.email).replace(/</g,'&lt;'))+'</h1><p class="muted">'+d.email+' · miembro desde '+String(d.perfil.created_at||'').slice(0,10)+'</p>'+
  '<h3>Mis propuestas ('+d.propuestas.length+')</h3>'+
  (d.propuestas.length?d.propuestas.map(p=>'<div class="prop"><b>'+p.titulo.replace(/</g,'&lt;')+'</b><br><span class="pill">'+p.estado.replace(/_/g,' ')+'</span>'+(p.motivo_rechazo?'<span class="muted"> — '+p.motivo_rechazo.replace(/</g,'&lt;')+'</span>':'')+'</div>').join(''):'<p class="muted">Aún no has enviado ninguna. <a href="/crear-propuesta">Crea la primera</a>.</p>')+
  '<p class="muted" style="margin-top:14px">Has votado en <b>'+d.votos+'</b> propuesta(s).</p>'+
  '<h3>Tu cuenta</h3><label>Nombre público</label><input id="nm" value="'+String(d.perfil.nombre||'').replace(/"/g,'&quot;')+'"><button class="btn" onclick="savePerfil()">Guardar</button>'+
  '<h3>Tus derechos (RGPD)</h3><div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn" style="background:#EEF2F7;color:#42525F" onclick="doExport()">Descargar mis datos</button><button class="btn danger" onclick="doDelete()">Eliminar mi cuenta</button></div>'+
  '<button class="btn" style="background:#0A2A5E;width:100%;margin-top:22px" onclick="S.t=\\'\\';S.r=\\'\\';loginView()">Cerrar sesión</button><div id="m" class="msg"></div>';
}
async function savePerfil(){const r=await api({action:'perfil',nombre:$('#nm').value});$('#m').innerHTML=r.j.ok?'<span class="ok">Guardado ✓</span>':'<span class="err">Error</span>';}
async function doExport(){
  const r=await api({action:'export'});
  if(!r.j.ok)return;
  const blob=new Blob([JSON.stringify(r.j,null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='mis-datos-acciongandia.json';a.click();
}
async function doDelete(){
  if(!confirm('Se eliminará tu cuenta, tus votos y comentarios. Tus propuestas ya publicadas se conservarán como anónimas. ¿Continuar?'))return;
  const r=await api({action:'borrar'});
  if(r.j.ok){S.t='';S.r='';$('#box').innerHTML='<h1>Cuenta eliminada</h1><p class="muted">Tus datos personales han sido borrados. Gracias por haber participado.</p>';}
  else $('#m').innerHTML='<span class="err">No se pudo eliminar. Escríbenos a info@accioncivilgandia.org</span>';
}
S.t?home():loginView();
</script></body></html>`;

export default async (req, context) => {
  const url = new URL(req.url);
  if (url.pathname === '/api/cuenta') return api(req, context);
  return new Response(PAGE(process.env.SUPABASE_URL || '', process.env.SUPABASE_ANON_KEY || ''), {
    status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'x-robots-tag': 'noindex' },
  });
};

export const config = { path: ['/cuenta', '/api/cuenta'] };
