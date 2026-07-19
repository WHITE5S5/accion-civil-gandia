// Títulos/rangos de una cuenta. Compartido por chat, cuenta, comentarios y admin.
// Línea jerárquica (se muestra SOLO el más alto): vecino < voluntario < colaborador < afiliado < presidente.
// "donante" es un título aparte (bonus) que se suma → máximo 2 insignias por persona.
// TODA persona registrada es "Vecino/a" por defecto (título base visible). El presidente
// (única cuenta con honorífico "Presidente" en el nombre, vía SPECIAL_ACCOUNTS) lleva 👑.
import { splitCargo } from './names.mjs';

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export const TITULO_META = {
  vecino:      { key: 'vecino',      emoji: '🏘️', es: 'Vecino/a',      va: 'Veí/na',          color: '#42525F', bg: '#EEF2F7' },
  voluntario:  { key: 'voluntario',  emoji: '🙋', es: 'Voluntario/a',  va: 'Voluntari/ària',  color: '#0B7580', bg: '#E4F5F7' },
  colaborador: { key: 'colaborador', emoji: '🤝', es: 'Colaborador/a', va: 'Col·laborador/a', color: '#1563C4', bg: '#EAF3FC' },
  afiliado:    { key: 'afiliado',    emoji: '⭐', es: 'Afiliado/a',    va: 'Afiliat/da',      color: '#9A6208', bg: '#FBF0DC' },
  presidente:  { key: 'presidente',  emoji: '👑', es: 'Presidente',    va: 'President',       color: '#8A5A00', bg: '#FBEFC7' },
  donante:     { key: 'donante',     emoji: '💛', es: 'Donante',       va: 'Donant',          color: '#C2410C', bg: '#FDEBD0' },
};
// Alias de compatibilidad: código antiguo que refiera 'ciudadano' sigue funcionando (= vecino).
TITULO_META.ciudadano = TITULO_META.vecino;

// El presidente es la ÚNICA cuenta con el honorífico "Presidente" en su nombre (lo impone el
// sistema en SPECIAL_ACCOUNTS; los usuarios normales no pueden ponerse un cargo — cleanName lo bloquea).
export function esPresidente(p = {}) {
  return /^presiden/.test(norm(splitCargo(p.nombre).cargo));   // "Presidente" sí, "Vicepresidente" no
}

// Rango jerárquico a partir de los flags de la cuenta (+ honorífico para el presidente).
export function rangoDe(p = {}) {
  if (esPresidente(p)) return 'presidente';
  if (p.es_afiliado) return 'afiliado';
  if (p.voluntariado === 'colaborador') return 'colaborador';
  if (p.voluntariado === 'voluntario') return 'voluntario';
  return 'vecino';
}

// Devuelve las claves de título a mostrar (máx. 2): [rango] (+ 'donante' si aplica).
// El rango base "vecino" AHORA se muestra siempre (toda persona registrada es Vecino/a por defecto).
// El parámetro incluirBase se mantiene por compatibilidad pero ya no oculta la base.
export function titulosDe(p = {}, incluirBase = true) {
  const out = [rangoDe(p)];
  if (p.es_donante) out.push('donante');
  return out;
}

// Payload listo para el front: [{key, emoji, label, color, bg}] en el idioma pedido.
export function titulosPayload(p = {}, lang = 'es', incluirBase = true) {
  return titulosDe(p, incluirBase).map((k) => {
    const m = TITULO_META[k];
    return { key: k, emoji: m.emoji, label: lang === 'va' ? m.va : m.es, color: m.color, bg: m.bg };
  });
}
