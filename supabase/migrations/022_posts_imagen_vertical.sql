-- Miniatura vertical opcional para posts de vídeo (tile del Inicio).
-- La horizontal (imagen) se usa en la página de detalle y en Actualidad;
-- esta vertical se usa en el tile "último vídeo" del Inicio.
alter table posts add column if not exists imagen_vertical text;
