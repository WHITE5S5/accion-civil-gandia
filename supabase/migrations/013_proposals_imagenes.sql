-- Imágenes adjuntas en propuestas ciudadanas (array de URLs públicas del bucket media).
alter table public.proposals add column if not exists imagenes jsonb not null default '[]'::jsonb;
