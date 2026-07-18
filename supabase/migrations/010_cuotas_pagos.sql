-- Registro de cuotas mensuales pagadas por afiliado (para no sumar a mano cada mes).
create table if not exists cuotas_pagos (
  id uuid primary key default gen_random_uuid(),
  afiliado_id uuid not null references afiliados(id) on delete cascade,
  periodo text not null,            -- 'YYYY-MM'
  importe numeric not null,
  created_at timestamptz default now(),
  unique (afiliado_id, periodo)     -- evita cobrar dos veces el mismo mes
);
create index if not exists cuotas_pagos_periodo on cuotas_pagos (periodo);
alter table cuotas_pagos enable row level security;
