// Crea (idempotente) la cuenta oficial de sistema "Acción Civil" para publicar en el chat desde el admin.
// profiles.id -> auth.users(id), así que primero se crea un auth user con la Admin API y luego su profile.
// Uso: SUPABASE_URL=... node scripts/ensure_system_account.mjs   (la service key se lee de .env)
import { readFileSync } from 'node:fs';

const BASE = process.env.SUPABASE_URL || 'https://msbrdowdkwqrrdlfeztj.supabase.co';
let KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY) {
  const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
  KEY = (env.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/) || [])[1]?.trim();
}
if (!KEY) { console.error('Falta SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }

const H = { apikey: KEY, authorization: `Bearer ${KEY}`, 'content-type': 'application/json' };
const NOMBRE = 'Acción Civil';
const EMAIL = 'chat-oficial@accioncivilgandia.org';

// 1) ¿ya existe el profile?
let r = await fetch(`${BASE}/rest/v1/profiles?nombre=eq.${encodeURIComponent(NOMBRE)}&rol=eq.admin&select=id`, { headers: H });
let rows = await r.json();
if (Array.isArray(rows) && rows.length) { console.log('EXISTE', rows[0].id); process.exit(0); }

// 2) ¿existe ya el auth user (por email)?
r = await fetch(`${BASE}/auth/v1/admin/users?email=${encodeURIComponent(EMAIL)}`, { headers: H });
let au = await r.json();
let uid = (au.users && au.users[0] && au.users[0].id) || null;

// 3) crear auth user si no existe
if (!uid) {
  r = await fetch(`${BASE}/auth/v1/admin/users`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ email: EMAIL, email_confirm: true, user_metadata: { nombre: NOMBRE, sistema: true } }),
  });
  const j = await r.json();
  uid = j.id;
  if (!uid) { console.error('No se pudo crear auth user:', JSON.stringify(j).slice(0, 300)); process.exit(1); }
}

// 4) upsert del profile con rol admin
r = await fetch(`${BASE}/rest/v1/profiles`, {
  method: 'POST',
  headers: { ...H, prefer: 'resolution=merge-duplicates,return=representation' },
  body: JSON.stringify({ id: uid, nombre: NOMBRE, rol: 'admin', lang: 'es' }),
});
const prof = await r.json();
if (!r.ok) { console.error('No se pudo crear profile:', r.status, JSON.stringify(prof).slice(0, 300)); process.exit(1); }
console.log('CREADO', uid);
