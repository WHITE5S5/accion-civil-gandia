// Canal interno de informaciones — Ley 2/2023.
// GET  /denuncias                  -> página con el formulario confidencial (HTML autocontenido)
// GET  /denuncias?codigo=ACG-XXXX  -> estado + respuesta + HILO de mensajes por código
// POST /api/denuncias              -> registra la denuncia y devuelve el código
//                                     (con sesión: se vincula a la cuenta y el código llega por email)
// POST /api/denuncias {action:'mensaje', codigo, texto} -> respuesta del ciudadano en el hilo
// Anonimato: sin sesión NO se registra IP, user-agent ni identidad. El rate limit usa IP
// solo en memoria del proceso. Aviso al responsable por email SIN el contenido.
import { randomBytes } from 'node:crypto';
import { rateLimited, sendEmail, emailShell } from './contacto.mjs';
import { getUser } from './lib/auth.mjs';
import { supa, supaConfigured, jsonErr, jsonOk } from './lib/supa.mjs';

const CATS = ['Normativa interna', 'Financiación', 'Conflicto de interés', 'Acoso o trato degradante', 'Otra irregularidad'];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CODE_RE = /^ACG-[0-9A-F]{8}$/;

const shell = (title, inner) => new Response(`<!doctype html><html lang="es"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${title} — Acción Civil Gandia</title>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@800&family=Public+Sans:wght@400;600;700&display=swap" rel="stylesheet">
<style>body{margin:0;font-family:Public Sans,sans-serif;background:#F4F7FB;color:#17232F;line-height:1.6}
.card{background:#fff;border:1px solid #E9EEF4;border-radius:20px;padding:36px;max-width:640px;margin:40px auto;box-shadow:0 10px 30px rgba(10,42,94,.06)}
h1{font-family:Bricolage Grotesque,sans-serif;font-size:28px;color:#0A2A5E;margin:0 0 8px}
label{display:block;font:600 13px Public Sans;color:#42525F;margin:16px 0 6px}
input,select,textarea{width:100%;box-sizing:border-box;border:1.5px solid #E4EBF2;border-radius:11px;padding:12px 14px;font:400 14.5px Public Sans;outline:none;background:#fff}
textarea{min-height:160px;resize:vertical}
button{border:none;cursor:pointer;background:#0A2A5E;color:#fff;font:700 15px Public Sans;padding:14px 28px;border-radius:12px;margin-top:20px}
.muted{color:#5C6B7A;font-size:13.5px}.ok{color:#2E9E5B}.err{color:#C0392B}
.code{font:700 26px monospace;background:#0A2A5E;color:#F6BE18;border-radius:12px;padding:16px 22px;display:inline-block;letter-spacing:2px}
.aviso{background:#FBF0DC;border:1px solid #EFD9A8;border-radius:12px;padding:12px 16px;font:600 13px Public Sans;color:#9A6208;margin-top:14px}
.msg{border-radius:14px;padding:12px 16px;margin-top:10px;font-size:14px;max-width:85%}
.msg.eq{background:#EAF3FC;border:1px solid #CFE0F5}
.msg.ciu{background:#F0F4F9;border:1px solid #E4EBF2;margin-left:auto}
.msg .who{font:700 11.5px Public Sans;color:#5C6B7A;margin-bottom:3px;text-transform:uppercase;letter-spacing:.04em}</style></head>
<body>${inner}
<p style="text-align:center;margin:0 0 40px"><a href="/" style="color:#1563C4;font-size:14px">← Volver a accioncivilgandia</a></p>
</body></html>`, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });

