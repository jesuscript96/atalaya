-- Atalaya · mejoras tras la revisión del MVP (16 oct 2026)
-- 1. Elementos por hoja (los alzados no muestran la planta)
-- 2. Ámbito de los trabajos (baños, cocinas, viviendas, zonas comunes…) y filtro por etiqueta
-- 3. Uso de cada estancia; elemento «vivienda» (VIV) y tipos de carpintería (PI, PE, VE)
-- 4. Diario de obra
-- 5. Fotos de obra

-- ───────────── 1. Hojas y elementos ─────────────
-- 'planta': comparte encuadre con el resto de plantas (se ven los elementos importados);
-- 'propio': hoja con su propio encuadre (alzados, secciones, situación…): solo se ven los elementos dibujados en ella.
alter table public.hojas add column if not exists encuadre text not null default 'planta'
  check (encuadre in ('planta', 'propio'));
update public.hojas set encuadre = 'propio'
  where disciplina in ('situacion', 'alzados', 'secciones', 'estado_actual', 'normativa', 'otros') or escala is null or escala > 200;

alter table public.elementos add column if not exists hoja_id uuid references public.hojas on delete cascade;
create index if not exists elementos_hoja_idx on public.elementos (hoja_id);

-- uso de la estancia (o de la estancia junto a la que está el elemento): bano, cocina, lavadero, dormitorio, salon, paso, comun
alter table public.elementos add column if not exists uso text;
update public.elementos e set uso = case
    when e.vivienda = 'COMUN' then 'comun'
    when upper(coalesce(e.etiqueta, '')) ~ '^(BAÑO|BANO|ASEO)' then 'bano'
    when upper(coalesce(e.etiqueta, '')) ~ 'COCINA' then 'cocina'
    when upper(coalesce(e.etiqueta, '')) ~ '^(LAVADERO|TENDEDERO|TENDIDO)' then 'lavadero'
    when upper(coalesce(e.etiqueta, '')) ~ '^(DORMITORIO|DORM|HAB)' then 'dormitorio'
    when upper(coalesce(e.etiqueta, '')) ~ '^(SALON|SALÓN|ESTAR|COMEDOR)' then 'salon'
    when upper(coalesce(e.etiqueta, '')) ~ '^(PASO|PASILLO|VESTIBULO|VESTÍBULO|RECIBIDOR|DISTRIBUIDOR)' then 'paso'
    else null end
  from public.tipos_elemento t
  where t.id = e.tipo_id and t.clave = 'EST' and e.uso is null;

-- ───────────── 2. Trabajos: ámbito y filtro ─────────────
alter table public.trabajos add column if not exists ambito text not null default 'todas'
  check (ambito in ('todas', 'humedas', 'banos', 'cocinas', 'viviendas', 'comunes'));
alter table public.trabajos add column if not exists filtro text;   -- texto que debe contener la etiqueta del elemento (p. ej. «72»)
update public.trabajos set ambito = 'humedas' where solo_humedas;
-- el alicatado va solo en baños; la pintura sobre estancias es la del techo
update public.trabajos set ambito = 'banos' where lower(nombre) like '%alicatado%';
update public.trabajos tr set nombre = 'Pintura de techo'
  from public.tipos_elemento t where t.id = tr.tipo_id and t.clave = 'EST' and tr.nombre = 'Pintura';
alter table public.trabajos drop column if exists solo_humedas;

-- ───────────── 3. Tipos nuevos y elemento vivienda ─────────────
do $$
declare o record; v record; tviv uuid;
begin
  for o in select distinct obra_id from public.hojas loop
    insert into public.tipos_elemento (obra_id, clave, nombre, categoria, geometria, color, orden) values
      (o.obra_id, 'VIV', 'Vivienda (unidades por vivienda)', 'vivienda', 'poligono', '#1c5f8f', 90),
      (o.obra_id, 'PI', 'Puerta interior', 'carpinterias', 'punto', '#8a5a00', 60),
      (o.obra_id, 'PE', 'Puerta exterior', 'carpinterias', 'punto', '#5a3a00', 61),
      (o.obra_id, 'VE', 'Ventana / balconera', 'carpinterias', 'punto', '#0e7c86', 62)
    on conflict (obra_id, clave) do nothing;
    select id into tviv from public.tipos_elemento where obra_id = o.obra_id and clave = 'VIV';
    for v in select * from public.viviendas where obra_id = o.obra_id and geojson is not null loop
      if not exists (select 1 from public.elementos where obra_id = o.obra_id and tipo_id = tviv and vivienda = v.codigo) then
        insert into public.elementos (obra_id, tipo_id, vivienda, etiqueta, geojson, superficie, humedo, uso, origen, datos)
        values (o.obra_id, tviv, v.codigo, v.codigo, v.geojson, coalesce(v.superficie_util, v.superficie_detectada), false,
                case when v.codigo = 'COMUN' then 'comun' else null end, 'plano', '{}');
      end if;
    end loop;
  end loop;
end $$;

-- ───────────── 4. Diario de obra ─────────────
create table if not exists public.diario (
  id uuid primary key default gen_random_uuid(),
  obra_id uuid not null references public.obras on delete cascade,
  fecha date not null default current_date,
  texto text not null,
  texto_original text,                -- lo escrito o dictado antes de mejorarlo con IA
  audio text,                         -- ruta de la grabación en el almacenamiento (opcional)
  meteo text,
  personal int,
  usuario uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists diario_obra_fecha_idx on public.diario (obra_id, fecha desc);

-- ───────────── 5. Fotos de obra ─────────────
create table if not exists public.fotos (
  id uuid primary key default gen_random_uuid(),
  obra_id uuid not null references public.obras on delete cascade,
  ruta text not null,                 -- bucket "obras": {obra}/fotos/{id}.jpg
  miniatura text,                     -- {obra}/fotos/{id}-min.jpg
  fecha date not null default current_date,
  vivienda text,
  estancia text,
  diario_id uuid references public.diario on delete set null,
  nota text,
  ancho int, alto int,
  usuario uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists fotos_obra_fecha_idx on public.fotos (obra_id, fecha desc);

alter table public.documentos drop constraint if exists documentos_tipo_check;
alter table public.documentos add constraint documentos_tipo_check
  check (tipo in ('planos', 'presupuesto', 'memoria', 'planificacion', 'fotos', 'otro'));

-- ───────────── Seguridad ─────────────
do $$
declare t text;
begin
  foreach t in array array['diario', 'fotos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "usuarios autenticados" on public.%I', t);
    execute format('create policy "usuarios autenticados" on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;
