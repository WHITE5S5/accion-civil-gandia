// POST /api/donaciones — donación puntual conforme LO 8/2007 (Fase 4).
// Identificación completa ANTES del pago; límite 50.000 €/año por DNI; Stripe Checkout.
// Env: STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ENCRYPTION_KEY, APP_BASE_URL
import { rateLimited, verifyTurnstile } from './contacto.mjs';
import { supa, supaConfigured, stripe, stripeConfigured, validaDni, dniHash, encrypt, jsonErr, jsonOk } from './lib/supa.mjs';

const LIMITE_ANUAL_CENTS = 5_000_000;   // 50.000 € — art. 5 LO 8/2007
const MIN_CENTS = 500, MAX_CENTS = 1_000_000;

export default async (req, context) => {
  if (req.method !== 'POST') return jsonErr(405, 'method_not_allowed', 'Solo POST');
  const ip = context.ip || req.headers.get('x-nf-client-connection-ip') || '0.0.0.0';
  if (rateLimited(ip, 5)) return jsonErr(429, 'rate_limited', 'Demasiados intentos');
  if (!stripeConfigured() || !supaConfigured() || !process.env.ENCRYPTION_KEY)
    return jsonErr(503, 'service_unconfigured', 'Las donaciones aún no están activas');

  let b;
  try { b = await req.json(); } catch { return jsonErr(400, 'bad_json', 'Cuerpo inválido'); }

  // Las 3 declaraciones responsables son obligatorias (checkboxes NO premarcados)
  if (!b.declaracionPersonaFisica || !b.declaracionFondosPropios || !b.declaracionLimiteAnual)
    return jsonErr(400, 'declaraciones_requeridas', 'Debes aceptar las tres declaraciones legales');

  const nombre = String(b.nombre || '').trim();
  const apellidos = String(b.apellidos || '').trim();
  const email = String(b.email || '').trim();
  const dni = validaDni(b.dni);
  const importe = Math.round(Number(b.importeCents));

  if (nombre.length < 2 || apellidos.length < 2) return jsonErr(400, 'invalid_nombre', 'Nombre y apellidos obligatorios');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return jsonErr(400, 'invalid_email', 'Email no válido');
  if (!dni) return jsonErr(400, 'invalid_dni', 'DNI/NIE no válido');
  if (!Number.isFinite(importe) || importe < MIN_CENTS || importe > MAX_CENTS)
    return jsonErr(400, 'invalid_importe', 'Importe entre 5 € y 10.000 € por operación');
  if (!(await verifyTurnstile(b.turnstileToken, ip))) return jsonErr(403, 'turnstile_failed', 'Verificación anti-spam fallida');

  // Límite anual acumulado por DNI (solo donaciones pagadas del ejercicio)
  const hash = dniHash(dni);
  const ejercicio = new Date().getFullYear();
  const q = await supa('GET', `donations?donor_dni_hash=eq.${hash}&ejercicio=eq.${ejercicio}&estado=eq.pagada&select=importe_cents`);
  if (!q.ok) { console.error('supa query fail', q.status, q.text); return jsonErr(502, 'db_error', 'Error interno'); }
  const acumulado = (q.json || []).reduce((s, d) => s + d.importe_cents, 0);
  if (acumulado + importe > LIMITE_ANUAL_CENTS)
    return jsonErr(422, 'limite_anual_excedido',
      'La ley de financiación de partidos (LO 8/2007) limita las donaciones a 50.000 € por persona y año. Esta donación superaría tu límite anual.');

  // Registrar donación 'iniciada' con identificación cifrada
  const ins = await supa('POST', 'donations', {
    donor_nombre: nombre, donor_apellidos: apellidos,
    donor_dni_encrypted: encrypt(dni), donor_dni_hash: hash,
    donor_email: email, importe_cents: importe, ejercicio,
    declaracion_persona_fisica: true, declaracion_fondos_propios: true,
    estado: 'iniciada',
  });
  if (!ins.ok) { console.error('supa insert fail', ins.status, ins.text); return jsonErr(502, 'db_error', 'Error interno'); }
  const donationId = ins.json[0].id;
  await supa('POST', 'consents', { email, tipo: 'donacion', texto_version: 'donacion-v1', ip });

  // Stripe Checkout (one-off)
  const base = process.env.APP_BASE_URL || new URL(req.url).origin;
  const s = await stripe('checkout/sessions', {
    mode: 'payment',
    customer_email: email,
    'line_items[0]': {
      quantity: 1,
      price_data: {
        currency: 'eur', unit_amount: importe,
        product_data: { name: 'Donación a Acción Civil Gandia' },
      },
    },
    metadata: { donation_id: donationId },
    payment_intent_data: { metadata: { donation_id: donationId } },
    success_url: `${base}/participa?donacion=ok`,
    cancel_url: `${base}/donar?cancelada=1`,
  });
  if (!s.ok) { console.error('stripe fail', s.status, JSON.stringify(s.json).slice(0, 300)); return jsonErr(502, 'stripe_error', 'No se pudo iniciar el pago'); }
  return jsonOk({ ok: true, checkoutUrl: s.json.url });
};

export const config = { path: '/api/donaciones' };