const formPage = () => shell('Canal de denuncias', `
<div class="card">
  <h1>Canal confidencial de informaciones</h1>
  <p class="muted">Conforme a la Ley 2/2023. Acuse de recibo en un máximo de 7 días y respuesta en un máximo de 3 meses.</p>
  <div id="modo" class="aviso" style="display:none"></div>
  <form id="f">
    <label>Categoría</label>
    <select name="categoria">${CATS.map((c) => `<option>${c}</option>`).join('')}</select>
    <label>Descripción de los hechos (mínimo 30 caracteres)</label>
    <textarea name="texto" required minlength="30" placeholder="Describe qué ha ocurrido, cuándo y quién está implicado. Cuantos más detalles, mejor podremos investigarlo."></textarea>
    <label>Contacto (opcional — solo si quieres respuesta por correo)</label>
    <input name="contacto" type="email" placeholder="Tu correo (puedes dejarlo vacío)">
    <input name="hp" style="display:none" tabindex="-1" autocomplete="off">
    <button type="submit">Enviar de forma confidencial</button>
    <div id="st" role="status" style="margin-top:14px;font-weight:600"></div>
  </form>
  <hr style="border:none;border-top:1px solid #EEF2F7;margin:28px 0">
  <p class="muted"><b>¿Ya tienes un código?</b> Consulta el estado y la conversación:</p>
  <form id="q" style="display:flex;gap:8px">
    <input name="codigo" placeholder="ACG-XXXXXXXX" style="flex:1">
    <button type="submit" style="margin:0;padding:12px 20px">Consultar</button>
  </form>
  <div id="qr" style="margin-top:12px"></div>
</div>
<script>
var TOK='';try{TOK=localStorage.getItem('acg_session')||'';}catch(e){}
var modo=document.getElementById('modo');
if(TOK){modo.style.display='block';modo.innerHTML='Has iniciado sesión: la denuncia quedará vinculada a tu cuenta, el código te llegará <b>por correo</b> y podrás seguirla desde <a href="/cuenta">Mi cuenta</a>. Si prefieres denunciar de forma 100% anónima, <b>cierra sesión antes</b>.';}
else{modo.style.display='block';modo.innerHTML='Vas a denunciar de forma <b>100% anónima</b>: no registramos IP ni identidad. A cambio, el código de seguimiento <b>solo se muestra una vez</b> — apúntalo bien. Si entras con tu cuenta, el código te llega por correo y queda en tu área ciudadana.';}
function hd(){var h={'content-type':'application/json'};if(TOK)h.authorization='Bearer '+TOK;return h;}
document.getElementById('f').addEventListener('submit',async function(e){
  e.preventDefault();var st=document.getElementById('st');st.textContent='Enviando…';st.className='muted';
  var fd=new FormData(this);
  try{
    var r=await fetch('/api/denuncias',{method:'POST',headers:hd(),
      body:JSON.stringify({categoria:fd.get('categoria'),texto:fd.get('texto'),contacto:fd.get('contacto'),hp:fd.get('hp')})});
    var j=await r.json();
    if(r.ok&&j.ok){this.style.display='none';st.textContent='';
      var por=j.porEmail, cod=j.codigo;
      var ov=document.createElement('div');ov.setAttribute('role','dialog');
      ov.style.cssText='position:fixed;inset:0;z-index:99999;background:rgba(7,30,69,.8);display:flex;align-items:center;justify-content:center;padding:20px';
      ov.innerHTML='<div style="background:#fff;border-radius:16px;max-width:460px;width:100%;padding:30px 26px;text-align:center;box-shadow:0 30px 80px rgba(0,0,0,.45)">'
        +'<div style="font:800 22px Public Sans,system-ui,sans-serif;color:#0A2A5E;margin:0 0 6px">Denuncia registrada</div>'
        +'<div style="color:#5C6B7A;font-size:14px;margin:0 0 18px">Este es tu código de seguimiento. Gu&aacute;rdalo:</div>'
        +'<div id="cod" style="font:800 30px monospace;background:#0A2A5E;color:#F6BE18;border-radius:12px;padding:20px 14px;letter-spacing:3px;word-break:break-all;margin:0 0 16px">'+cod+'</div>'
        +'<button id="cpy" type="button" style="width:100%;border:none;cursor:pointer;background:#1563C4;color:#fff;font:700 16px Public Sans,system-ui,sans-serif;padding:15px;border-radius:10px;margin:0 0 14px">Copiar c&oacute;digo</button>'
        +(por?'<div style="font-size:13px;color:#33414F;background:#F0F4F9;border-radius:10px;padding:12px">Tambi&eacute;n te lo hemos enviado por correo y lo tienes en <a href="/cuenta">Mi cuenta</a>.</div>':'<div style="font-size:13px;color:#8A4B00;background:#FBF0DC;border:1px solid #F0D48A;border-radius:10px;padding:12px;text-align:left">&#9888; <b>Ap&uacute;ntalo ahora.</b> Al ser an&oacute;nima, este c&oacute;digo no se puede recuperar y es la &uacute;nica forma de seguir tu denuncia y leer nuestras respuestas.</div>')
        +'<button id="cls" type="button" style="margin-top:16px;background:none;border:none;color:#5C6B7A;font:600 13px Public Sans,system-ui,sans-serif;cursor:pointer;text-decoration:underline">Ya lo he guardado, cerrar</button>'
        +'</div>';
      document.body.appendChild(ov);
      document.getElementById('cpy').addEventListener('click',function(){var t=document.getElementById('cod').textContent;try{navigator.clipboard.writeText(t);}catch(_){}this.textContent='Copiado ✓';this.style.background='#1E7A45';});
      document.getElementById('cls').addEventListener('click',function(){ov.remove();});
    }
    else{st.className='err';st.textContent=(j.error&&j.error.message)||'No se pudo registrar. Inténtalo más tarde.';}
  }catch(_){st.className='err';st.textContent='Error de conexión. Inténtalo más tarde.';}
});
async function consulta(c){
  var qr=document.getElementById('qr');
  if(!c||!/^ACG-[0-9A-F]{8}$/.test(c)){qr.innerHTML='<span class="err">Introduce un c&oacute;digo con el formato ACG-XXXXXXXX.</span>';return;}
  qr.textContent='Consultando…';
  var r,j;
  try{ r=await fetch('/api/denuncias?codigo='+encodeURIComponent(c)); j=await r.json(); }
  catch(_){ qr.innerHTML='<span class="err">Error de conexi&oacute;n. Int&eacute;ntalo de nuevo.</span>'; return; }
  if(!(r.ok&&j.ok)){qr.innerHTML='<span class="err">Código no encontrado.</span>';return;}
  var est={nueva:'Recibida — pendiente de revisión',en_tramite:'En tramitación',cerrada:'Cerrada'}[j.estado]||j.estado;
  var h='<p style="margin:8px 0"><b>Estado:</b> '+est+'</p>';
  var msgs=j.mensajes||[];
  if(j.respuesta&&!msgs.length)h+='<div class="msg eq"><div class="who">Equipo de cumplimiento</div>'+j.respuesta.replace(/</g,'&lt;')+'</div>';
  msgs.forEach(function(m){h+='<div class="msg '+(m.autor==='equipo'?'eq':'ciu')+'"><div class="who">'+(m.autor==='equipo'?'Equipo de cumplimiento':'Tú')+' · '+m.fecha+'</div>'+m.texto.replace(/</g,'&lt;')+'</div>';});
  var ultimoAutor=msgs.length?msgs[msgs.length-1].autor:(j.respuesta?'equipo':null);
  var miTurno=ultimoAutor==='equipo';
  if(j.estado==='cerrada'){h+='<p class="muted" style="margin-top:10px">Expediente cerrado: no admite más mensajes.</p>';}
  else if(miTurno){
    h+='<div style="display:flex;gap:8px;margin-top:14px"><input id="resp" placeholder="Escribe tu respuesta al equipo…" style="flex:1"><button type="button" id="respBtn" style="margin:0;padding:12px 18px">Enviar</button></div><div id="respSt" class="muted" style="margin-top:6px"></div>';
  } else {
    h+='<p class="muted" style="margin-top:12px;background:#F0F4F9;border-radius:10px;padding:12px 14px">'+(ultimoAutor===null?'Hemos recibido tu denuncia. Cuando el equipo de cumplimiento te responda por aqu&iacute;, podr&aacute;s contestar.':'Tu mensaje est&aacute; registrado. Podr&aacute;s volver a escribir cuando el equipo te responda.')+'</p>';
  }
  qr.innerHTML=h;
  var bt=document.getElementById('respBtn');
  if(bt)bt.addEventListener('click',async function(){
    var t=document.getElementById('resp').value.trim();var stx=document.getElementById('respSt');
    if(t.length<2)return;
    stx.textContent='Enviando…';
    var r2=await fetch('/api/denuncias',{method:'POST',headers:hd(),body:JSON.stringify({action:'mensaje',codigo:c,texto:t})});
    var j2=await r2.json();
    if(r2.ok&&j2.ok){consulta(c);}else{stx.className='err';stx.textContent=(j2.error&&j2.error.message)||'No se pudo enviar.';}
  });
}
document.getElementById('q').addEventListener('submit',function(e){e.preventDefault();consulta(new FormData(this).get('codigo').trim().toUpperCase());});
var pre=new URLSearchParams(location.search).get('ver');
if(pre){document.querySelector('#q input').value=pre;consulta(pre.trim().toUpperCase());}
</script>`);

