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
import chat from '../netlify/functions/chat.mjs';
import donaciones from '../netlify/functions/donaciones.mjs';
import afiliacion from '../netlify/functions/afiliacion.mjs';
import stripeWebhook from '../netlify/functions/stripe-webhook.mjs';
import { validaDni } from '../netlify/functions/lib/supa.mjs';

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

console.log('== propuesta (F3: exige sesión) ==');
await check('categoría inválida', await propuesta(post('/api/propuesta', { titulo: 'Más bancos en el parque', descripcion: 'x'.repeat(40), categoria: 'Inventada', barrio: 'Centro' }), { ip: '3.3.3.3' }), 400, 'invalid_categoria');
await check('sin sesión -> 401', await propuesta(post('/api/propuesta', { titulo: 'Más bancos en el parque', descripcion: 'Propuesta de ejemplo con descripción suficientemente larga para pasar validación.', categoria: 'Medio ambiente', barrio: 'Centro' }), { ip: '3.3.3.4' }), 401, 'login_required');

console.log('== fase 2 content ==');
await check('posts GET', await posts(new Request('http://local/api/posts?lang=es')), 200, true);
await check('events GET', await events(new Request('http://local/api/events?lang=va')), 200, true);
await check('campaigns GET', await campaigns(new Request('http://local/api/campaigns?lang=es')), 200, true);
await check('actuaciones GET', await actuaciones(new Request('http://local/api/actuaciones?lang=es')), 200, true);
await check('equipo GET', await equipo(new Request('http://local/api/equipo?lang=va')), 200, true);
await check('home GET', await home(new Request('http://local/api/home?lang=es')), 200, true);

console.log('== chat (F3) ==');
await check('sin Supabase -> 503', await chat(new Request('http://local/api/chat'), ctx), 503, 'unconfigured');
process.env.SUPABASE_URL = 'http://127.0.0.1:1';           // simula configurado pero inaccesible
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
await check('GET sin sesión -> 401', await chat(new Request('http://local/api/chat'), ctx), 401, 'login_required');
await check('POST sin sesión -> 401', await chat(post('/api/chat', { texto: 'hola' }), ctx), 401, 'login_required');
delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log('== rate limit ==');
let last;
for (let i = 0; i < 12; i++) last = await contacto(post('/api/contacto', { nombre: 'Ana', email: 'a@b.co', mensaje: 'mensaje repetido de prueba xxx' }), { ip: '9.9.9.9' });
await check('12ª petición -> 429', last, 429, 'rate_limited');

console.log('== stripe F4 (sin claves -> guard 503) ==');
await check('donaciones GET -> 405', await donaciones(new Request('http://local/api/donaciones'), { ip: '7.0.0.1' }), 405);
await check('donaciones sin claves -> 503', await donaciones(post('/api/donaciones', {}), { ip: '7.0.0.2' }), 503, 'service_unconfigured');
await check('afiliacion GET -> 405', await afiliacion(new Request('http://local/api/afiliacion'), { ip: '7.0.0.3' }), 405);
await check('afiliacion sin claves -> 503', await afiliacion(post('/api/afiliacion', {}), { ip: '7.0.0.4' }), 503, 'service_unconfigured');
await check('webhook sin secret -> 503', await stripeWebhook(post('/api/stripe/webhook', {})), 503);
console.log('== LO 8/2007: validación de DNI/NIE ==');
console.log(validaDni('12345678Z') ? '  OK  DNI válido aceptado' : (fail++, '  FAIL DNI válido')); pass++;
console.log(!validaDni('12345678A') ? '  OK  DNI con letra errónea rechazado' : (fail++, '  FAIL letra DNI')); pass++;
console.log(validaDni('X1234567L') ? '  OK  NIE válido aceptado' : (fail++, '  FAIL NIE válido')); pass++;
console.log(!validaDni('00000000') ? '  OK  DNI sin letra rechazado' : (fail++, '  FAIL DNI sin letra')); pass++;

console.log(`\nRESULTADO: ${pass} OK, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
