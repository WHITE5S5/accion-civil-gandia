// POST /api/stripe/webhook — eventos de Stripe (Fase 4).
// Firma verificada + idempotencia por event.id (tabla stripe_events).
// Env: STRIPE_WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY
import { sendEmail } from './contacto.mjs';
import { supa, supaConfigured, verifyStripeSignature, jsonOk } from './lib/supa.mjs';

const audit = (accion, tabla, registro_id, detalle) =>
  supa('POST', 'audit_log', { accion, tabla, registro_id: String(registro_id || ''), detalle }).catch(() => {});

export default async (req) => {
  if (req.method !== 'POST') return new Response('Solo POST', { status: 405 });
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !supaConfigured()) return new Response('No configurado', { status: 503 });

  const payload = await req.text();
  if (!verifyStripeSignature(payload, req.headers.get('stripe-signature'), secret))
    return new Response('Firma inválida', { status: 400 });

  const event = JSON.parse(payload);

  // Idempotencia: si el evento ya se procesó, 200 y fuera
  const dup = await supa('POST', 'stripe_events', { id: event.id });
  if (!dup.ok && dup.status === 409) return jsonOk({ ok: true, duplicated: true });

  const obj = event.data.object;
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        if (obj.mode === 'payment' && obj.metadata?.donation_id) {
          // Donación pagada
          await supa('PATCH', `donations?id=eq.${obj.metadata.donation_id}`, {
            estado: 'pagada', stripe_payment_intent: String(obj.payment_intent || ''),
          });
          const d = await supa('GET', `donations?id=eq.${obj.metadata.donation_id}&select=donor_nombre,donor_email,importe_cents`);
          const don = d.json?.[0];
          if (don) {
            await sendEmail({
              to: don.donor_email,
              subject: 'Recibo de tu donación — Acción Civil Gandia',
              html: `<p>Hola ${don.donor_nombre},</p>
                <p>Hemos recibido tu donación de <b>${(don.importe_cents / 100).toFixed(2)} €</b> a Acción Civil Gandia. Gracias por tu apoyo.</p>
                <p>Las donaciones a partidos políticos dan derecho a deducción en el IRPF (LO 8/2007). Guarda este correo como justificante; el certificado fiscal anual se emite a comienzos del ejercicio siguiente.</p>`,
            });
            await supa('PATCH', `donations?id=eq.${obj.metadata.donation_id}`, { certificado_enviado: true });
          }
          await audit('donacion_pagada', 'donations', obj.metadata.donation_id, { pi: obj.payment_intent });
        }
        if (obj.mode === 'subscription') {
          await audit('checkout_suscripcion_completado', 'members', obj.customer, { subscription: obj.subscription });
          // La ficha del afiliado viaja en subscription.metadata; se consolida en invoice.paid.
        }
        break;
      }
      case 'invoice.paid': {
        const sub = obj.subscription, cust = obj.customer;
        // Buscar member por stripe_customer_id; si no existe, crearlo desde metadata de la suscripción
        let m = await supa('GET', `members?stripe_customer_id=eq.${cust}&select=id,estado`);
        if ((m.json || []).length === 0 && sub) {
          const sr = await fetch(`https://api.stripe.com/v1/subscriptions/${sub}`, {
            headers: { authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
          }).then((r) => r.json()).catch(() => null);
          const md = sr?.metadata || {};
          if (md.dni_hash) {
            // profiles/auth llega en Fase 3; hasta entonces el equipo vincula user_id a mano.
            // Guardamos la ficha completa para no perder el alta:
            await supa('POST', 'members_inbox', {
              dni_encrypted: md.dni_encrypted, dni_hash: md.dni_hash,
              nombre: md.nombre, apellidos: md.apellidos,
              direccion: md.direccion, cp: md.cp, telefono: md.telefono,
              fecha_nacimiento: md.fecha_nacimiento || null,
              cuota_tipo: md.cuota_tipo, consent_estatutos_at: md.consent_ts,
              stripe_customer_id: cust, stripe_subscription_id: sub,
              estado: 'activo',
            }).then((r) => { if (!r.ok) console.error('members_inbox fail (crear tabla — ver 002_members_inbox.sql)', r.status); });
          }
        } else if ((m.json || []).length) {
          await supa('PATCH', `members?stripe_customer_id=eq.${cust}`, { estado: 'activo' });
          await supa('POST', 'payments', {
            member_id: m.json[0].id, stripe_invoice_id: obj.id,
            importe_cents: obj.amount_paid, estado: 'pagado',
            periodo_inicio: obj.lines?.data?.[0]?.period?.start ? new Date(obj.lines.data[0].period.start * 1000).toISOString().slice(0, 10) : null,
            periodo_fin: obj.lines?.data?.[0]?.period?.end ? new Date(obj.lines.data[0].period.end * 1000).toISOString().slice(0, 10) : null,
          });
        }
        if (obj.customer_email) {
          await sendEmail({
            to: obj.customer_email,
            subject: 'Recibo de tu cuota — Acción Civil Gandia',
            html: `<p>Cuota de afiliación cobrada correctamente: <b>${(obj.amount_paid / 100).toFixed(2)} €</b>. Gracias por formar parte.</p>`,
          });
        }
        await audit('cuota_pagada', 'payments', obj.id, { customer: cust, amount: obj.amount_paid });
        break;
      }
      case 'invoice.payment_failed': {
        await supa('PATCH', `members?stripe_customer_id=eq.${obj.customer}`, { estado: 'impago' });
        if (obj.customer_email) {
          await sendEmail({
            to: obj.customer_email,
            subject: 'Problema con tu cuota — Acción Civil Gandia',
            html: '<p>No hemos podido cobrar tu cuota de afiliación. Stripe lo reintentará automáticamente; si el problema persiste, actualiza tu método de pago desde el enlace de gestión o contáctanos en info@accioncivilgandia.org.</p>',
          });
        }
        await audit('cuota_impagada', 'members', obj.customer, { invoice: obj.id });
        break;
      }
      case 'customer.subscription.deleted': {
        await supa('PATCH', `members?stripe_customer_id=eq.${obj.customer}`, {
          estado: 'baja', fecha_baja: new Date().toISOString(),
        });
        await audit('baja_afiliado', 'members', obj.customer, { subscription: obj.id });
        break;
      }
      case 'charge.refunded': {
        if (obj.metadata?.donation_id)
          await supa('PATCH', `donations?id=eq.${obj.metadata.donation_id}`, { estado: 'reembolsada' });
        await audit('reembolso', 'donations', obj.metadata?.donation_id, { charge: obj.id });
        break;
      }
      case 'charge.dispute.created': {
        await sendEmail({
          to: process.env.CONTACT_INBOX || 'info@accioncivilgandia.org',
          subject: '⚠ URGENTE: disputa de pago en Stripe',
          html: `<p>Se ha abierto una disputa sobre el cargo <b>${obj.charge || obj.id}</b> (${(obj.amount / 100).toFixed(2)} €). Revisar en el dashboard de Stripe — hay plazo para responder.</p>`,
        });
        await audit('disputa', 'stripe', obj.id, { amount: obj.amount });
        break;
      }
      default:
        break; // evento no manejado: 200 igualmente
    }
  } catch (e) {
    console.error('webhook handler error', event.type, e);
    // 500 => Stripe reintenta (el insert en stripe_events ya está hecho: quitarlo para permitir retry)
    await supa('DELETE', `stripe_events?id=eq.${event.id}`);
    return new Response('Error interno', { status: 500 });
  }
  return jsonOk();
};

export const config = { path: '/api/stripe/webhook' };
