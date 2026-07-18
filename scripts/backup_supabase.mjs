// Backup semanal de Supabase SIN pg_dump: exporta TODAS las tablas (vía PostgREST,
// descubiertas dinámicamente) + usuarios de auth, en JSON.gz por tabla.
// El esquema vive en supabase/migrations/ → migraciones + este volcado = recuperación completa.
// Uso: node scripts/backup_supabase.mjs   (programado semanalmente con el Programador de tareas)
// Destino: F:\Backups\AccionCivil\backup-YYYY-MM-DD\  (conserva los 8 más recientes)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DEST_BASE = 'F:\\Backups\\AccionCivil';
const KEEP = 8;

// claves desde .env del proyecto
const env = {};
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL_ = env.SUPABASE_URL, KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) { console.error('Faltan SUPABASE_URL / SERVICE_ROLE_KEY en .env'); process.exit(1); }
const H = { apikey: KEY, authorization: `Bearer ${KEY}` };

const dia = new Date().toISOString().slice(0, 10);
const destino = path.join(DEST_BASE, `backup-${dia}`);
fs.mkdirSync(destino, { recursive: true });

// 1) descubrir tablas por el OpenAPI de PostgREST
const spec = await fetch(`${URL_}/rest/v1/`, { headers: H }).then((r) => r.json());
const tablas = Object.keys(spec.definitions || {}).sort();
console.log(`Tablas descubiertas: ${tablas.length}`);

const resumen = { fecha: new Date().toISOString(), tablas: {} };
let totalFilas = 0;

for (const t of tablas) {
  const filas = [];
  for (let off = 0; ; off += 1000) {
    const r = await fetch(`${URL_}/rest/v1/${t}?select=*&limit=1000&offset=${off}`, { headers: H });
    if (!r.ok) { console.error(`  ${t}: HTTP ${r.status} (saltada)`); break; }
    const j = await r.json();
    if (!Array.isArray(j) || !j.length) break;
    filas.push(...j);
    if (j.length < 1000) break;
  }
  fs.writeFileSync(path.join(destino, `${t}.json.gz`), zlib.gzipSync(JSON.stringify(filas)));
  resumen.tablas[t] = filas.length;
  totalFilas += filas.length;
  console.log(`  ${t}: ${filas.length} filas`);
}

// 2) usuarios de auth (no salen por PostgREST): admin API paginada
const usuarios = [];
for (let page = 1; page <= 50; page++) {
  const r = await fetch(`${URL_}/auth/v1/admin/users?page=${page}&per_page=1000`, { headers: H });
  if (!r.ok) { console.error('auth users HTTP', r.status); break; }
  const j = await r.json();
  const us = j.users || j || [];
  if (!us.length) break;
  usuarios.push(...us);
  if (us.length < 1000) break;
}
fs.writeFileSync(path.join(destino, '_auth_users.json.gz'), zlib.gzipSync(JSON.stringify(usuarios)));
resumen.auth_users = usuarios.length;
console.log(`  auth.users: ${usuarios.length}`);

fs.writeFileSync(path.join(destino, '_resumen.json'), JSON.stringify(resumen, null, 2));

// 3) rotación: conservar los KEEP más recientes
const previos = fs.readdirSync(DEST_BASE).filter((d) => d.startsWith('backup-')).sort();
for (const viejo of previos.slice(0, Math.max(0, previos.length - KEEP))) {
  fs.rmSync(path.join(DEST_BASE, viejo), { recursive: true, force: true });
  console.log(`  rotado: ${viejo}`);
}

console.log(`OK — ${totalFilas} filas + ${usuarios.length} usuarios en ${destino}`);
