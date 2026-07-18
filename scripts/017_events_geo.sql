-- 017 · Coordenadas propias para eventos (para Street View preciso en las fichas)
-- Ejecutar en Supabase → SQL Editor. Idempotente.

ALTER TABLE events ADD COLUMN IF NOT EXISTS lat double precision;
ALTER TABLE events ADD COLUMN IF NOT EXISTS lng double precision;

-- Sede de Acción Civil · Avda. República Argentina 42, Gandia
UPDATE events SET lat = 38.9651, lng = -0.1864
  WHERE slug IN ('asamblea-abierta-afiliados', 'taller-propuesta-ciudadana');

-- Actos en el centro de Gandia · Plaça Major
UPDATE events SET lat = 38.9666, lng = -0.1800
  WHERE slug IN ('9-doctubre-comunitat', 'mesas-informativas-barrios');
