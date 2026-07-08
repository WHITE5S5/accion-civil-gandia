// Helpers compartidos Fase 2-4: Supabase REST, Stripe REST, DNI y cifrado.
// (Subcarpeta lib/ => Netlify no lo registra como función; esbuild lo bundlea.)
import { createHash, createHmac, createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

// ---------- Supabase (PostgREST con service_role — SOLO servidor) ----------
export function supaConfigured() {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}
export function supaReadKey() {
  return process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
}
export function supaReadConfigured() {
  return !!(process.env.SUPABASE_URL && supaReadKey());
}
export async function supa(method, path, body, extraHeaders = {}) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/${path}`;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const r = await fetch(url, {
    method,
    headers: {
      apikey: key, authorization: `Bearer ${key}`,
      'content-type': 'application/json', prefer: 'return=representation',
      ...extraHeaders,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await r.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch {}
  return { ok: r.ok, status: r.status, json, text };
}
export async function supaRead(path, extraHeaders = {}) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/${path}`;
  const key = supaReadKey();
  const r = await fetch(url, {
    method: 'GET',
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      accept: 'application/json',
      ...extraHeaders,
    },
  });
  const text = await r.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch {}
  return { ok: r.ok, status: r.status, json, text };
}

// ---------- Stripe REST (form-encoded, sin SDK) ----------
export function stripeConfigured() { return !!process.env.STRIPE_SECRET_KEY; }
export async function stripe(path, params) {
  const body = new URLSearchParams();
  const flat = (obj, prefix = '') => {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}[${k}]` : k;
      if (v && typeof v === 'object') flat(v, key);
      else if (v !== undefined && v !== null) body.append(key, String(v));
    }
  };
  flat(params);
  const r = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const json = await r.json().catch(() => null);
  return { ok: r.ok, status: r.status, json };
}

// Verificación de firma de webhook (Stripe-Signature: t=..,v1=..)
export function verifyStripeSignature(payload, sigHeader, secret, toleranceSec = 300) {
  const parts = Object.fromEntries(
    String(sigHeader || '').split(',').map((p) => p.split('=').map((s) => s.trim())).filter((p) => p.length === 2)
  );
  if (!parts.t || !parts.v1) return false;
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > toleranceSec) return false;
  const expected = createHmac('sha256', secret).update(`${parts.t}.${payload}`).digest('hex');
  const a = Buffer.from(expected), b = Buffer.from(parts.v1);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---------- DNI/NIE ----------
export function validaDni(raw) {
  const dni = String(raw || '').toUpperCase().replace(/[\s-]/g, '');
  const m = dni.match(/^([XYZ]?)(\d{7,8})([A-Z])$/);
  if (!m) return null;
  let num = m[2];
  if (m[1]) num = { X: '0', Y: '1', Z: '2' }[m[1]] + num;
  if (num.length !== 8) return null;
  const letra = 'TRWAGMYFPDXBNJZSQVHLCKE'[Number(num) % 23];
  return letra === m[3] ? dni : null;
}
export const dniHash = (dni) => createHash('sha256').update(dni).digest('hex');

// ---------- Cifrado AES-256-GCM (ENCRYPTION_KEY = 32 bytes base64) ----------
export function encrypt(plain) {
  const key = Buffer.from(process.env.ENCRYPTION_KEY, 'base64');
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `${iv.toString('base64')}:${enc.toString('base64')}:${c.getAuthTag().toString('base64')}`;
}
export function decrypt(stored) {
  const key = Buffer.from(process.env.ENCRYPTION_KEY, 'base64');
  const [iv, data, tag] = stored.split(':').map((s) => Buffer.from(s, 'base64'));
  const d = createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString('utf8');
}

export const jsonErr = (status, code, message) =>
  new Response(JSON.stringify({ error: { code, message } }), {
    status, headers: { 'content-type': 'application/json' },
  });
export const jsonOk = (obj = { ok: true }) =>
  new Response(JSON.stringify(obj), { status: 200, headers: { 'content-type': 'application/json' } });