export default async (req, context) => {
  const url = new URL(req.url);

  if (req.method === 'GET') {
    const codigo = (url.searchParams.get('codigo') || '').trim().toUpperCase();
    if (!codigo) return formPage();
    if (!supaConfigured()) return jsonErr(503, 'service_unconfigured', 'Canal no configurado');
    const q = await supa('GET', `denuncias?codigo=eq.${encodeURIComponent(codigo)}&select=estado,respuesta`);
    if (!q.ok || !q.json?.length) return jsonErr(404, 'not_found', 'Código no encontrado');
    const ms = await supa('GET', `denuncia_mensajes?codigo=eq.${encodeURIComponent(codigo)}&select=autor,texto,created_at&order=created_at.asc&limit=100`);
    const mensajes = (ms.json || []).map((m) => ({ autor: m.autor, texto: m.texto, fecha: String(m.created_at).slice(0, 10) }));
    return jsonOk({ ok: true, estado: q.json[0].estado, respuesta: q.json[0].respuesta, mensajes });
  }

  if (req.method !== 'POST') return jsonErr(405, 'method_not_allowed', 'Método no permitido');
  const ip = context.ip || req.headers.get('x-nf-client-connection-ip') || '0.0.0.0';
  if (!supaConfigured()) return jsonErr(503, 'service_unconfigured', 'Canal no configurado todavía');

  let b;
  try { b = await req.json(); } catch { return jsonErr(400, 'bad_json', 'Cuerpo inválido'); }

  // ---- respuesta del ciudadano en el hilo (por código; no requiere sesión) ----
  if (b.action === 'mensaje') {
    if (rateLimited('denmsg:' + ip, 10)) return jsonErr(429, 'rate_limited', 'Demasiados mensajes seguidos');
    const codigo = String(b.codigo || '').trim().toUpperCase();
    const texto = String(b.texto || '').trim();
    if (!CODE_RE.test(codigo)) return jsonErr(400, 'bad_codigo', 'Código no válido');
    if (texto.length < 2 || texto.length > 4000) return jsonErr(400, 'invalid_texto', 'Mensaje entre 2 y 4000 caracteres');
    const d = await supa('GET', `denuncias?codigo=eq.${encodeURIComponent(codigo)}&select=estado,respuesta`);
    if (!d.json?.length) return jsonErr(404, 'not_found', 'Código no encontrado');
    if (d.json[0].estado === 'cerrada') return jsonErr(403, 'cerrada', 'El expediente está cerrado');
    // Turno: el informante solo puede escribir cuando el equipo ha respondido después de su último mensaje (uno por turno).
    const ult = await supa('GET', `denuncia_mensajes?codigo=eq.${encodeURIComponent(codigo)}&select=autor&order=created_at.desc&limit=1`);
    const ultimoAutor = (ult.json && ult.json[0]) ? ult.json[0].autor : (d.json[0].respuesta ? 'equipo' : null);
    if (ultimoAutor !== 'equipo') return jsonErr(409, 'espera_turno', 'Ya has enviado tu mensaje. Podrás responder cuando el equipo te conteste.');
    const ins = await supa('POST', 'denuncia_mensajes', { codigo, autor: 'ciudadano', texto });
    if (!ins.ok) return jsonErr(502, 'db_error', 'No se pudo enviar');
    sendEmail({
      to: process.env.CONTACT_INBOX || 'accioncivilgandia@gmail.com',
      subject: `[Canal de denuncias] Nuevo mensaje del informante (${codigo})`,
      html: emailShell({ title: 'Nuevo mensaje en un expediente', body: `<p>El informante del expediente <b>${esc(codigo)}</b> ha respondido en el hilo. Revísalo en el panel → Canal de denuncias.</p>` }),
    }).catch(() => {});
    return jsonOk({ ok: true });
  }

  // ---- alta de denuncia ----
  if (rateLimited(ip, 3)) return jsonErr(429, 'rate_limited', 'Demasiados envíos seguidos');
  if (b.hp) return jsonOk({ ok: true, codigo: 'ACG-RECIBIDA' });

  const categoria = CATS.includes(String(b.categoria)) ? String(b.categoria) : 'Otra irregularidad';
  const texto = String(b.texto || '').trim();
  let contacto = String(b.contacto || '').trim() || null;
  if (texto.length < 30 || texto.length > 8000) return jsonErr(400, 'invalid_texto', 'Describe los hechos con al menos 30 caracteres');
  if (contacto && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(contacto)) return jsonErr(400, 'invalid_contacto', 'El contacto debe ser un email válido (o déjalo vacío)');

  // Con sesión: la denuncia queda vinculada a la cuenta y el código llega por correo.
  const user = await getUser(req);
  if (user && !contacto) contacto = user.email;

  const codigo = 'ACG-' + randomBytes(4).toString('hex').toUpperCase();
  const ins = await supa('POST', 'denuncias', {
    codigo, categoria, texto, contacto,
    user_id: user ? user.id : null, email: user ? user.email : null,
  });
  if (!ins.ok) { console.error('denuncia insert fail', ins.status); return jsonErr(502, 'db_error', 'No se pudo registrar'); }

  let porEmail = false;
  if (user) {
    porEmail = true;
    sendEmail({
      to: user.email,
      subject: 'Tu código de seguimiento del canal confidencial',
      html: emailShell({ title: 'Denuncia registrada', body: `<p>Hemos registrado tu información de forma confidencial. Tu código de seguimiento es:</p>
        <p style="font:700 24px monospace;background:#0A2A5E;color:#F6BE18;border-radius:12px;padding:14px 20px;display:inline-block;letter-spacing:2px">${esc(codigo)}</p>
        <p>Puedes seguir el estado y la conversación desde <a href="https://accioncivilgandia.netlify.app/denuncias?ver=${esc(codigo)}">esta página</a> o desde tu área ciudadana.</p>` }),
    }).catch(() => {});
  }

  // Aviso al responsable del canal SIN el contenido (confidencialidad)
  await sendEmail({
    to: process.env.CONTACT_INBOX || 'accioncivilgandia@gmail.com',
    subject: '[Canal de denuncias] Nueva información recibida',
    html: emailShell({ title: 'Canal confidencial: nueva información', body: `<p>Se ha recibido una nueva información en el canal confidencial (categoría: <b>${esc(categoria)}</b>).</p>
      <p>Revísala en el panel → Canal de denuncias. Plazo de acuse: 7 días.</p>` }),
  }).catch(() => {});

  return jsonOk({ ok: true, codigo, porEmail });
};

export const config = { path: ['/denuncias', '/api/denuncias'] };
