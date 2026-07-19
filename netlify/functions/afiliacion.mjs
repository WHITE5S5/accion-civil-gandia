// POST /api/afiliacion — alta de afiliado: ficha identificativa + Stripe Billing (Fase 4).
// NOTA Fase 3: cuando exista auth, exigir sesión Supabase y vincular user_id real.
// Env: STRIPE_SECRET_KEY, STRIPE_PRICE_CUOTA_{MENSUAL,ANUAL,REDUCIDA},
//      SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ENCRYPTION_KEY, APP_BASE_URL
import { rateLimited, verifyTurnstile } from './contacto.mjs';
import { supa, supaConfigured, stripe, stripeConfigured, validaDni, dniHash, encrypt, jsonErr, jsonOk } from './lib/supa.mjs';

// Cuotas mensuales: base (15 €) y media (30 €) con precio fijo; "libre" con importe elegido (≥30 €).
const PRICES = () => ({
  base: process.env.STRIPE_PRICE_CUOTA_BASE,
  media: process.env.STRIPE_PRICE_CUOTA_MEDIA,
});

export default async (req, context) => {
  if (req.method !== 'POST') return jsonErr(405, 'method_not_allowed', 'Solo POST');
  const ip = req.headers.get('cf-connecting-ip') || context.ip || req.headers.get('x-nf-client-connection-ip') || '0.0.0.0';
  if (rateLimited(ip, 5)) return jsonErr(429, 'rate_limited', 'Demasiados intentos');
  if (!stripeConfigured() || !supaConfigured() || !process.env.ENCRYPTION_KEY)
    return jsonErr(503, 'service_unconfigured', 'La afiliación online aún no está activa');

  let b;
  try { b = await req.json(); } catch { return jsonErr(400, 'bad_json', 'Cuerpo inválido'); }
  if (!b.aceptaEstatutos || !b.aceptaPrivacidadArt9)
    return jsonErr(400, 'consentimiento_requerido', 'Debes aceptar los estatutos y el tratamiento de datos (art. 9 RGPD)');

  const nombre = String(b.nombre || '').trim();
  const apellidos = String(b.apellidos || '').trim();
  const email = String(b.email || '').trim();
  const dni = validaDni(b.dni);
  const direccion = String(b.direccion || '').trim();
  const cp = String(b.cp || '').trim();
  const cuotaTipo = ['base', 'media', 'libre'].includes(b.cuotaTipo) ? b.cuotaTipo : null;
  const fnac = String(b.fechaNacimiento || '');

  if (nombre.length < 2 || apellidos.length < 2) return jsonErr(400, 'invalid_nombre', 'Nombre y apellidos obligatorios');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return jsonErr(400, 'invalid_email', 'Email no válido');
  if (!dni) return jsonErr(400, 'invalid_dni', 'DNI/NIE no válido');
  if (direccion.length < 5 || !/^\d{5}$/.test(cp)) return jsonErr(400, 'invalid_direccion', 'Dirección y código postal obligatorios');
  if (!cuotaTipo) return jsonErr(400, 'invalid_cuota', 'Tipo de cuota no válido');
  const edad = (Date.now() - new Date(fnac).getTime()) / 31557600000;
  if (!(edad >= 18)) return jsonErr(400, 'menor_de_edad', 'Debes ser mayor de 18 años');
  if (!(await verifyTurnstile(b.turnstileToken, ip))) return jsonErr(403, 'turnstile_failed', 'Verificación anti-spam fallida');

  let lineItem;
  if (cuotaTipo === 'libre') {
    const imp = Math.round(Number(b.importeCents));
    if (!Number.isFinite(imp) || imp < 3000 || imp > 5000000)
      return jsonErr(400, 'invalid_importe', 'La cuota libre debe ser de 30 € o más al mes');
    lineItem = { quantity: 1, price_data: { currency: 'eur', unit_amount: imp, recurring: { interval: 'month' }, product: process.env.STRIPE_PRODUCT_CUOTA } };
  } else {
    const price = PRICES()[cuotaTipo];
    if (!price) return jsonErr(503, 'service_unconfigured', 'Cuota no configurada en Stripe');
    lineItem = { price, quantity: 1 };
  }

  // Deduplicar por DNI
  const hash = dniHash(dni);
  const dup = await supa('GET', `members?dni_hash=eq.${hash}&estado=neq.baja&select=id`);
  if (!dup.ok) { console.error('supa fail', dup.status, dup.text); return jsonErr(502, 'db_error', 'Error interno'); }
  if ((dup.json || []).length) return jsonErr(409, 'member_exists', 'Ya existe una afiliación activa con ese DNI. Escríbenos si crees que es un error.');

  // Fase 4 sin auth todavía: crear un profile "shadow" no es posible sin auth.users.
  // Registro provisional en members con user_id null NO permitido por el esquema =>
  // guardamos la ficha en una tabla puente si existe, o exigimos Fase 3 completada.
  // Diseño actual: la Function crea el Customer + Checkout y la ficha viaja en metadata;
  // el webhook la persiste al confirmarse el pago (members se crea allí con el user
  // que el equipo vincule). Para el arranque es suficiente y no pierde datos.
  const cust = await stripe('customers', {
    email, name: `${nombre} ${apellidos}`,
    metadata: { dni_hash: hash, cuota_tipo: cuotaTipo },
  });
  if (!cust.ok) { console.error('stripe cust fail', JSON.stringify(cust.json).slice(0, 300)); return jsonErr(502, 'stripe_error', 'Error creando cliente'); }

  const base = process.env.APP_BASE_URL || new URL(req.url).origin;
  const s = await stripe('checkout/sessions', {
    mode: 'subscription',
    customer: cust.json.id,
    'line_items[0]': lineItem,
    // Cuotas SOLO por domiciliación bancaria SEPA (decisión del partido: recurrente real,
    // 0,35 € fijo vs comisión de tarjeta). SEPA verificado y activo en la cuenta 2026-07-15.
    'payment_method_types[0]': 'sepa_debit',
    subscription_data: {
      metadata: {
        dni_encrypted: encrypt(dni), dni_hash: hash,
        nombre, apellidos, direccion, cp,
        telefono: String(b.telefono || ''), fecha_nacimiento: fnac,
        cuota_tipo: cuotaTipo, consent_ts: new Date().toISOString(),
      },
    },
    success_url: `${base}/participa?afiliacion=ok`,
    cancel_url: `${base}/participa?afiliacion=cancelada`,
  });
  if (!s.ok) { console.error('stripe sess fail', JSON.stringify(s.json).slice(0, 300)); return jsonErr(502, 'stripe_error', 'No se pudo iniciar el pago'); }

  await supa('POST', 'consents', { email, tipo: 'afiliacion', texto_version: 'afiliacion-v1', ip });
  return jsonOk({ ok: true, checkoutUrl: s.json.url });
};

export const config = { path: '/api/afiliacion' };
