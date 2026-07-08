// Panel de administración — GET /admin (app) + POST /api/admin (acciones JSON).
// Acceso por contraseña (env ADMIN_PASSWORD) con token HMAC de 12 h.
// Todas las escrituras van con service_role y quedan en audit_log.
// v1: contraseña compartida (sin atribución individual — llegará con Fase 3).
// Env: ADMIN_PASSWORD, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { createHmac, timingSafeEqual } from 'node:crypto';
import { rateLimited } from './contacto.mjs';
import { supa, supaConfigured, jsonErr, jsonOk } from './lib/supa.mjs';

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

// ---------- tablas permitidas ----------
const slugify = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'sin-titulo';

const TABLAS = {
  posts: {
    select: 'id,slug,tipo,titulo_es,titulo_va,extracto_es,extracto_va,cuerpo_es,cuerpo_va,imagen,video_url,estado,publicado_at,created_at',
    campos: ['slug', 'tipo', 'titulo_es', 'titulo_va', 'extracto_es', 'extracto_va', 'cuerpo_es', 'cuerpo_va', 'imagen', 'video_url', 'estado', 'publicado_at'],
    orden: 'created_at.desc', borrable: true, slugDe: 'titulo_es',
  },
  events: {
    select: 'id,slug,titulo_es,titulo_va,descripcion_es,descripcion_va,fecha,hora_inicio,hora_fin,lugar,direccion,barrio_id,estado,created_at',
    campos: ['slug', 'titulo_es', 'titulo_va', 'descripcion_es', 'descripcion_va', 'fecha', 'hora_inicio', 'hora_fin', 'lugar', 'direccion', 'barrio_id', 'estado'],
    orden: 'fecha.desc', borrable: true, slugDe: 'titulo_es',
  },
  campaigns: {
    select: 'id,slug,titulo_es,titulo_va,descripcion_es,descripcion_va,imagen,destacada,progreso,estado,created_at',
    campos: ['slug', 'titulo_es', 'titulo_va', 'descripcion_es', 'descripcion_va', 'imagen', 'destacada', 'progreso', 'estado'],
    orden: 'created_at.desc', borrable: true, slugDe: 'titulo_es',
  },
  actuaciones: {
    select: 'id,slug,titulo_es,titulo_va,descripcion_es,descripcion_va,barrio_id,estado,lat,lng,created_at',
    campos: ['slug', 'titulo_es', 'titulo_va', 'descripcion_es', 'descripcion_va', 'barrio_id', 'estado', 'lat', 'lng'],
    orden: 'created_at.desc', borrable: true, slugDe: 'titulo_es',
  },
  equipo: {
    select: 'id,slug,nombre,cargo_es,cargo_va,bio_es,bio_va,foto,orden,activo',
    campos: ['slug', 'nombre', 'cargo_es', 'cargo_va', 'bio_es', 'bio_va', 'foto', 'orden', 'activo'],
    orden: 'orden.asc', borrable: true, slugDe: 'nombre',
  },
  tesoreria: {
    select: 'id,fecha,tipo,categoria,concepto,importe_cents,ejercicio,created_at',
    campos: ['fecha', 'tipo', 'categoria', 'concepto', 'importe_cents'],
    orden: 'fecha.desc', borrable: true,
  },
  proposals: {
    select: 'id,titulo,descripcion,categoria,estado,motivo_rechazo,contacto_nombre,contacto_email,created_at',
    campos: ['estado', 'motivo_rechazo'], soloEditar: true, orden: 'created_at.desc',
  },
  denuncias: {
    select: 'id,codigo,categoria,texto,contacto,estado,respuesta,created_at',
    campos: ['estado', 'respuesta'], soloEditar: true, orden: 'created_at.desc',
  },
  members_inbox: {
    select: 'id,nombre,apellidos,cuota_tipo,estado,stripe_customer_id,created_at',
    campos: [], soloLeer: true, orden: 'created_at.desc',
  },
  donations: {
    select: 'id,donor_nombre,donor_apellidos,donor_email,importe_cents,ejercicio,estado,created_at',
    campos: [], soloLeer: true, orden: 'created_at.desc',
  },
};

