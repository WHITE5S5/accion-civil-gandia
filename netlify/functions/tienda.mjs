// /api/tienda — catálogo público de la tienda (GET) + checkout de Stripe (POST).
// GET  ?lang=es|va            → { products:[...] }
// GET  ?slug=...&lang=        → { product:{...} }  (404 si no existe/activo=false)
// POST { action:'checkout', items, metodo_entrega, cliente, lang } → { url }
// El webhook (stripe-webhook.mjs, metadata.tipo='tienda') confirma el pago y descuenta stock.
// Env: STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, APP_BASE_URL, TIENDA_ENVIO_CENTS
import { rateLimited } from './contacto.mjs';
import { supa, supaConfigured, stripe, stripeConfigured, jsonErr, jsonOk } from './lib/supa.mjs';
import { cacheHeaders } from './lib/content-api.mjs';

const isVa = (lang) => lang === 'va';
const pick = (es, va, lang) => (isVa(lang) ? (va || es || '') : (es || va || ''));

const SELECT = 'id,slug,nombre_es,nombre_va,descripcion_es,descripcion_va,precio_cents,categoria,imagen_url,galeria,destacado,orden,product_variants(id,talla,sku,stock,precio_cents,orden)';

function normalizeProduct(row, lang) {
  const variantes = (Array.isArray(row.product_variants) ? row.product_variants : [])
    .slice()
    .sort((a, b) => (a.orden || 0) - (b.orden || 0))
    .map((v) => ({
      id: v.id,
      talla: v.talla || null,
      sku: v.sku || '',
      stock: Number(v.stock || 0),
      precio_cents: v.precio_cents != null ? Number(v.precio_cents) : Number(row.precio_cents || 0),
    }));
  const agotado = variantes.length > 0 && variantes.every((v) => v.stock <= 0);
  return {
    id: row.id,
    slug: row.slug,
    nombre: pick(row.nombre_es, row.nombre_va, lang),
    descripcion: pick(row.descripcion_es, row.descripcion_va, lang),
    precio_cents: Number(row.precio_cents || 0),
    categoria: row.categoria || 'general',
    imagen: row.imagen_url || '',
    galeria: Array.isArray(row.galeria) ? row.galeria : [],
    destacado: !!row.destacado,
    agotado,
    variantes,
  };
}

async function handleGet(url) {
  const lang = isVa(url.searchParams.get('lang')) ? 'va' : 'es';
  const slug = String(url.searchParams.get('slug') || '').trim();

  if (!supaConfigured()) {
    const body = slug ? { product: null } : { products: [] };
    return new Response(JSON.stringify(body), { status: slug ? 404 : 200, headers: cacheHeaders() });
  }

  if (slug) {
    const q = await supa('GET', `products?slug=eq.${encodeURIComponent(slug)}&activo=eq.true&select=${SELECT}`);
    if (!q.ok) { console.error('tienda GET slug fail', q.status, q.text); return jsonErr(502, 'db_error', 'Error interno'); }
    const row = (q.json || [])[0];
    if (!row) return new Response(JSON.stringify({ product: null }), { status: 404, headers: cacheHeaders() });
    return new Response(JSON.stringify({ product: normalizeProduct(row, lang) }), { status: 200, headers: cacheHeaders() });
  }

  const q = await supa('GET', `products?activo=eq.true&order=orden.asc,created_at.asc&select=${SELECT}`);
  if (!q.ok) { console.error('tienda GET fail', q.status, q.text); return jsonErr(502, 'db_error', 'Error interno'); }
  const products = (q.json || []).map((row) => normalizeProduct(row, lang));
  return new Response(JSON.stringify({ products }), { status: 200, headers: cacheHeaders() });
}

