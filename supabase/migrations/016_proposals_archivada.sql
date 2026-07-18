-- 016: permitir el estado 'archivada' en propuestas.
-- El botón "Archivar" del admin (moderación de propuestas rechazadas) fallaba
-- porque el CHECK de estado no incluía 'archivada' → UPDATE rechazado por Postgres.
-- 'archivada' queda fuera del select público (ver policy en 001_init.sql: solo
-- publicada/aprobada/en_estudio son visibles), así que la propuesta se conserva
-- pero sale de la web y de la lista de rechazadas del panel.
alter table proposals drop constraint if exists proposals_estado_check;
alter table proposals add constraint proposals_estado_check
  check (estado in ('pendiente_moderacion','publicada','rechazada','aprobada','en_estudio','archivada'));
