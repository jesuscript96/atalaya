-- Atalaya · esquema del MVP: control de obra y mediciones sobre plano
-- Un solo cliente con varios usuarios: cualquier usuario autenticado trabaja con todas las obras.

create extension if not exists postgis with schema extensions;

-- ───────────── Obras y documentos ─────────────
create table public.obras (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  direccion text,
  cliente text,
  fecha_inicio date,
  fecha_fin date,
  -- conceptos que se pueden activar o desactivar en certificaciones e informes;
  -- criterio: 'porcentaje' aplica el % medido en plano a la medición del presupuesto, 'medicion' certifica lo medido
  ajustes jsonb not null default '{"gg": 0.13, "bi": 0.06, "iva": 0.10, "retencion": 0.05,
                                   "aplicar": {"gg": false, "bi": false, "iva": true, "retencion": false},
                                   "criterio": "porcentaje", "coeficiente_contratista": 1}',
  created_at timestamptz not null default now()
);

create table public.documentos (
  id uuid primary key default gen_random_uuid(),
  obra_id uuid not null references public.obras on delete cascade,
  tipo text not null check (tipo in ('planos', 'presupuesto', 'memoria', 'planificacion', 'otro')),
  nombre text not null,
  ruta text not null,                 -- ruta en el almacenamiento (bucket "obras")
  tamano bigint,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'procesando', 'listo', 'error')),
  mensaje text,
  resumen jsonb,
  created_at timestamptz not null default now()
);

-- ───────────── Planos ─────────────
create table public.hojas (
  id uuid primary key default gen_random_uuid(),
  obra_id uuid not null references public.obras on delete cascade,
  documento_id uuid references public.documentos on delete cascade,
  pagina int not null,
  titulo text not null,
  disciplina text not null,
  escala int,
  ancho_m double precision,
  alto_m double precision,
  imagen text,                        -- ruta de la imagen de fondo en el almacenamiento
  principal boolean not null default false,
  orden int not null default 0
);

create table public.viviendas (
  id uuid primary key default gen_random_uuid(),
  obra_id uuid not null references public.obras on delete cascade,
  codigo text not null,
  superficie_util numeric,
  superficie_detectada numeric,
  geojson jsonb,
  unique (obra_id, codigo)
);

-- ───────────── Presupuesto ─────────────
create table public.capitulos (
  id uuid primary key default gen_random_uuid(),
  obra_id uuid not null references public.obras on delete cascade,
  codigo text not null,
  nombre text not null,
  orden int not null default 0
);

create table public.partidas (
  id uuid primary key default gen_random_uuid(),
  obra_id uuid not null references public.obras on delete cascade,
  capitulo_id uuid not null references public.capitulos on delete cascade,
  codigo text not null,
  resumen text not null,
  descripcion text,
  unidad text not null default 'ud',
  medicion numeric not null default 0,
  precio numeric not null default 0,
  orden int not null default 0
);

-- ───────────── Elementos medibles ─────────────
-- Tipo de elemento (tabique TB, trasdosado TS, estancia…) con su geometría y aspecto
create table public.tipos_elemento (
  id uuid primary key default gen_random_uuid(),
  obra_id uuid not null references public.obras on delete cascade,
  clave text not null,
  nombre text not null,
  categoria text not null,            -- tabiqueria, suelos, techos, fachadas, carpinterias, acabados, instalaciones, estructura
  geometria text not null check (geometria in ('linea', 'poligono', 'punto')),
  color text not null default '#888888',
  orden int not null default 0,
  unique (obra_id, clave)
);

-- Trabajo: lo que se ejecuta sobre un tipo de elemento y se paga en una partida
create table public.trabajos (
  id uuid primary key default gen_random_uuid(),
  obra_id uuid not null references public.obras on delete cascade,
  tipo_id uuid not null references public.tipos_elemento on delete cascade,
  partida_id uuid references public.partidas on delete set null,
  partida_humeda_id uuid references public.partidas on delete set null, -- variante para zonas húmedas (placa H…)
  nombre text not null,
  magnitud text not null check (magnitud in ('longitud', 'superficie_pared', 'superficie', 'perimetro', 'perimetro_altura', 'unidad')),
  factor numeric not null default 1,  -- caras, desperdicio…
  solo_humedas boolean not null default false,
  orden int not null default 0
);

