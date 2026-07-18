// Títulos/rangos de una cuenta. Compartido por chat, cuenta y comentarios.
// Línea jerárquica (se muestra SOLO el más alto): ciudadano < voluntario < colaborador < afiliado.
// "donante" es un título aparte (bonus) que se suma → máximo 2 insignias por persona.

export const TITULO_META = {
  ciudadano:   { key: 'ciudadano',   emoji: '',   es: 'Ciudadano/a',   va: 'Ciutadà/na',      color: '#42525F', bg: '#EEF2F7' },
  voluntario:  { key: 'voluntario',  emoji: '🙋', es: 'Voluntario/a',  va: 'Voluntari/ària',  color: '#0B7580', bg: '#E4F5F7' },
  colaborador: { key: 'colaborador', emoji: '🤝', es: 'Colaborador/a', va: 'Col·laborador/a', color: '#1563C4', bg: '#EAF3FC' },
  afiliado:    { key: 'afiliado',    emoji: '⭐', es: 'Afiliado/a',    va: 'Afiliat/da',      color: '#9A6208', bg: '#FBF0DC' },
  donante:     { key: 'donante',     emoji: '💛', es: 'Donante',       va: 'Donant',          color: '#C2410C', bg: '#FDEBD0' },
};

// Rango jerárquico a partir de los flags de la cuenta.
export function rangoDe(p = {}) {
  if (p.es_afiliado) return 'afiliado';
  if (p.voluntariado === 'colaborador') return 'colaborador';
  if (p.voluntariado === 'voluntario') return 'voluntario';
  return 'ciudadano';
}

// Devuelve las claves de título a mostrar (máx. 2): [rango] (+ 'donante' si aplica).
// "ciudadano" no lleva insignia (es la base): se omite salvo incluirBase=true (p. ej. el área ciudadana propia).
export function titulosDe(p = {}, incluirBase = false) {
  const out = [];
  const r = rangoDe(p);
  if (r !== 'ciudadano' || incluirBase) out.push(r);
  if (p.es_donante) out.push('donante');
  return out;
}

// Payload listo para el front: [{key, emoji, label}] en el idioma pedido.
export function titulosPayload(p = {}, lang = 'es', incluirBase = false) {
  return titulosDe(p, incluirBase).map((k) => {
    const m = TITULO_META[k];
    return { key: k, emoji: m.emoji, label: lang === 'va' ? m.va : m.es, color: m.color, bg: m.bg };
  });
}
