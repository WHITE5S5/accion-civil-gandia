-- 018 · Documentos oficiales por actuación (los registros salen de Transparencia
-- y se muestran en la ficha de SU actuación). Ejecutar en Supabase → SQL Editor. Idempotente.

ALTER TABLE actuaciones ADD COLUMN IF NOT EXISTS docs jsonb DEFAULT '[]'::jsonb;

-- Aparcamientos para bicicletas y patinetes en la playa: solicitud + respuesta oficiales
UPDATE actuaciones SET docs = '[
  {"title":"Registro oficial: solicitud aparcabicis (2023)","meta":"PDF · registro de entrada E-RE-24266 del Ayuntamiento","href":"https://msbrdowdkwqrrdlfeztj.supabase.co/storage/v1/object/public/media/docs/registro-solicitud-aparcabicis-2023.pdf"},
  {"title":"Respuesta del Ayuntamiento: aparcabicis","meta":"PDF · respuesta oficial a nuestra solicitud","href":"https://msbrdowdkwqrrdlfeztj.supabase.co/storage/v1/object/public/media/docs/registro-respuesta-aparcabicis-2023.pdf"}
]'::jsonb WHERE slug = 'aparcamientos-bici-playa';

-- WiFi y techado del recinto del Raval: registro oficial de entrada
UPDATE actuaciones SET docs = '[
  {"title":"Registro oficial: WiFi y techado del Raval (2023)","meta":"PDF · registro de entrada E-RE-24007 del Ayuntamiento","href":"https://msbrdowdkwqrrdlfeztj.supabase.co/storage/v1/object/public/media/docs/registro-solicitud-wifi-raval-2023.pdf"}
]'::jsonb WHERE slug = 'wifi-techado-raval';