create table public.fases (
  id uuid primary key default gen_random_uuid(),
  obra_id uuid not null references public.obras on delete cascade,
  trabajo_id uuid not null references public.trabajos on delete cascade,
  nombre text not null,
  peso numeric not null default 1,    -- parte del importe del trabajo
  orden int not null default 0
);

create table public.elementos (
  id uuid primary key default gen_random_uuid(),
  obra_id uuid not null references public.obras on delete cascade,
  tipo_id uuid not null references public.tipos_elemento on delete cascade,
  vivienda text,
  etiqueta text,
  geojson jsonb not null,             -- geometría en metros, sistema de la hoja (origen abajo a la izquierda)
  geom extensions.geometry generated always as (extensions.st_geomfromgeojson(geojson::text)) stored,
  longitud numeric,
  superficie numeric,
  altura numeric,
  humedo boolean not null default false,
  origen text not null default 'plano' check (origen in ('plano', 'manual')),
  datos jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index elementos_obra_idx on public.elementos (obra_id);
create index elementos_geom_idx on public.elementos using gist (geom);

-- ───────────── Avance ─────────────
-- Cada marca deja constancia: el estado actual es la última por elemento y fase.
create table public.avances (
  id bigint generated always as identity primary key,
  obra_id uuid not null references public.obras on delete cascade,
  elemento_id uuid not null references public.elementos on delete cascade,
  fase_id uuid not null references public.fases on delete cascade,
  porcentaje numeric not null check (porcentaje between 0 and 100),
  fecha date not null default current_date,
  usuario uuid default auth.uid(),
  nota text,
  created_at timestamptz not null default now()
);
create index avances_obra_idx on public.avances (obra_id, elemento_id, fase_id, fecha, created_at);

-- Avance de partidas que no se miden en plano (cantidad ejecutada a origen)
create table public.avances_manuales (
  id bigint generated always as identity primary key,
  obra_id uuid not null references public.obras on delete cascade,
  partida_id uuid not null references public.partidas on delete cascade,
  cantidad numeric not null check (cantidad >= 0),
  fecha date not null default current_date,
  usuario uuid default auth.uid(),
  nota text,
  created_at timestamptz not null default now()
);
create index avances_manuales_obra_idx on public.avances_manuales (obra_id, partida_id, fecha, created_at);

-- Planificación sencilla por capítulo (opcional): sirve para la curva prevista
create table public.planificacion (
  id uuid primary key default gen_random_uuid(),
  obra_id uuid not null references public.obras on delete cascade,
  capitulo_id uuid not null references public.capitulos on delete cascade,
  inicio date not null,
  fin date not null,
  unique (obra_id, capitulo_id)
);

-- ───────────── Certificaciones ─────────────
create table public.certificaciones (
  id uuid primary key default gen_random_uuid(),
  obra_id uuid not null references public.obras on delete cascade,
  destinatario text not null default 'cliente' check (destinatario in ('cliente', 'contratista')),
  numero int not null,
  periodo text not null,              -- AAAA-MM
  fecha_cierre date not null,
  ajustes jsonb not null,             -- conceptos aplicados en el cierre
  lineas jsonb not null,              -- [{partida_id, codigo, resumen, unidad, precio, origen, anterior}]
  totales jsonb not null,
  usuario uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (obra_id, destinatario, periodo),
  unique (obra_id, destinatario, numero)
);

-- ───────────── Seguridad ─────────────
do $$
declare t text;
begin
  foreach t in array array['obras','documentos','hojas','viviendas','capitulos','partidas','tipos_elemento',
                           'trabajos','fases','elementos','avances','avances_manuales','planificacion','certificaciones']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "usuarios autenticados" on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

insert into storage.buckets (id, name, public, file_size_limit)
values ('obras', 'obras', false, 209715200)
on conflict (id) do nothing;

create policy "obras: lectura" on storage.objects for select to authenticated using (bucket_id = 'obras');
create policy "obras: subida" on storage.objects for insert to authenticated with check (bucket_id = 'obras');
create policy "obras: cambio" on storage.objects for update to authenticated using (bucket_id = 'obras');
create policy "obras: borrado" on storage.objects for delete to authenticated using (bucket_id = 'obras');
