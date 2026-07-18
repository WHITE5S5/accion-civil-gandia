// Función PROGRAMADA (diaria, 07:00 UTC ≈ 09:00 Madrid): envía el recordatorio
// a los inscritos en actos que se celebran MAÑANA y aún no lo han recibido.
import { supa, supaConfigured } from './lib/supa.mjs';
import { sendEmail } from './contacto.mjs';

export default async () => {
  if (!supaConfigured()) return new Response('unconfigured', { status: 200 });
  const manana = new Date(Date.now() + 864e5).toLocaleDateString('sv', { timeZone: 'Europe/Madrid' });
  const evs = await supa('GET', `events?fecha=eq.${manana}&inscribible=eq.true&select=slug,titulo_es,fecha,hora_inicio,lugar,direccion`);
  let enviados = 0;
  for (const e of evs.json || []) {
    const insc = await supa('GET', `event_inscripciones?event_slug=eq.${e.slug}&recordatorio_enviado=eq.false&select=id,email,nombre`);
    for (const p of insc.json || []) {
      const r = await sendEmail({
        to: p.email,
        subject: `Recordatorio: mañana es "${e.titulo_es}"`,
        html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto">
          <div style="background:#0A2A5E;color:#fff;padding:18px 22px;border-radius:12px 12px 0 0"><b>Acción Civil Gandia</b></div>
          <div style="border:1px solid #E4EBF2;border-top:none;border-radius:0 0 12px 12px;padding:22px">
            <h2 style="color:#0A2A5E;margin:0 0 10px">¡Mañana nos vemos${p.nombre ? ', ' + p.nombre : ''}! 👋</h2>
            <p style="color:#33414F;line-height:1.6;margin:0 0 8px"><b>${e.titulo_es}</b><br>
            ${e.hora_inicio ? '🕐 ' + String(e.hora_inicio).slice(0, 5) + '<br>' : ''}${e.lugar ? '📍 ' + e.lugar + (e.direccion ? ' · ' + e.direccion : '') : ''}</p>
          </div></div>`,
      });
      if (r.ok) { await supa('PATCH', `event_inscripciones?id=eq.${p.id}`, { recordatorio_enviado: true }); enviados++; }
    }
  }
  console.log('recordatorios enviados:', enviados);

  // ---- Retención de analítica: consolidar eventos >90 días en analytics_mensual y purgarlos ----
  // Tope 5000 filas/día (5 páginas) para no alargar la función; el backlog se drena en días sucesivos.
  // Se borra SOLO lo consolidado (por id), nunca a ciegas por fecha.
  let purgados = 0;
  try {
    const corte = new Date(Date.now() - 90 * 864e5).toISOString();
    for (let pagina = 0; pagina < 5; pagina++) {
      const r = await supa('GET',
        `analytics_events?created_at=lt.${encodeURIComponent(corte)}&select=id,tipo,path,red,created_at&order=created_at.asc&limit=1000`);
      const rows = r.ok && Array.isArray(r.json) ? r.json : [];
      if (!rows.length) break;
      // agrupar por (mes, tipo, clave)
      const grupos = new Map();
      for (const e of rows) {
        const mes = String(e.created_at).slice(0, 7) + '-01';
        const clave = (e.tipo === 'social' ? (e.red || '') : (e.path || '')).slice(0, 200);
        const k = mes + '|' + e.tipo + '|' + clave;
        grupos.set(k, (grupos.get(k) || 0) + 1);
      }
      // sumar sobre lo ya consolidado de esos meses y upsert (merge-duplicates reemplaza con el total)
      const meses = [...new Set([...grupos.keys()].map((k) => k.split('|')[0]))];
      const ex = await supa('GET', `analytics_mensual?mes=in.(${meses.join(',')})&select=mes,tipo,clave,hits`);
      const actual = new Map((ex.ok && Array.isArray(ex.json) ? ex.json : []).map((x) => [x.mes + '|' + x.tipo + '|' + x.clave, x.hits]));
      const upserts = [...grupos.entries()].map(([k, n]) => {
        const [mes, tipo, clave] = k.split('|');
        return { mes, tipo, clave, hits: (actual.get(k) || 0) + n };
      });
      const up = await supa('POST', 'analytics_mensual?on_conflict=mes,tipo,clave', upserts,
        { prefer: 'return=minimal,resolution=merge-duplicates' });
      if (!up.ok) { console.error('analytics rollup fail', up.status, up.text); break; }   // sin consolidar NO se borra
      // borrar exactamente las filas consolidadas
      const ids = rows.map((x) => x.id);
      for (let i = 0; i < ids.length; i += 500) {
        await supa('DELETE', `analytics_events?id=in.(${ids.slice(i, i + 500).join(',')})`, null, { prefer: 'return=minimal' });
      }
      purgados += rows.length;
    }
    if (purgados) console.log('analytics purgados:', purgados);
  } catch (e) { console.error('retencion analytics', e); }

  return new Response(JSON.stringify({ ok: true, enviados, purgados }), { status: 200 });
};

export const config = { schedule: '0 7 * * *' };
