// Canal interno de informaciones — Ley 2/2023.
// GET  /denuncias                  -> página con el formulario confidencial (HTML autocontenido)
// GET  /denuncias?codigo=ACG-XXXX  -> consulta de estado por código de seguimiento
// POST /api/denuncias              -> registra la denuncia y devuelve el código
// Anonimato: NO se registra IP ni user-agent en la base de datos. El rate limit usa IP
// solo en memoria del proceso. Aviso al responsable por email SIN el contenido.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY (opcional), CONTACT_INBOX
import { randomBytes } from 'node:crypto';
import { rateLimited, sendEmail } from './contacto.mjs';
import { supa, supaConfigured, jsonErr, jsonOk } from './lib/supa.mjs';

const CATS = ['Normativa interna', 'Financiación', 'Conflicto de interés', 'Acoso o trato degradante', 'Otra irregularidad'];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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
.code{font:700 22px monospace;background:#F0F4F9;border-radius:10px;padding:12px 18px;display:inline-block;color:#0A2A5E}</style></head>
<body>${inner}
<p style="text-align:center;margin:0 0 40px"><a href="/" style="color:#1563C4;font-size:14px">← Volver a accioncivilgandia</a></p>
</body></html>`, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });

const formPage = () => shell('Canal de denuncias', `
<div class="card">
  <h1>Canal confidencial de informaciones</h1>
  <p class="muted">Conforme a la Ley 2/2023. Puedes informar de forma <b>totalmente anónima</b>: no registramos tu IP ni ningún dato de conexión. Recibirás un código para seguir el estado. Acuse de recibo en un máximo de 7 días y respuesta en un máximo de 3 meses.</p>
  <form id="f">
    <label>Categoría</label>
    <select name="categoria">${CATS.map((c) => `<option>${c}</option>`).join('')}</select>
    <label>Descripción de los hechos (mínimo 30 caracteres)</label>
    <textarea name="texto" required minlength="30" placeholder="Describe qué ha ocurrido, cuándo y quién está implicado. Cuantos más detalles, mejor podremos investigarlo."></textarea>
    <label>Contacto (opcional — solo si quieres respuesta directa)</label>
    <input name="contacto" type="email" placeholder="Tu correo (puedes dejarlo vacío)">
    <input name="hp" style="display:none" tabindex="-1" autocomplete="off">
    <button type="submit">Enviar de forma confidencial</button>
    <div id="st" role="status" style="margin-top:14px;font-weight:600"></div>
  </form>
  <hr style="border:none;border-top:1px solid #EEF2F7;margin:28px 0">
  <p class="muted"><b>¿Ya tienes un código?</b> Consulta el estado:</p>
  <form id="q" style="display:flex;gap:8px">
    <input name="codigo" placeholder="ACG-XXXXXXXX" style="flex:1">
    <button type="submit" style="margin:0;padding:12px 20px">Consultar</button>
  </form>
  <div id="qr" style="margin-top:12px"></div>
</div>
<script>
document.getElementById('f').addEventListener('submit',async function(e){
  e.preventDefault();var st=document.getElementById('st');st.textContent='Enviando…';st.className='muted';
  var fd=new FormData(this);
  try{
    var r=await fetch('/api/denuncias',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({categoria:fd.get('categoria'),texto:fd.get('texto'),contacto:fd.get('contacto'),hp:fd.get('hp')})});
    var j=await r.json();
    if(r.ok&&j.ok){this.style.display='none';st.className='ok';
      st.innerHTML='Denuncia registrada de forma confidencial. Guarda tu código de seguimiento:<br><br><span class="code">'+j.codigo+'</span><br><br>Con él podrás consultar el estado en esta misma página.';}
    else{st.className='err';st.textContent=(j.error&&j.error.message)||'No se pudo registrar. Inténtalo más tarde.';}
  }catch(_){st.className='err';st.textContent='Error de conexión. Inténtalo más tarde.';}
});
document.getElementById('q').addEventListener('submit',async function(e){
  e.preventDefault();var qr=document.getElementById('qr');qr.textContent='Consultando…';
  var c=new FormData(this).get('codigo');
  var r=await fetch('/api/denuncias?codigo='+encodeURIComponent(c));var j=await r.json();
  if(r.ok&&j.ok){var est={nueva:'Recibida — pendiente de revisión',en_tramite:'En tramitación',cerrada:'Cerrada'}[j.estado]||j.estado;
    qr.innerHTML='<b>Estado:</b> '+est+(j.respuesta?('<br><b>Respuesta:</b> '+j.respuesta.replace(/</g,'&lt;')):'');}
  else qr.innerHTML='<span class="err">Código no encontrado.</span>';
});
</script>`);

export default async (req, context) => {
  const url = new URL(req.url);

  if (req.method === 'GET') {
    const codigo = (url.searchParams.get('codigo') || '').trim().toUpperCase();
    if (!codigo) return formPage();
    if (!supaConfigured()) return jsonErr(503, 'service_unconfigured', 'Canal no configurado');
    const q = await supa('GET', `denuncias?codigo=eq.${encodeURIComponent(codigo)}&select=estado,respuesta`);
    if (!q.ok || !q.json?.length) return jsonErr(404, 'not_found', 'Código no encontrado');
    return jsonOk({ ok: true, estado: q.json[0].estado, respuesta: q.json[0].respuesta });
  }

  if (req.method !== 'POST') return jsonErr(405, 'method_not_allowed', 'Método no permitido');
  const ip = context.ip || req.headers.get('x-nf-client-connection-ip') || '0.0.0.0';
  if (rateLimited(ip, 3)) return jsonErr(429, 'rate_limited', 'Demasiados envíos seguidos');
  if (!supaConfigured()) return jsonErr(503, 'service_unconfigured', 'Canal no configurado todavía');

  let b;
  try { b = await req.json(); } catch { return jsonErr(400, 'bad_json', 'Cuerpo inválido'); }
  if (b.hp) return jsonOk({ ok: true, codigo: 'ACG-RECIBIDA' });

  const categoria = CATS.includes(String(b.categoria)) ? String(b.categoria) : 'Otra irregularidad';
  const texto = String(b.texto || '').trim();
  const contacto = String(b.contacto || '').trim() || null;
  if (texto.length < 30 || texto.length > 8000) return jsonErr(400, 'invalid_texto', 'Describe los hechos con al menos 30 caracteres');
  if (contacto && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(contacto)) return jsonErr(400, 'invalid_contacto', 'El contacto debe ser un email válido (o déjalo vacío)');

  const codigo = 'ACG-' + randomBytes(4).toString('hex').toUpperCase();
  const ins = await supa('POST', 'denuncias', { codigo, categoria, texto, contacto });
  if (!ins.ok) { console.error('denuncia insert fail', ins.status); return jsonErr(502, 'db_error', 'No se pudo registrar'); }

  // Aviso al responsable del canal SIN contenido (confidencialidad)
  await sendEmail({
    to: process.env.CONTACT_INBOX || 'info@accioncivilgandia.org',
    subject: '[Canal de denuncias] Nueva información recibida',
    html: `<p>Se ha recibido una nueva información en el canal confidencial (categoría: <b>${esc(categoria)}</b>).</p>
      <p>Accede a la tabla <code>denuncias</code> de Supabase para revisarla. Plazo de acuse: 7 días.</p>`,
  }).catch(() => {});

  return jsonOk({ ok: true, codigo });
};

export const config = { path: ['/denuncias', '/api/denuncias'] };