async function handleCheckout(req, context) {
  const ip = context.ip || req.headers.get('x-nf-client-connection-ip') || '0.0.0.0';
  if (rateLimited(ip, 10)) return jsonErr(429, 'rate_limited', 'Demasiados intentos');
  if (!stripeConfigured() || !supaConfigured())
    return jsonErr(503, 'service_unconfigured', 'La tienda aún no está activa');

  let b;
  try { b = await req.json(); } catch { return jsonErr(400, 'bad_json', 'Cuerpo inválido'); }

  const lang = isVa(b.lang) ? 'va' : 'es';
  const metodo = ['recogida', 'envio'].includes(b.metodo_entrega) ? b.metodo_entrega : null;
  if (!metodo) return jsonErr(400, 'invalid_entrega', 'Método de entrega no válido');

  const cliente = b.cliente || {};
  const nombre = String(cliente.nombre || '').trim();
  const email = String(cliente.email || '').trim();
  if (nombre.length < 2) return jsonErr(400, 'invalid_nombre', 'Nombre obligatorio');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return jsonErr(400, 'invalid_email', 'Email no válido');

  const items = Array.isArray(b.items) ? b.items : [];
  if (!items.length) return jsonErr(400, 'empty_cart', 'El carrito está vacío');
  const wanted = new Map(); // variant_id -> cantidad
  for (const it of items) {
    const id = String(it?.variant_id || '').trim();
    const cant = Math.round(Number(it?.cantidad));
    if (!id) return jsonErr(400, 'invalid_item', 'Artículo inválido');
    if (!Number.isFinite(cant) || cant <= 0) return jsonErr(400, 'invalid_cantidad', 'Cantidad no válida');
    wanted.set(id, (wanted.get(id) || 0) + cant);
  }

  // Revalidación en servidor: precios y stock reales desde la BD (NUNCA del cliente).
  const ids = [...wanted.keys()];
  const inList = '(' + ids.map((x) => `"${x}"`).join(',') + ')';
  const vq = await supa('GET',
    `product_variants?id=in.${inList}&select=id,talla,stock,precio_cents,product_id,products(id,activo,nombre_es,nombre_va,precio_cents)`);
  if (!vq.ok) { console.error('tienda variants fail', vq.status, vq.text); return jsonErr(502, 'db_error', 'Error interno'); }
  const byId = new Map((vq.json || []).map((v) => [v.id, v]));

  let subtotal = 0;
  const lineItems = [];
  const orderItems = [];
  for (const [vid, cant] of wanted) {
    const v = byId.get(vid);
    if (!v) return jsonErr(400, 'invalid_item', 'Artículo no encontrado');
    const prod = v.products || {};
    if (!prod.activo) return jsonErr(409, 'product_inactive', 'Producto no disponible');
    if (Number(v.stock || 0) < cant)
      return new Response(JSON.stringify({ error: { code: 'stock', message: 'Sin stock suficiente' }, code: 'stock', variant_id: vid }),
        { status: 409, headers: { 'content-type': 'application/json' } });
    const precio = v.precio_cents != null ? Number(v.precio_cents) : Number(prod.precio_cents || 0);
    const nombreProd = pick(prod.nombre_es, prod.nombre_va, lang);
    const label = v.talla ? `${nombreProd} · ${v.talla}` : nombreProd;
    subtotal += precio * cant;
    lineItems.push({
      quantity: cant,
      price_data: { currency: 'eur', unit_amount: precio, product_data: { name: label } },
    });
    orderItems.push({ product_id: prod.id || v.product_id, variant_id: vid, nombre: nombreProd, talla: v.talla || null, precio_cents: precio, cantidad: cant });
  }

  const envio = metodo === 'envio' ? parseInt(process.env.TIENDA_ENVIO_CENTS || '490', 10) : 0;
  const total = subtotal + envio;

  // Nº de pedido legible ACG-<año>-<aleatorio corto> (Date.now disponible en el runtime).
  const year = new Date().getFullYear();
  const numero = `ACG-${year}-${Date.now().toString(36).slice(-4).toUpperCase()}${Math.floor(Math.random() * 900 + 100)}`;

  const ins = await supa('POST', 'orders', {
    numero, user_id: b.user_id || null, email, nombre,
    estado: 'pendiente_pago', metodo_entrega: metodo,
    subtotal_cents: subtotal, envio_cents: envio, total_cents: total,
  });
  if (!ins.ok || !ins.json?.[0]) { console.error('tienda order insert fail', ins.status, ins.text); return jsonErr(502, 'db_error', 'No se pudo crear el pedido'); }
  const orderId = ins.json[0].id;

  const itemsIns = await supa('POST', 'order_items', orderItems.map((oi) => ({ ...oi, order_id: orderId })));
  if (!itemsIns.ok) { console.error('tienda order_items insert fail', itemsIns.status, itemsIns.text); return jsonErr(502, 'db_error', 'No se pudo crear el pedido'); }

  const base = process.env.APP_BASE_URL || 'https://accioncivilgandia.netlify.app';
  const params = {
    mode: 'payment',
    customer_email: email,
    line_items: lineItems,
    metadata: { tipo: 'tienda', order_id: orderId },
    payment_intent_data: { metadata: { tipo: 'tienda', order_id: orderId } },
    success_url: `${base}/tienda?compra=ok`,
    cancel_url: `${base}/carrito`,
  };
  if (metodo === 'envio') {
    params.shipping_address_collection = { allowed_countries: ['ES'] };
    params.shipping_options = [{
      shipping_rate_data: {
        type: 'fixed_amount',
        fixed_amount: { amount: envio, currency: 'eur' },
        display_name: pick('Envío a domicilio', 'Enviament a domicili', lang),
      },
    }];
  }

  const s = await stripe('checkout/sessions', params);
  if (!s.ok || !s.json?.url) { console.error('tienda stripe fail', s.status, JSON.stringify(s.json).slice(0, 300)); return jsonErr(502, 'stripe_error', 'No se pudo iniciar el pago'); }

  await supa('PATCH', `orders?id=eq.${orderId}`, { stripe_session_id: s.json.id });
  return jsonOk({ url: s.json.url });
}

export default async (req, context) => {
  const url = new URL(req.url);
  if (req.method === 'GET') return handleGet(url);
  if (req.method === 'POST') {
    let action = 'checkout';
    try {
      // Peek action sin consumir el body dos veces: clonamos.
      const c = req.clone();
      const b = await c.json().catch(() => ({}));
      action = b?.action || 'checkout';
    } catch { /* noop */ }
    if (action !== 'checkout') return jsonErr(400, 'invalid_action', 'Acción no soportada');
    return handleCheckout(req, context);
  }
  return jsonErr(405, 'method_not_allowed', 'Método no permitido');
};

export const config = { path: '/api/tienda' };
