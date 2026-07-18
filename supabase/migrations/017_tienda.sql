-- 017: Tienda de merchandising del partido (productos, variantes, pedidos).
-- Pagos vía Stripe Checkout (netlify/functions/tienda.mjs) + confirmación en stripe-webhook.mjs.
-- NOTA: 016 ya está ocupado por 016_proposals_archivada.sql → esta migración es la 017.

-- ---------- Catálogo ----------
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  nombre_es text not null,
  nombre_va text not null,
  descripcion_es text not null default '',
  descripcion_va text not null default '',
  precio_cents int not null check (precio_cents >= 0),
  categoria text not null default 'general',
  imagen_url text,
  galeria jsonb not null default '[]',
  activo boolean not null default true,
  destacado boolean not null default false,
  orden int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists products_slug_idx on public.products (slug);
create index if not exists products_activo_idx on public.products (activo);
alter table public.products enable row level security;

create table if not exists public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  talla text,               -- NULL = producto sin tallas
  sku text,
  stock int not null default 0 check (stock >= 0),
  precio_cents int,         -- NULL = hereda el precio del producto
  orden int not null default 0
);
create index if not exists product_variants_product_idx on public.product_variants (product_id);
alter table public.product_variants enable row level security;

-- ---------- Pedidos ----------
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  numero text unique not null,                 -- p.ej. ACG-2026-0001
  user_id uuid references auth.users(id) on delete set null,
  email text,
  nombre text,
  estado text not null default 'pendiente_pago',   -- pendiente_pago | pagado | cancelado
  metodo_entrega text,                             -- recogida | envio
  direccion jsonb,
  subtotal_cents int,
  envio_cents int,
  total_cents int,
  stripe_session_id text,
  stripe_payment_intent text,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index if not exists orders_estado_idx on public.orders (estado);
create index if not exists orders_user_idx on public.orders (user_id);
alter table public.orders enable row level security;

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid,
  variant_id uuid,
  nombre text,
  talla text,
  precio_cents int,
  cantidad int not null check (cantidad > 0)
);
create index if not exists order_items_order_idx on public.order_items (order_id);
alter table public.order_items enable row level security;

-- ---------- Políticas RLS ----------
-- Catálogo: lectura pública. Escrituras solo service_role (admin.mjs / funciones).
drop policy if exists products_public_read on public.products;
create policy products_public_read on public.products
  for select using (activo = true);

drop policy if exists product_variants_public_read on public.product_variants;
create policy product_variants_public_read on public.product_variants
  for select using (true);

-- Pedidos: cada usuario ve solo los suyos. order_items sin política pública
-- (solo se accede vía service_role desde las funciones).
drop policy if exists orders_own_read on public.orders;
create policy orders_own_read on public.orders
  for select using (auth.uid() = user_id);

-- ---------- SEED (productos de prueba) ----------
insert into public.products (slug, nombre_es, nombre_va, descripcion_es, descripcion_va, precio_cents, categoria, destacado, orden) values
  ('camiseta-accion-civil', 'Camiseta Acción Civil', 'Samarreta Acció Civil',
   'Camiseta de algodón orgánico con el logo de Acción Civil Gandia.',
   'Samarreta de cotó orgànic amb el logo d’Acció Civil Gandia.',
   1500, 'ropa', true, 1),
  ('sudadera-accion-civil', 'Sudadera Acción Civil', 'Dessuadora Acció Civil',
   'Sudadera con capucha, tejido cálido, logo bordado.',
   'Dessuadora amb caputxa, teixit càlid, logo brodat.',
   2800, 'ropa', true, 2),
  ('chapa-accion-civil', 'Chapa Acción Civil', 'Xapa Acció Civil',
   'Chapa metálica de 38 mm con el emblema del partido.',
   'Xapa metàl·lica de 38 mm amb l’emblema del partit.',
   200, 'complementos', false, 3),
  ('tote-bag-accion-civil', 'Tote bag Acción Civil', 'Tote bag Acció Civil',
   'Bolsa de tela reutilizable, asas largas, serigrafía a una tinta.',
   'Bossa de tela reutilitzable, nanses llargues, serigrafia a una tinta.',
   800, 'complementos', false, 4)
on conflict (slug) do nothing;

-- Variantes con tallas (precio hereda del producto: precio_cents = NULL)
insert into public.product_variants (product_id, talla, sku, stock, precio_cents, orden)
select p.id, v.talla, 'CAM-' || v.talla, v.stock, null, v.orden
from public.products p
cross join (values ('S',30,1),('M',40,2),('L',40,3),('XL',25,4)) as v(talla, stock, orden)
where p.slug = 'camiseta-accion-civil'
on conflict do nothing;

insert into public.product_variants (product_id, talla, sku, stock, precio_cents, orden)
select p.id, v.talla, 'SUD-' || v.talla, v.stock, null, v.orden
from public.products p
cross join (values ('S',20,1),('M',25,2),('L',25,3),('XL',20,4)) as v(talla, stock, orden)
where p.slug = 'sudadera-accion-civil'
on conflict do nothing;

-- Variantes sin talla (una única variante por producto)
insert into public.product_variants (product_id, talla, sku, stock, precio_cents, orden)
select id, null, 'CHAPA', 50, null, 1 from public.products where slug = 'chapa-accion-civil'
on conflict do nothing;

insert into public.product_variants (product_id, talla, sku, stock, precio_cents, orden)
select id, null, 'TOTE', 40, null, 1 from public.products where slug = 'tote-bag-accion-civil'
on conflict do nothing;
