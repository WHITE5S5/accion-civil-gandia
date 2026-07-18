// POST /api/stripe/webhook — eventos de Stripe (Fase 4).
// Firma verificada + idempotencia por event.id (tabla stripe_events).
// Env: STRIPE_WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY
import { sendEmail, emailShell } from './contacto.mjs';
import { supa, supaConfigured, verifyStripeSignature, jsonOk } from './lib/supa.mjs';

const audit = (accion, tabla, registro_id, detalle) =>
  supa('POST', 'audit_log', { accion, tabla, registro_id: String(registro_id || ''), detalle }).catch(() => {});

// Marca un título (es_donante/es_afiliado) en la cuenta cuyo email coincide. Best-effort: nunca rompe el webhook.
async function marcarTituloPorEmail(email, patch) {
  try {
    const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const e = String(email || '').trim().toLowerCase();
    if (!e) return;
    const r = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(e)}`, { headers: { apikey: k, authorization: `Bearer ${k}` } });
    const j = await r.json().catch(() => ({}));
    const u = (j.users || []).find((x) => String(x.email || '').toLowerCase() === e);
    if (u) await supa('PATCH', `profiles?id=eq.${u.id}`, patch);
  } catch { /* no-op */ }
}

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
        if (obj.metadata?.tipo === 'tienda' && obj.metadata?.order_id) {
          // Pedido de la tienda pagado
          const orderId = obj.metadata.order_id;
          const oq = await supa('GET', `orders?id=eq.${orderId}&select=id,numero,email,nombre,estado,metodo_entrega,total_cents`);
          const order = oq.json?.[0];
          if (order && order.estado !== 'pagado') {
            const dir = order.metodo_entrega === 'envio'
              ? (obj.shipping_details || obj.customer_details || null) : null;
            await supa('PATCH', `orders?id=eq.${orderId}`, {
              estado: 'pagado', paid_at: new Date().toISOString(),
              stripe_payment_intent: String(obj.payment_intent || ''),
              ...(dir ? { direccion: dir } : {}),
            });

            // Descontar stock (idempotente: solo entramos aquí si no estaba 'pagado')
            const iq = await supa('GET', `order_items?order_id=eq.${orderId}&select=variant_id,cantidad,nombre,talla,precio_cents`);
            const oItems = iq.json || [];
            for (const it of oItems) {
              if (!it.variant_id) continue;
              const vq = await supa('GET', `product_variants?id=eq.${it.variant_id}&select=stock`);
              const stock = Number(vq.json?.[0]?.stock ?? 0);
              const nuevo = Math.max(0, stock - Number(it.cantidad || 0));
              await supa('PATCH', `product_variants?id=eq.${it.variant_id}`, { stock: nuevo });
            }

            // Ingreso en Tesorería
            const importe = Number(obj.amount_total || order.total_cents || 0);
            if (importe > 0) {
              await supa('POST', 'tesoreria', {
                fecha: new Date().toISOString().slice(0, 10), tipo: 'ingreso',
                categoria: 'Tienda', concepto: 'Venta merchandising · ' + order.numero,
                importe_cents: importe,
              });
            }

            // Email de confirmación al comprador
            const dest = order.email || obj.customer_details?.email || obj.customer_email;
            if (dest) {
              const lineas = oItems.map((it) => `<tr><td style="padding:4px 0">${it.nombre}${it.talla ? ' · ' + it.talla : ''} × ${it.cantidad}</td><td style="padding:4px 0;text-align:right">${((it.precio_cents * it.cantidad) / 100).toFixed(2)} €</td></tr>`).join('');
              const entrega = order.metodo_entrega === 'envio' ? 'Envío a domicilio' : 'Recogida en local';
              await sendEmail({
                to: dest,
                subject: `Pedido ${order.numero} confirmado — Acción Civil Gandia`,
                html: emailShell({ title: '¡Gracias por tu pedido!', body: `<p>Hola ${order.nombre || ''},</p>
                  <p>Hemos recibido tu pedido <b>${order.numero}</b> correctamente.</p>
                  <table style="width:100%;border-collapse:collapse;font-size:14px;margin:10px 0">${lineas}
                    <tr><td style="padding:8px 0;border-top:1px solid #E4EBF2;font-weight:bold">Total</td><td style="padding:8px 0;border-top:1px solid #E4EBF2;text-align:right;font-weight:bold">${(importe / 100).toFixed(2)} €</td></tr></table>
                  <p><b>Entrega:</b> ${entrega}.</p>
                  <p>Te avisaremos cuando esté listo. Gracias por apoyar a Acción Civil Gandia.</p>` }),
              });
            }
            await audit('pedido_pagado', 'orders', orderId, { pi: obj.payment_intent, total: importe });
          }
          break;
        }
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
              html: emailShell({ title: 'Recibo de tu donación', body: `<p>Hola ${don.donor_nombre},</p>
                <p>Hemos recibido tu donación de <b>${(don.importe_cents / 100).toFixed(2)} €</b> a Acción Civil Gandia. Gracias por tu apoyo.</p>
                <p>Las donaciones a partidos políticos dan derecho a deducción en el IRPF (LO 8/2007). Guarda este correo como justificante; el certificado fiscal anual se emite a comienzos del ejercicio siguiente.</p>` }),
            });
            await supa('PATCH', `donations?id=eq.${obj.metadata.donation_id}`, { certificado_enviado: true });
          }
          await audit('donacion_pagada', 'donations', obj.metadata.donation_id, { pi: obj.payment_intent });
          if (don) await marcarTituloPorEmail(don.donor_email, { es_donante: true });   // título "donante" en su cuenta
        }
        if (obj.mode === 'subscription') {
          await audit('checkout_suscripcion_completado', 'members', obj.customer, { subscription: obj.subscription });
          // La ficha del afiliado viaja en subscription.metadata; se consolida en invoice.paid.
        }
        break;
      }
      case 'invoice.paid': {
        // API 2025+: invoice.subscription ya no llega arriba; viene en parent.subscription_details
        const sub = obj.subscription || obj.parent?.subscription_details?.subscription || '';
        const cust = obj.customer;
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
            html: emailShell({ title: 'Cuota de afiliación cobrada', body: `<p>Cuota de afiliación cobrada correctamente: <b>${(obj.amount_paid / 100).toFixed(2)} €</b>. Gracias por formar parte.</p>` }),
          });
        }
        await audit('cuota_pagada', 'payments', obj.id, { customer: cust, amount: obj.amount_paid });
        await marcarTituloPorEmail(obj.customer_email, { es_afiliado: true });   // título "afiliado" en su cuenta
        break;
      }
      case 'invoice.payment_failed': {
        await supa('PATCH', `members?stripe_customer_id=eq.${obj.customer}`, { estado: 'impago' });
        if (obj.customer_email) {
          await sendEmail({
            to: obj.customer_email,
            subject: 'Problema con tu cuota — Acción Civil Gandia',
            html: emailShell({ title: 'Problema con el cobro de tu cuota', body: '<p>No hemos podido cobrar tu cuota de afiliación. Stripe lo reintentará automáticamente; si el problema persiste, actualiza tu método de pago desde el enlace de gestión o contáctanos en accioncivilgandia@gmail.com.</p>' }),
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
          to: process.env.CONTACT_INBOX || 'accioncivilgandia@gmail.com',
          subject: '⚠ URGENTE: disputa de pago en Stripe',
          html: emailShell({ title: 'Disputa de pago abierta', body: `<p>Se ha abierto una disputa sobre el cargo <b>${obj.charge || obj.id}</b> (${(obj.amount / 100).toFixed(2)} €). Revisar en el dashboard de Stripe — hay plazo para responder.</p>` }),
        });
        await audit('disputa', 'stripe', obj.id, { amount: obj.amount });
        break;
      }
      case 'payout.paid': {
        // Stripe ha ingresado el saldo en la cuenta del partido (día 1 del mes).
        // Se liquidan las donaciones y cuotas pendientes y se registran en Tesorería.
        const fecha = new Date((obj.arrival_date || obj.created) * 1000).toISOString().slice(0, 10);
        const ahora = new Date().toISOString();
        const inList = (arr) => '(' + arr.map((x) => x.id).join(',') + ')';

        // 1) Donaciones cobradas aún no liquidadas
        const dq = await supa('GET', 'donations?estado=eq.pagada&liquidada_at=is.null&select=id,importe_cents');
        const dons = dq.json || [];
        const dTotal = dons.reduce((s, d) => s + (d.importe_cents || 0), 0);
        if (dons.length) {
          await supa('POST', 'tesoreria', {
            fecha, tipo: 'ingreso', categoria: 'Donaciones',
            concepto: 'Liquidación Stripe · ' + dons.length + ' ' + (dons.length === 1 ? 'donación' : 'donaciones'),
            importe_cents: dTotal,
          });
          await supa('PATCH', `donations?id=in.${inList(dons)}`, { liquidada_at: ahora });
        }

        // 2) Cuotas de afiliación cobradas aún no liquidadas
        const pq = await supa('GET', 'payments?estado=eq.pagado&liquidada_at=is.null&select=id,importe_cents');
        const pays = pq.json || [];
        const pTotal = pays.reduce((s, p) => s + (p.importe_cents || 0), 0);
        if (pays.length) {
          await supa('POST', 'tesoreria', {
            fecha, tipo: 'ingreso', categoria: 'Cuotas',
            concepto: 'Liquidación Stripe · ' + pays.length + ' ' + (pays.length === 1 ? 'cuota' : 'cuotas') + ' de afiliación',
            importe_cents: pTotal,
          });
          await supa('PATCH', `payments?id=in.${inList(pays)}`, { liquidada_at: ahora });
        }

        await audit('payout_liquidado', 'tesoreria', obj.id, { donaciones_cents: dTotal, cuotas_cents: pTotal, importe_payout: obj.amount });
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
