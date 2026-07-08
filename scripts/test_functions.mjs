// Harness local de las Netlify Functions (sin servicios externos configurados).
// Uso: node scripts/test_functions.mjs
import contacto from '../netlify/functions/contacto.mjs';
import newsletter, { signToken, verifyToken } from '../netlify/functions/newsletter.mjs';
import confirm from '../netlify/functions/newsletter-confirm.mjs';
import propuesta from '../netlify/functions/propuesta.mjs';
import posts from '../netlify/functions/posts.mjs';
import events from '../netlify/functions/events.mjs';
import campaigns from '../netlify/functions/campaigns.mjs';
import actuaciones from '../netlify/functions/actuaciones.mjs';
import equipo from '../netlify/functions/equipo.mjs';
import home from '../netlify/functions/home.mjs';

const ctx = { ip: '1.2.3.4' };
const post = (url, body) => new Request(`http://local${url}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});
let pass = 0, fail = 0;
const check = async (name, res, wantStatus, wantCode) => {
  const j = await res.clone().json().catch(() => ({}));
  const okS = res.status === wantStatus;
  const okC = !wantCode || (j.error && j.error.code === wantCode) || j.ok === wantCode;
  if (okS && okC) { pass++; console.log(`  OK  ${name} -> ${res.status}`); }
  else { fail++; console.log(`  FAIL ${name} -> ${res.status} ${JSON.stringify(j).slice(0, 120)} (esperaba ${wantStatus}/${wantCode})`); }
};

console.log('== contacto ==');
await check('GET rechazado', await contacto(new Request('http://local/api/contacto'), ctx), 405);
await check('JSON inválido', await contacto(new Request('http://local/api/contacto', { method: 'POST', body: 'x' }), ctx), 400);
await check('nombre corto', await contacto(post('/api/contacto', { nombre: 'A', email: 'a@b.co', mensaje: 'hola que tal todo bien' }), ctx), 400, 'invalid_nombre');
await check('email malo', await contacto(post('/api/contacto', { nombre: 'Ana', email: 'nope', mensaje: 'hola que tal todo bien' }), ctx), 400, 'invalid_email');
await check('mensaje corto', await contacto(post('/api/contacto', { nombre: 'Ana', email: 'a@b.co', mensaje: 'hey' }), ctx), 400, 'invalid_mensaje');
await check('honeypot silencioso', await contacto(post('/api/contacto', { hp: 'bot' }), ctx), 200);
await check('válido sin Resend -> 503', await contacto(post('/api/contacto', { nombre: 'Ana', apellidos: 'García', email: 'a@b.co', asunto: 'Prueba', mensaje: 'Mensaje de prueba suficientemente largo.' }), ctx), 503, 'service_unconfigured');

console.log('== newsletter ==');
await check('email malo', await newsletter(post('/api/newsletter', { email: 'x' }), { ip: '2.2.2.2' }), 400, 'invalid_email');
await check('sin secret -> 503', await newsletter(post('/api/newsletter', { email: 'a@b.co' }), { ip: '2.2.2.2' }), 503, 'service_unconfigured');
process.env.NEWSLETTER_SECRET = 'test-secret';
await check('con secret sin Resend -> 503', await newsletter(post('/api/newsletter', { email: 'a@b.co', lang: 'va' }), { ip: '2.2.2.3' }), 503, 'service_unconfigured');

console.log('== tokens HMAC ==');
const tk = signToken({ email: 'a@b.co', lang: 'es', ts: Date.now() }, 'test-secret');
console.log(verifyToken(tk, 'test-secret') ? '  OK  token válido verifica' : (fail++, '  FAIL token válido'));
console.log(!verifyToken(tk, 'otro-secret') ? '  OK  firma incorrecta rechazada' : (fail++, '  FAIL firma'));
console.log(!verifyToken(signToken({ email: 'a@b.co', ts: Date.now() - 49 * 3600e3 }, 'test-secret'), 'test-secret') ? '  OK  token caducado rechazado' : (fail++, '  FAIL caducidad'));
pass += 3;

console.log('== newsletter-confirm ==');
await check('token inválido -> página 400', await confirm(new Request('http://local/api/newsletter-confirm?t=basura')), 400);
const good = await confirm(new Request(`http://local/api/newsletter-confirm?t=${tk}`));
const html = await good.text();
await check('token válido sin Brevo -> aviso', new Response(html, { status: good.status }), 400);
console.log(html.includes('Casi listo') ? '  OK  página "Casi listo" (Brevo sin configurar)' : (fail++, '  FAIL página confirm'));
pass++;

console.log('== propuesta ==');
await check('categoría inválida', await propuesta(post('/api/propuesta', { titulo: 'Más bancos en el parque', descripcion: 'x'.repeat(40), categoria: 'Inventada', barrio: 'Centro', nombre: 'Ana', email: 'a@b.co' }), { ip: '3.3.3.3' }), 400, 'invalid_categoria');
await check('válida sin Resend -> 503', await propuesta(post('/api/propuesta', { titulo: 'Más bancos en el parque', descripcion: 'Propuesta de ejemplo con descripción suficientemente larga para pasar validación.', categoria: 'Medio ambiente', barrio: 'Centro', nombre: 'Ana', email: 'a@b.co' }), { ip: '3.3.3.4' }), 503, 'service_unconfigured');
await check('anónima OK', await propuesta(post('/api/propuesta', { titulo: 'Más bancos en el parque', descripcion: 'Propuesta de ejemplo con descripción suficientemente larga para pasar validación.', categoria: 'Medio ambiente', barrio: 'Centro', anonimo: true, email: 'a@b.co' }), { ip: '3.3.3.5' }), 503, 'service_unconfigured');

console.log('== fase 2 content ==');
await check('posts GET', await posts(new Request('http://local/api/posts?lang=es')), 200, true);
await check('events GET', await events(new Request('http://local/api/events?lang=va')), 200, true);
await check('campaigns GET', await campaigns(new Request('http://local/api/campaigns?lang=es')), 200, true);
await check('actuaciones GET', await actuaciones(new Request('http://local/api/actuaciones?lang=es')), 200, true);
await check('equipo GET', await equipo(new Request('http://local/api/equipo?lang=va')), 200, true);
await check('home GET', await home(new Request('http://local/api/home?lang=es')), 200, true);

console.log('== rate limit ==');
let last;
for (let i = 0; i < 12; i++) last = await contacto(post('/api/contacto', { nombre: 'Ana', email: 'a@b.co', mensaje: 'mensaje repetido de prueba xxx' }), { ip: '9.9.9.9' });
await check('12ª petición -> 429', last, 429, 'rate_limited');

console.log(`\nRESULTADO: ${pass} OK, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