const audit = (accion, tabla, id, detalle) =>
  supa('POST', 'audit_log', { accion, tabla, registro_id: String(id || ''), detalle: { ...detalle, actor: 'admin-panel' } }).catch(() => {});

// ---------- API ----------
async function api(req, context) {
  const key = process.env.ADMIN_PASSWORD;
  if (!key || !supaConfigured()) return jsonErr(503, 'unconfigured', 'Panel no configurado (falta ADMIN_PASSWORD)');
  let b;
  try { b = await req.json(); } catch { return jsonErr(400, 'bad_json', 'Cuerpo inválido'); }

  if (b.action === 'login') {
    const ip = context.ip || req.headers.get('x-nf-client-connection-ip') || '0.0.0.0';
    if (rateLimited('admin:' + ip, 8)) return jsonErr(429, 'rate_limited', 'Demasiados intentos, espera una hora');
    if (!safeEqual(b.password || '', key)) return jsonErr(401, 'bad_password', 'Contraseña incorrecta');
    return jsonOk({ ok: true, token: makeToken(key) });
  }

  const token = (req.headers.get('authorization') || '').replace('Bearer ', '');
  if (!checkToken(token, key)) return jsonErr(401, 'unauthorized', 'Sesión caducada — vuelve a entrar');

  const cfg = TABLAS[b.tabla];
  if (b.action !== 'barrios' && !cfg) return jsonErr(400, 'bad_table', 'Tabla no permitida');

  if (b.action === 'barrios') {
    const r = await supa('GET', 'barrios?select=id,slug,nombre_es&order=nombre_es');
    return jsonOk({ ok: true, items: r.json || [] });
  }
  if (b.action === 'list') {
    const r = await supa('GET', `${b.tabla}?select=${cfg.select}&order=${cfg.orden}&limit=200`);
    if (!r.ok) return jsonErr(502, 'db_error', 'Error leyendo ' + b.tabla);
    return jsonOk({ ok: true, items: r.json });
  }
  if (b.action === 'save') {
    if (cfg.soloLeer) return jsonErr(403, 'read_only', 'Tabla de solo lectura');
    const row = {};
    for (const c of cfg.campos) if (b.row[c] !== undefined) row[c] = b.row[c];
    if (b.row.id) {                                    // editar
      const r = await supa('PATCH', `${b.tabla}?id=eq.${b.row.id}`, row);
      if (!r.ok) return jsonErr(502, 'db_error', 'No se pudo guardar: ' + (r.text || '').slice(0, 140));
      await audit('editar', b.tabla, b.row.id, { campos: Object.keys(row) });
      return jsonOk({ ok: true, item: r.json?.[0] });
    }
    if (cfg.soloEditar) return jsonErr(403, 'edit_only', 'En esta tabla solo se puede editar');
    if (cfg.slugDe && !row.slug) row.slug = slugify(b.row[cfg.slugDe]) + '-' + Math.random().toString(36).slice(2, 6);
    if (b.tabla === 'posts' && row.estado === 'publicado' && !row.publicado_at) row.publicado_at = new Date().toISOString();
    const r = await supa('POST', b.tabla, row);
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
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@800&family=Public+Sans:wght@400;600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box}body{margin:0;font-family:Public Sans,sans-serif;background:#F4F7FB;color:#17232F;line-height:1.5}
.top{background:#0A2A5E;color:#fff;padding:14px 22px;display:flex;align-items:center;gap:14px}
.top b{font-family:Bricolage Grotesque;font-size:18px}
.wrap{display:flex;min-height:calc(100vh - 54px)}
.side{width:210px;background:#fff;border-right:1px solid #E9EEF4;padding:14px 0;flex-shrink:0}
.side button{display:block;width:100%;text-align:left;border:none;background:none;cursor:pointer;font:600 14px Public Sans;color:#33414F;padding:11px 20px;border-left:3px solid transparent}
.side button.on{color:#0A2A5E;border-left-color:#F6BE18;background:#F7FAFD}
.main{flex:1;padding:24px;min-width:0}
h2{font-family:Bricolage Grotesque;color:#0A2A5E;margin:0 0 4px;font-size:24px}
.sub{color:#5C6B7A;font-size:13.5px;margin:0 0 18px}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #E9EEF4;border-radius:14px;overflow:hidden}
th{font:700 11.5px Public Sans;text-transform:uppercase;letter-spacing:.08em;color:#5C6B7A;text-align:left;padding:11px 14px;border-bottom:1px solid #E9EEF4;background:#FAFCFE}
td{padding:11px 14px;border-bottom:1px solid #F1F4F8;font-size:14px;vertical-align:top}
tr:hover td{background:#F7FAFD;cursor:pointer}
.pill{display:inline-block;font:700 11px Public Sans;padding:3px 10px;border-radius:999px}
.btn{border:none;cursor:pointer;background:#1563C4;color:#fff;font:700 14px Public Sans;padding:11px 20px;border-radius:10px}
.btn.gold{background:#F6BE18;color:#0A2A5E}.btn.ghost{background:#fff;color:#C0392B;border:1.5px solid #F0D5D0}
label{display:block;font:600 12.5px Public Sans;color:#42525F;margin:13px 0 5px}
input,select,textarea{width:100%;border:1.5px solid #E4EBF2;border-radius:10px;padding:10px 12px;font:400 14px Public Sans;outline:none;background:#fff}
textarea{min-height:90px;resize:vertical}
.form{background:#fff;border:1px solid #E9EEF4;border-radius:16px;padding:22px;max-width:760px;margin-top:14px}
.row2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.stats{display:flex;gap:14px;margin-bottom:16px;flex-wrap:wrap}
.stat{background:#fff;border:1px solid #E9EEF4;border-radius:14px;padding:14px 20px;min-width:150px}
.stat b{font:800 22px Bricolage Grotesque;display:block}
.msg{margin-top:12px;font-weight:600}
#login{max-width:380px;margin:80px auto;background:#fff;border:1px solid #E9EEF4;border-radius:18px;padding:34px;text-align:center}
.warn{color:#C0392B;font-weight:700}
@media(max-width:800px){.wrap{flex-direction:column}.side{width:100%;display:flex;overflow-x:auto}.side button{white-space:nowrap;border-left:none;border-bottom:3px solid transparent}.side button.on{border-bottom-color:#F6BE18}}
</style></head><body>
<div class="top"><b>ACG · Panel</b><span style="font-size:13px;color:#8FA6C4">Administración de contenidos</span>
<a href="https://app.brevo.com" target="_blank" style="margin-left:auto;color:#8FA6C4;font-size:12.5px;text-decoration:none">Newsletter (Brevo) ↗</a>
<button id="out" class="btn ghost" style="display:none;padding:7px 14px;font-size:12.5px">Salir</button></div>
<div id="login"><h2>Acceso</h2><p class="sub">Panel del equipo de Acción Civil</p>
<input id="pw" type="password" placeholder="Contraseña" style="margin-bottom:12px">
<button class="btn" style="width:100%" onclick="login()">Entrar</button><div id="lmsg" class="msg"></div></div>
<div class="wrap" id="app" style="display:none"><nav class="side" id="tabs"></nav><main class="main" id="main"></main></div>
<script>
const $=q=>document.querySelector(q);
let TOKEN=sessionStorage.getItem('acg_admin')||'';
const EUR=c=>(c/100).toLocaleString('es-ES',{style:'currency',currency:'EUR'});
const CATS_TES={ingreso:['Cuotas','Donaciones','Actos y lotería','Subvenciones','Otros ingresos'],gasto:['Alquiler local','Material y cartelería','Actos','Servicios y web','Gestoría','Otros gastos']};
const ESTADOS={borrador:['#FBF0DC','#9A6208'],publicado:['#E7F4EC','#1E7A45'],archivado:['#EEF2F7','#5C6B7A'],cancelado:['#FDEAEA','#C0392B'],activa:['#E7F4EC','#1E7A45'],finalizada:['#EEF2F7','#5C6B7A'],propuesta:['#FBF0DC','#9A6208'],en_curso:['#EAF3FC','#1563C4'],completada:['#E7F4EC','#1E7A45'],pendiente_moderacion:['#FBF0DC','#9A6208'],publicada:['#E7F4EC','#1E7A45'],rechazada:['#FDEAEA','#C0392B'],en_estudio:['#EAF3FC','#1563C4'],aprobada:['#E7F4EC','#1E7A45'],nueva:['#FDEAEA','#C0392B'],en_tramite:['#EAF3FC','#1563C4'],cerrada:['#E7F4EC','#1E7A45'],ingreso:['#E7F4EC','#1E7A45'],gasto:['#FDEAEA','#C0392B'],activo:['#E7F4EC','#1E7A45'],pagada:['#E7F4EC','#1E7A45']};
const pill=v=>{const c=ESTADOS[v]||['#EEF2F7','#5C6B7A'];return '<span class="pill" style="background:'+c[0]+';color:'+c[1]+'">'+(v||'—').replace(/_/g,' ')+'</span>'};

const F={ // definición de formularios por pestaña
 posts:{titulo:'Noticias y blog',desc:'Actualidad, comunicados, vídeos y entrevistas. Lo publicado aparece en la web al momento.',cols:[['titulo_es','Título'],['tipo','Tipo'],['estado','Estado'],['publicado_at','Publicado']],campos:[
  ['tipo','Tipo','select',['noticia','comunicado','video','entrevista']],['estado','Estado','select',['borrador','publicado','archivado']],
  ['titulo_es','Título (ES)','text'],['titulo_va','Título (VA) — si lo dejas vacío se copia del ES','text'],
  ['extracto_es','Extracto corto (ES)','textarea'],['extracto_va','Extracto (VA)','textarea'],
  ['cuerpo_es','Cuerpo del artículo (ES)','textarea'],['cuerpo_va','Cuerpo (VA)','textarea'],
  ['imagen','Imagen (ruta assets/... o URL)','text'],['video_url','URL de vídeo (opcional)','text']]},
 events:{titulo:'Agenda',desc:'Actos y eventos. Estado "publicado" para que salgan en la web.',cols:[['titulo_es','Título'],['fecha','Fecha'],['lugar','Lugar'],['estado','Estado']],campos:[
  ['estado','Estado','select',['borrador','publicado','cancelado']],['titulo_es','Título (ES)','text'],['titulo_va','Título (VA)','text'],
  ['descripcion_es','Descripción (ES)','textarea'],['descripcion_va','Descripción (VA)','textarea'],
  ['fecha','Fecha','date'],['hora_inicio','Hora inicio','time'],['hora_fin','Hora fin','time'],
  ['lugar','Lugar','text'],['direccion','Dirección','text'],['barrio_id','Barrio','barrio']]},
 campaigns:{titulo:'Campañas',desc:'La campaña con "destacada" activada es la que sale en la Home.',cols:[['titulo_es','Título'],['progreso','%'],['destacada','Destacada'],['estado','Estado']],campos:[
  ['estado','Estado','select',['borrador','activa','finalizada']],['destacada','Destacada en Home','check'],['progreso','Progreso (0-100)','number'],
  ['titulo_es','Título (ES)','text'],['titulo_va','Título (VA)','text'],
  ['descripcion_es','Descripción (ES)','textarea'],['descripcion_va','Descripción (VA)','textarea'],['imagen','Imagen','text']]},
 actuaciones:{titulo:'Actuaciones',desc:'Acciones por barrio. Salen en Acción en Gandia y en el mapa de la Home.',cols:[['titulo_es','Título'],['estado','Estado']],campos:[
  ['estado','Estado','select',['propuesta','en_curso','completada']],['titulo_es','Título (ES)','text'],['titulo_va','Título (VA)','text'],
  ['descripcion_es','Descripción (ES)','textarea'],['descripcion_va','Descripción (VA)','textarea'],
  ['barrio_id','Barrio','barrio'],['lat','Latitud (mapa)','number'],['lng','Longitud (mapa)','number']]},
 equipo:{titulo:'Equipo',desc:'Junta directiva que aparece en Equipo y Conócenos, por orden.',cols:[['nombre','Nombre'],['cargo_es','Cargo'],['orden','Orden'],['activo','Activo']],campos:[
  ['nombre','Nombre completo','text'],['cargo_es','Cargo (ES)','text'],['cargo_va','Cargo (VA)','text'],
  ['bio_es','Bio (ES)','textarea'],['bio_va','Bio (VA)','textarea'],['foto','Foto (assets/miembros/...)','text'],
  ['orden','Orden (0 = primero)','number'],['activo','Visible en la web','check']]},
 tesoreria:{titulo:'Tesorería',desc:'Ingresos y gastos. La página pública de Transparencia se actualiza con estos datos.',cols:[['fecha','Fecha'],['tipo','Tipo'],['categoria','Categoría'],['concepto','Concepto'],['importe_cents','Importe']],campos:[
  ['fecha','Fecha','date'],['tipo','Tipo','select',['ingreso','gasto']],['categoria','Categoría','cat_tes'],
  ['concepto','Concepto','text'],['importe_eur','Importe en euros (ej. 120,50)','text']]},
 proposals:{titulo:'Propuestas ciudadanas',desc:'Moderación: publica, marca en estudio o rechaza (con motivo). Lo publicado saldrá en Participación.',cols:[['titulo','Título'],['categoria','Categoría'],['estado','Estado'],['created_at','Recibida']],campos:[
  ['estado','Decisión','select',['pendiente_moderacion','publicada','en_estudio','aprobada','rechazada']],['motivo_rechazo','Motivo (si se rechaza)','textarea']],ro:['titulo','descripcion','contacto_nombre','contacto_email']},
 denuncias:{titulo:'Canal de denuncias',desc:'⚠ Ley 2/2023: acuse en 7 días y resolución en 3 meses. La respuesta la ve el informante con su código.',cols:[['codigo','Código'],['categoria','Categoría'],['estado','Estado'],['created_at','Recibida']],campos:[
  ['estado','Estado','select',['nueva','en_tramite','cerrada']],['respuesta','Respuesta al informante','textarea']],ro:['texto','contacto']},
 members_inbox:{titulo:'Afiliaciones',desc:'Altas pagadas vía Stripe (se activa en Fase 4).',cols:[['nombre','Nombre'],['apellidos','Apellidos'],['cuota_tipo','Cuota'],['estado','Estado']],campos:[]},
 donations:{titulo:'Donaciones',desc:'Donaciones recibidas (Fase 4). Export completo para Tribunal de Cuentas: ver spec.',cols:[['donor_nombre','Nombre'],['importe_cents','Importe'],['ejercicio','Ejercicio'],['estado','Estado']],campos:[]}
};
const ORDEN=['posts','events','campaigns','actuaciones','equipo','tesoreria','proposals','denuncias','members_inbox','donations'];
let TAB='posts', ROWS=[], BARRIOS=[];

async function call(body){
  const r=await fetch('/api/admin',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+TOKEN},body:JSON.stringify(body)});
  const j=await r.json().catch(()=>({}));
  if(r.status===401&&body.action!=='login'){sessionStorage.removeItem('acg_admin');location.reload();}
  return {s:r.status,j};
}
async function login(){
  const r=await call({action:'login',password:$('#pw').value});
  if(r.j.token){TOKEN=r.j.token;sessionStorage.setItem('acg_admin',TOKEN);start();}
  else $('#lmsg').innerHTML='<span class="warn">'+((r.j.error&&r.j.error.message)||'Error')+'</span>';
}
$('#pw').addEventListener('keydown',e=>{if(e.key==='Enter')login()});
$('#out').onclick=()=>{sessionStorage.removeItem('acg_admin');location.reload();};

function start(){
  $('#login').style.display='none';$('#app').style.display='flex';$('#out').style.display='block';
  $('#tabs').innerHTML=ORDEN.map(k=>'<button data-t="'+k+'">'+F[k].titulo+'</button>').join('');
  $('#tabs').addEventListener('click',e=>{const b=e.target.closest('button');if(b){TAB=b.dataset.t;render();}});
  call({action:'barrios',tabla:'events'}).then(r=>{BARRIOS=r.j.items||[]});
  render();
}
async function render(){
  document.querySelectorAll('.side button').forEach(b=>b.classList.toggle('on',b.dataset.t===TAB));
  const f=F[TAB];
  $('#main').innerHTML='<h2>'+f.titulo+'</h2><p class="sub">'+f.desc+'</p><p class="sub">Cargando…</p>';
  const r=await call({action:'list',tabla:TAB});
  ROWS=r.j.items||[];
  let extra='';
  if(TAB==='tesoreria'){
    const y=new Date().getFullYear();
    const ing=ROWS.filter(x=>x.tipo==='ingreso'&&x.ejercicio===y).reduce((s,x)=>s+x.importe_cents,0);
    const gas=ROWS.filter(x=>x.tipo==='gasto'&&x.ejercicio===y).reduce((s,x)=>s+x.importe_cents,0);
    extra='<div class="stats"><div class="stat"><b style="color:#1E7A45">'+EUR(ing)+'</b>Ingresos '+y+'</div><div class="stat"><b style="color:#C0392B">'+EUR(gas)+'</b>Gastos '+y+'</div><div class="stat"><b style="color:#0A2A5E">'+EUR(ing-gas)+'</b>Saldo '+y+'</div></div>';
  }
  if(TAB==='denuncias'){
    const urg=ROWS.filter(x=>x.estado==='nueva'&&(Date.now()-new Date(x.created_at))/864e5>5).length;
    if(urg)extra='<p class="warn">⚠ '+urg+' denuncia(s) a punto de agotar el plazo de acuse de 7 días.</p>';
  }
  const nuevo=(!f.campos.length||F[TAB].ro&&!f.campos.length)?'':(TABLAS_EDIT(TAB)?'<button class="btn gold" onclick="form()">+ Nuevo</button>':'');
  $('#main').innerHTML='<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap"><div style="flex:1"><h2>'+f.titulo+'</h2><p class="sub">'+f.desc+'</p></div>'+nuevo+'</div>'+extra+
    '<table><thead><tr>'+f.cols.map(c=>'<th>'+c[1]+'</th>').join('')+'</tr></thead><tbody>'+
    (ROWS.length?ROWS.map((row,i)=>'<tr onclick="form('+i+')">'+f.cols.map(c=>{
      let v=row[c[0]];
      if(c[0]==='importe_cents')v=(row.tipo==='gasto'?'−':'+')+EUR(v);
      else if(c[0]==='publicado_at'||c[0]==='created_at')v=v?String(v).slice(0,10):'—';
      else if(typeof v==='boolean')v=v?'✓':'—';
      else if(ESTADOS[v])v=pill(v);
      return '<td>'+(v==null?'—':v)+'</td>';
    }).join('')+'</tr>').join(''):'<tr><td colspan="9" style="color:#8A99A8">Sin registros todavía.</td></tr>')+
    '</tbody></table><div id="fbox"></div>';
}
function TABLAS_EDIT(t){return !['proposals','denuncias','members_inbox','donations'].includes(t)}
window.form=function(i){
  const f=F[TAB];
  if(!f.campos.length)return;
  const row=i===undefined?{}:ROWS[i];
  let ro='';
  if(f.ro&&i!==undefined)ro='<div style="background:#F7FAFD;border:1px solid #E9EEF4;border-radius:12px;padding:14px;margin-bottom:6px">'+f.ro.map(k=>row[k]?'<p style="margin:4px 0;font-size:14px"><b style="color:#42525F">'+k.replace(/_/g,' ')+':</b> '+String(row[k]).replace(/</g,'&lt;')+'</p>':'').join('')+'</div>';
  $('#fbox').innerHTML='<div class="form"><h3 style="font-family:Bricolage Grotesque;color:#0A2A5E;margin:0">'+(i===undefined?'Nuevo registro':'Editar')+'</h3>'+ro+
    f.campos.map(c=>{
      const[k,lab,tipo,ops]=c;
      let v=row[k];
      if(k==='importe_eur')v=row.importe_cents!=null?(row.importe_cents/100).toString().replace('.',','):'';
      v=v==null?'':v;
      if(tipo==='select')return '<label>'+lab+'</label><select id="f_'+k+'">'+ops.map(o=>'<option '+(o===row[k]?'selected':'')+'>'+o+'</option>').join('')+'</select>';
      if(tipo==='cat_tes')return '<label>'+lab+'</label><select id="f_'+k+'">'+[...CATS_TES.ingreso,...CATS_TES.gasto].map(o=>'<option '+(o===row[k]?'selected':'')+'>'+o+'</option>').join('')+'</select>';
      if(tipo==='barrio')return '<label>'+lab+'</label><select id="f_'+k+'"><option value="">—</option>'+BARRIOS.map(b=>'<option value="'+b.id+'" '+(b.id===row[k]?'selected':'')+'>'+b.nombre_es+'</option>').join('')+'</select>';
      if(tipo==='textarea')return '<label>'+lab+'</label><textarea id="f_'+k+'">'+String(v).replace(/</g,'&lt;')+'</textarea>';
      if(tipo==='check')return '<label>'+lab+'</label><input type="checkbox" id="f_'+k+'" style="width:20px;height:20px" '+(row[k]?'checked':'')+'>';
      return '<label>'+lab+'</label><input type="'+(tipo||'text')+'" id="f_'+k+'" value="'+String(v).replace(/"/g,'&quot;')+'">';
    }).join('')+
    '<div style="display:flex;gap:10px;margin-top:20px"><button class="btn" onclick="save('+(i===undefined?'':i)+')">Guardar</button>'+
    (i!==undefined&&TABLAS_EDIT(TAB)?'<button class="btn ghost" onclick="del('+i+')">Borrar</button>':'')+
    '<button class="btn" style="background:#EEF2F7;color:#42525F" onclick="document.getElementById(\\'fbox\\').innerHTML=\\'\\'">Cancelar</button></div><div id="fmsg" class="msg"></div></div>';
  $('#fbox').scrollIntoView({behavior:'smooth'});
};
window.save=async function(i){
  const f=F[TAB], row={};
  if(i!==undefined&&i!=='')row.id=ROWS[i].id;
  for(const c of f.campos){
    const el=$('#f_'+c[0]); if(!el)continue;
    let v=c[2]==='check'?el.checked:el.value;
    if(c[0]==='importe_eur'){row.importe_cents=Math.round(parseFloat(String(v).replace(',','.'))*100)||0;continue;}
    if(c[2]==='number')v=v===''?null:Number(v);
    if(v==='')v=null;
    row[c[0]]=v;
  }
  // VA vacío -> copia del ES
  for(const k of Object.keys(row))if(k.endsWith('_va')&&!row[k]){const es=row[k.replace('_va','_es')];if(es)row[k]=es;}
  const r=await call({action:'save',tabla:TAB,row});
  if(r.j.ok){$('#fmsg').innerHTML='<span style="color:#1E7A45">Guardado ✓</span>';setTimeout(render,500);}
  else $('#fmsg').innerHTML='<span class="warn">'+((r.j.error&&r.j.error.message)||'Error')+'</span>';
};
window.del=async function(i){
  if(!confirm('¿Borrar definitivamente este registro?'))return;
  const r=await call({action:'del',tabla:TAB,id:ROWS[i].id});
  if(r.j.ok)render();else alert('No se pudo borrar');
};
if(TOKEN)start();
</script></body></html>`;

export default async (req, context) => {
  const url = new URL(req.url);
  if (url.pathname === '/api/admin') return api(req, context);
  return new Response(APP, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'x-robots-tag': 'noindex' } });
};

export const config = { path: ['/admin', '/api/admin'] };
