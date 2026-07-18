// Paso a PRODUCCIÓN de Stripe en un comando, cuando la cuenta esté activada.
// Uso:  node scripts/stripe_go_live.mjs sk_live_XXXX
// Crea el producto y los precios de cuota (15/30 €/mes) y el webhook en modo live,
// y muestra los comandos netlify env:set listos para pegar.
const SK = process.argv[2];
if (!SK || !SK.startsWith('sk_live_')) {
  console.log('Uso: node scripts/stripe_go_live.mjs sk_live_XXXX');
  console.log('La clave live está en https://dashboard.stripe.com/apikeys (SIN /test/).');
  process.exit(1);
}
const api = async (path, params) => {
  const r = await fetch('https://api.stripe.com/v1/' + path, {
    method: 'POST',
    headers: { authorization: `Bearer ${SK}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const j = await r.json();
  if (!r.ok) { console.error('ERROR', path, j.error?.message); process.exit(1); }
  return j;
};

const prod = await api('products', { name: 'Cuota de afiliación', 'metadata[web]': 'accioncivilgandia' });
const base = await api('prices', { product: prod.id, currency: 'eur', unit_amount: '1500', 'recurring[interval]': 'month', nickname: 'Cuota base 15€' });
const media = await api('prices', { product: prod.id, currency: 'eur', unit_amount: '3000', 'recurring[interval]': 'month', nickname: 'Cuota media 30€' });
const wh = await api('webhook_endpoints', {
  url: 'https://accioncivilgandia.netlify.app/api/stripe/webhook',
  'enabled_events[0]': 'checkout.session.completed',
  'enabled_events[1]': 'invoice.paid',
  'enabled_events[2]': 'invoice.payment_failed',
  'enabled_events[3]': 'customer.subscription.deleted',
  'enabled_events[4]': 'payment_intent.succeeded',
});

console.log('\n✅ Creado en modo LIVE. Pega estos comandos:\n');
console.log(`npx netlify-cli env:set STRIPE_SECRET_KEY ${SK}`);
console.log(`npx netlify-cli env:set STRIPE_PRODUCT_CUOTA ${prod.id}`);
console.log(`npx netlify-cli env:set STRIPE_PRICE_CUOTA_BASE ${base.id}`);
console.log(`npx netlify-cli env:set STRIPE_PRICE_CUOTA_MEDIA ${media.id}`);
console.log(`npx netlify-cli env:set STRIPE_WEBHOOK_SECRET ${wh.secret}`);
console.log('# y la clave publicable (pk_live_...) de https://dashboard.stripe.com/apikeys:');
console.log('npx netlify-cli env:set STRIPE_PUBLISHABLE_KEY pk_live_XXXX');
console.log('\nDespués: python scripts/make_deploy.py && npx netlify-cli deploy --prod --dir=deploy_netlify');
console.log('Y una prueba real pequeña (1 €) para confirmar el circuito completo.');
