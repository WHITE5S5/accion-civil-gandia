// Sincroniza el contenido base de Fase 2 contra Supabase una vez aplicadas las migraciones.
// Uso:
//   node scripts/sync_phase2_content.mjs
// Requiere:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

import {
  seedActuaciones,
  seedBarrios,
  seedCampaigns,
  seedEquipo,
  seedEvents,
  seedPosts,
} from '../netlify/functions/lib/content-seeds.mjs';
import { supa, supaConfigured } from '../netlify/functions/lib/supa.mjs';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) {
  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    if (!line || /^\s*#/.test(line) || !line.includes('=')) continue;
    const idx = line.indexOf('=');
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

if (!supaConfigured()) {
  console.error('Faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

async function ensureTable(path) {
  const check = await supa('GET', `${path}?select=*&limit=1`);
  if (!check.ok && check.status === 404) {
    throw new Error(`La tabla o vista "${path}" no existe todavía en Supabase. Aplica primero 001/002/003.`);
  }
  if (!check.ok && check.status >= 400) {
    throw new Error(`No se pudo leer "${path}": ${check.status} ${check.text}`);
  }
}

async function upsert(path, rows, onConflict) {
  const response = await supa('POST', `${path}?on_conflict=${encodeURIComponent(onConflict)}`, rows, {
    prefer: 'resolution=merge-duplicates,return=representation',
  });
  if (!response.ok) {
    throw new Error(`Error haciendo upsert en ${path}: ${response.status} ${response.text}`);
  }
  return Array.isArray(response.json) ? response.json : [];
}

async function main() {
  for (const table of ['barrios', 'posts', 'events', 'campaigns', 'actuaciones', 'equipo']) {
    await ensureTable(table);
  }

  const barrios = await upsert('barrios', seedBarrios, 'slug');
  const barrioBySlug = new Map(barrios.map((row) => [row.slug, row.id]));

  await upsert('posts', seedPosts, 'slug');

  const eventsRows = seedEvents.map((row) => ({
    slug: row.slug,
    titulo_es: row.titulo_es,
    titulo_va: row.titulo_va,
    descripcion_es: row.descripcion_es,
    descripcion_va: row.descripcion_va,
    fecha: row.fecha,
    hora_inicio: row.hora_inicio,
    hora_fin: row.hora_fin,
    lugar: row.lugar,
    direccion: row.direccion,
    barrio_id: barrioBySlug.get(row.barrio_slug) || null,
    estado: row.estado,
    created_at: row.created_at,
  }));
  await upsert('events', eventsRows, 'slug');

  await upsert('campaigns', seedCampaigns, 'slug');

  const actuacionesRows = seedActuaciones.map((row) => ({
    slug: row.slug,
    titulo_es: row.titulo_es,
    titulo_va: row.titulo_va,
    descripcion_es: row.descripcion_es,
    descripcion_va: row.descripcion_va,
    barrio_id: barrioBySlug.get(row.barrio_slug) || null,
    estado: row.estado,
    cronologia: row.cronologia,
    lat: row.lat,
    lng: row.lng,
    created_at: row.created_at,
  }));
  await upsert('actuaciones', actuacionesRows, 'slug');

  await upsert('equipo', seedEquipo, 'slug');

  console.log('Contenido Fase 2 sincronizado correctamente.');
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
