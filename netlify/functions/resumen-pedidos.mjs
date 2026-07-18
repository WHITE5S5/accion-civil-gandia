// Función PROGRAMADA (diaria, 07:00 UTC ≈ 09:00 Madrid): envía al correo del partido
// un RESUMEN de los pedidos de tienda pagados en las últimas 24 h (NO un email por pedido).
// Si no hay pedidos en la ventana, no envía nada (no satura la bandeja).
import { supa, supaConfigured } from './lib/supa.mjs';
import { sendEmail, emailShell } from './contacto.mjs';

export default async () => {
  if (!supaConfigured()) return new Response('unconfigured', { status: 200 });

  const desde = new Date(Date.now() - 24 * 3600e3).toISOString();
  const q = await supa('GET',
    `orders?paid_at=gte.${desde}&estado=neq.pendiente_pago&select=numero,nombre,total_cents,metodo_entrega,paid_at,order_items(nombre,talla,cantidad)&order=paid_at.desc`);
  const pedidos = q.json || [];
  if (!pedidos.length) {
    console.log('resumen-pedidos: 0 pedidos en 24h, no se envía');
    return new Response(JSON.stringify({ ok: true, pedidos: 0 }), { status: 200 });
  }

  const eur = (c) => ((c || 0) / 100).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
  const esc = (s) => String(s || '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  const totalCents = pedidos.reduce((s, p) => s + (p.total_cents || 0), 0);

  const filas = pedidos.map((p) => {
    const arts = (p.order_items || []).map((it) => `${esc(it.nombre)}${it.talla ? ' · ' + esc(it.talla) : ''} × ${it.cantidad}`).join(', ');
    const entrega = p.metodo_entrega === 'envio' ? '📦 Envío' : '🏠 Recogida';
    return `<tr>
      <td style="padding:8px 6px;border-top:1px solid #E4EBF2"><b>${esc(p.numero)}</b><br><span style="color:#5C6B7A;font-size:12px">${esc(p.nombre || '')}</span></td>
      <td style="padding:8px 6px;border-top:1px solid #E4EBF2;font-size:13px">${arts}</td>
      <td style="padding:8px 6px;border-top:1px solid #E4EBF2;white-space:nowrap;font-size:12px">${entrega}</td>
      <td style="padding:8px 6px;border-top:1px solid #E4EBF2;text-align:right;white-space:nowrap"><b>${eur(p.total_cents)}</b></td>
    </tr>`;
  }).join('');

  const to = process.env.CONTACT_INBOX || 'accioncivilgandia@gmail.com';
  await sendEmail({
    to,
    subject: `🛒 Resumen de tienda: ${pedidos.length} pedido${pedidos.length === 1 ? '' : 's'} · ${eur(totalCents)}`,
    replyTo: to,
    html: emailShell({
      title: `${pedidos.length} pedido${pedidos.length === 1 ? '' : 's'} en las últimas 24 h`,
      body: `<p>Total recaudado: <b>${eur(totalCents)}</b>.</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <tr>
            <th align="left" style="padding:6px;color:#5C6B7A;font-size:12px">Pedido</th>
            <th align="left" style="padding:6px;color:#5C6B7A;font-size:12px">Artículos</th>
            <th align="left" style="padding:6px;color:#5C6B7A;font-size:12px">Entrega</th>
            <th align="right" style="padding:6px;color:#5C6B7A;font-size:12px">Total</th>
          </tr>
          ${filas}
        </table>
        <p style="color:#5C6B7A;font-size:13px;margin-top:14px">Gestiona los pedidos en <a href="https://accioncivilgandia.netlify.app/admin">/admin → 🛍️ Tienda → Pedidos</a>.</p>`,
    }),
  }).catch((e) => console.error('resumen-pedidos email fail', e && e.message));

  console.log('resumen-pedidos enviado:', pedidos.length, 'pedidos');
  return new Response(JSON.stringify({ ok: true, pedidos: pedidos.length }), { status: 200 });
};

export const config = { schedule: '0 7 * * *' };
