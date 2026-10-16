# Atalaya · Plan de mejoras tras la revisión del MVP

> **Estado (16 oct 2026): ejecutado.** Las seis fases están implementadas en la rama `mvp`. Diferencias respecto al plan:
> la detección automática de ventanas no se ha hecho (se colocan a mano en planta o en alzado); el dictado usa el
> reconocimiento de voz del navegador (no se graba audio); la mejora con IA necesita `ANTHROPIC_API_KEY` en `apps/web/.env.local`.
> Las puertas se detectan solo si el batiente está dibujado como arco (en el proyecto de prueba, 8 de las puertas).

> Sale de la revisión del usuario sobre la app en local (16 oct 2026). Se mantiene lo que ya funciona (Panel, Presupuesto,
> Certificaciones, Informe mensual, Configuración) y se amplía lo que falta: cobertura de todas las partidas, planos sin
> fallos al cambiar de hoja, carpinterías e instalaciones, diario de obra y fotos.

## 0. Diagnóstico sobre el código actual

| Lo que se ha visto | Causa en el código | Dónde |
|---|---|---|
| Al pasar a un alzado se queda «la plantilla de la planta» | Los `elementos` no saben a qué hoja pertenecen: el visor pinta todos los elementos sobre cualquier hoja. Solo las hojas de planta comparten encuadre (`planta_base`). | `elementos` sin `hoja_id`; `VisorPlanos.tsx` (`fuenteRef` se llena con todos los elementos) |
| Solo hay 9 trabajos (tabique, medianero, trasdosado, nivelante, solado, falso techo, alicatado, rodapié, pintura) | `vinculos.REGLAS` solo reconoce esas partidas. En la obra de prueba quedan **57 de 71 partidas sin vínculo** (demoliciones, instalaciones, equipamiento, cocina, carpinterías, ventilación, residuos). | `services/planos/atalaya_planos/vinculos.py` |
| Interiores solo muestra 5 columnas | La matriz se construye a partir de los trabajos: con más trabajos aparecerán todas las partidas. Además no hay forma de agrupar por capítulo. | `interiores/page.tsx`, `calculo.matriz` |
| Alicatado en toda zona húmeda, no solo en baños | `solo_humedas` marca baño, aseo, lavadero y tendedero por igual. | `trabajos.solo_humedas`, `planos.HUMEDAS` |
| No hay instalaciones, equipamiento ni carpinterías en el plano | No existen tipos de elemento de geometría `punto` ni un elemento «vivienda» sobre el que marcar unidades. | `tipos_elemento`, `importar._importar_planos` |
| No hay diario ni fotos | No existen tablas ni pantallas. | — |

## 1. Modelo de datos (una migración nueva, `20261016000000_mejoras.sql`)

```sql
-- 1. Elementos por hoja: null = hojas de planta (comparten encuadre); una hoja concreta = solo se ve ahí (alzados…)
alter table hojas add column encuadre text;            -- 'planta' | 'propio'; el analizador lo rellena
alter table elementos add column hoja_id uuid references hojas on delete cascade;

-- 2. Ámbito de un trabajo: sustituye a solo_humedas
alter table trabajos add column ambito text not null default 'todas'
  check (ambito in ('todas', 'humedas', 'banos', 'cocinas', 'comunes'));
update trabajos set ambito = 'humedas' where solo_humedas;
alter table elementos add column uso text;             -- 'bano' | 'cocina' | 'dormitorio' | 'salon' | 'lavadero' | 'comun' | null

-- 3. Vivienda como elemento (para unidades por vivienda) → tipo 'VIV', geometría 'poligono', categoria 'vivienda'
--    Se crea al importar planos: un elemento VIV por vivienda con su contorno. Sin cambios de esquema.

-- 4. Diario de obra
create table diario (
  id uuid primary key default gen_random_uuid(),
  obra_id uuid not null references obras on delete cascade,
  fecha date not null default current_date,
  texto text not null,
  texto_original text,                                   -- lo dictado o escrito antes de mejorarlo con IA
  audio text,                                            -- ruta en el bucket si se grabó
  meteo text, personal int,                              -- opcionales, típicos de un diario de obra
  usuario uuid default auth.uid(),
  created_at timestamptz not null default now()
);

-- 5. Fotos de obra
create table fotos (
  id uuid primary key default gen_random_uuid(),
  obra_id uuid not null references obras on delete cascade,
  ruta text not null, miniatura text,                    -- bucket "obras": {obra}/fotos/{fecha}/{id}.jpg
  fecha date not null default current_date,
  vivienda text, estancia text,
  diario_id uuid references diario on delete set null,
  nota text,
  usuario uuid default auth.uid(),
  created_at timestamptz not null default now()
);
-- documentos.tipo admite 'fotos' (check ampliado). RLS igual que el resto.
```

`tipos.ts`, `datos.ts` y `calculo.ts` se amplían con `hoja_id`, `uso`, `ambito`, `Diario` y `Foto`.
`cantidad()` pasa a filtrar por `ambito` (`humedas` → `e.humedo`; `banos` → `e.uso === 'bano'`; `cocinas` → `e.uso === 'cocina'`).

## 2. Fases de trabajo

Orden pensado para que cada fase deje la app usable y para arreglar primero lo que el usuario ya ha visto fallar.

### Fase 1 · Planos sin fallos y trabajos ordenados (2–3 días)

1. **Elementos por hoja.** El analizador marca cada hoja con `encuadre`: `planta` si es de planta a escala ≤ 1:200
   (distribución, superficies, tabiquería, instalaciones), `propio` para situación, alzados, secciones y normativa.
   Los elementos importados quedan con `hoja_id = null` (planta). El visor filtra: en una hoja `planta` se ven los
   elementos de planta; en una hoja `propio` solo los que tengan ese `hoja_id`. Los elementos dibujados a mano en un
   alzado se guardan con su `hoja_id`.
   *Criterio:* al cambiar de Distribución a Alzados 1 el plano se ve limpio y el encuadre se ajusta a la hoja.
2. **Selector de trabajos agrupado.** El desplegable de «Trabajo» del visor se organiza por capítulo del presupuesto
   (`<optgroup>`: Albañilería → tabique, medianero, trasdosado, falso techo; Pavimentos y revestimientos → nivelante,
   solado, rodapié, alicatado, pintura; Instalaciones…; Carpinterías…). El mismo orden se usa en Interiores y Configuración.
3. **Ámbitos.** Alicatado pasa a `ambito = 'banos'`; el analizador rellena `elementos.uso` por el nombre de la estancia
   (baño/aseo → `bano`, cocina → `cocina`, lavadero/tendedero → `lavadero`, …). La pintura queda como está sobre
   TB/MD/TS (paredes) y sobre EST con nombre explícito «Pintura de techo» (no hay pintura de suelo).
4. **Cuadro «Tabiques de la estancia» y «Todo lo visible»** respetan el ámbito del trabajo activo (ya filtran por
   `cantidad != null`, basta con que `cantidad` conozca el ámbito).

### Fase 2 · Cobertura de todas las partidas (3–4 días)

Objetivo: que (casi) toda partida del presupuesto se pueda marcar, sobre el plano o por vivienda.

1. **Elemento «vivienda» (tipo `VIV`).** Al importar planos se crea un elemento poligonal por vivienda (y uno
   `COMUN` para zonas comunes). Es seleccionable en el plano como cualquier otro.
2. **Trabajos por unidad de vivienda.** Nuevas reglas en `vinculos.py` que crean trabajos con `magnitud = 'unidad'`
   sobre `VIV` para las partidas en `ud` que son «una por vivienda»:
   - Electricidad: instalación eléctrica, preinstalación de clima, portero, boletín · fases *Tubos y cajas 40 % · Cableado 30 % · Mecanismos 30 %*
   - Saneamiento: red de vivienda · *Colectores 60 % · Pruebas 40 %*
   - Fontanería: instalación baño, instalación cocina, aerotermo · *Tuberías 60 % · Aparatos 40 %*
   - Ventilación: turbina, conductos · una fase
   - Equipamiento de baño (plato, mampara, inodoro, lavabo, griferías, complementos) y cocina (muebles, encimera,
     electrodomésticos, fregadero, grifo) · una fase *Instalado*
   - Carpintería interior y exterior (hasta que exista la detección de la fase 3): unidades por vivienda
   Cuando una partida en `ud` tiene medición igual al número de viviendas se asigna 1 por vivienda; si no, se reparte
   proporcionalmente (y se avisa en el resumen de la importación para revisarlo en Configuración).
3. **Panel «Partidas de la vivienda»** en la barra lateral del visor: al seleccionar una vivienda (o al elegirla en
   «Capas») aparece la lista de sus trabajos por unidad agrupados por capítulo, cada uno con botones 0/25/50/75/100 %
   y fecha. Es la «pestaña para decir directamente el porcentaje» sin tocar el plano. Guarda en `avances` como el resto.
4. **Trabajos ligados a una estancia.** Lo que vive en una estancia concreta (lavabo, inodoro, plato de ducha → baño;
   fregadero, placa, horno, campana → cocina) se crea sobre `EST` con `ambito = 'banos' | 'cocinas'` y
   `magnitud = 'unidad'`: se toca el baño en el plano y se marca «Inodoro: instalado». Si una vivienda tiene dos baños y
   la partida es 1 ud por vivienda, se reparte 0,5 por baño (factor automático = ud / nº de estancias del ámbito).
5. **Partidas que siguen a mano** (demoliciones, dinteles, enfoscado de fachada, pintura exterior, residuos, limpieza):
   se mantienen en Presupuesto. En el visor y en Interiores se muestra un aviso con cuántas partidas quedan sin plano,
   con enlace a Presupuesto.
6. **Interiores con todo.** La matriz incluye las nuevas columnas; se agrupa por capítulo con cabeceras plegables y el
   filtro superior pasa a ser por capítulo. Para los trabajos por unidad la celda muestra ✓ / % en lugar de m².
7. **Presupuesto.** Sin cambios funcionales; se revisa que cada partida vinculada muestre bien «medido en plano» para
   `unidad` (nº de viviendas) y que la desviación no salte en partidas repartidas.

### Fase 3 · Carpinterías sobre el plano (3–4 días)

1. **Tipos nuevos de geometría `punto`:** `PI` puerta interior, `PE` puerta exterior, `VE` ventana/balconera.
   Dibujables a mano desde «Dibujar» (ya existe el modo; falta que el punto herede vivienda y estancia por contención
   espacial con PostGIS o en cliente).
2. **Detección automática en la planta** (`planos.py`): puertas por el arco de batiente (trazo de arco con radio entre
   0,6 y 1 m) y ventanas por el símbolo en el muro (tramos paralelos cortos dentro de un muro de fachada). Se asignan a
   vivienda y estancia como el resto. Lo que no se detecte se añade a mano.
3. **Alzados.** Como los elementos ya tienen `hoja_id`, en un alzado se pueden colocar a mano los puntos de carpintería
   exterior (`PE`, `VE`) y marcar ahí mismo; aparecen en Interiores por vivienda igual que los de planta.
4. **Vinculación:** reglas para «puerta abatible 72,5» (PI, ud), «carpintería PVC» (VE, ud), «tiradores», «buzones»
   (manual). Fases de carpintería exterior: *Premarco 30 % · Hoja 50 % · Persiana y remates 20 %*.

### Fase 4 · Diario de obra (2–3 días)

1. **Cuadro en la zona baja del Panel:** entrada del día con área de texto, botón **Dictar** y botón **Mejorar con IA**;
   debajo, los últimos 7 días plegados y enlace a la vista completa.
2. **Dictado:** `SpeechRecognition` del navegador (es-ES, funciona en Chrome y Safari en tablet y móvil, sin coste ni
   servidor). Como alternativa cuando no esté disponible: grabar con `MediaRecorder`, subir el audio al bucket y
   transcribir en el servidor (acción de servidor que llama a un proveedor de transcripción; a decidir, ver preguntas).
3. **Mejorar con IA:** acción de servidor que envía el texto a la API de Claude (Haiku 5.5, salida corta) con un
   prompt fijo: ordenar en párrafos, corregir, mantener los datos y el tono de parte de obra; se guarda `texto_original`
   para poder volver. Necesita `ANTHROPIC_API_KEY` en `.env.local`.
4. **Pestaña «Diario»** (nueva en `Pestanas.tsx`): lista por fecha, filtro por mes, imprimible. El **Informe mensual**
   añade la sección «Diario del mes» con las entradas del periodo.
5. Cada entrada puede llevar fotos (fase 5) y, opcionalmente, se genera un borrador automático con las marcas del día
   («Hoy: tabiques V1 cierre de placas 100 %, …») que el usuario completa.

### Fase 5 · Fotos de obra (2 días)

1. **Documentos → «Fotos de obra»:** nuevo tipo con captura directa desde móvil o tablet
   (`<input type="file" accept="image/*" capture="environment" multiple>`), redimensionado en cliente a 2000 px y
   miniatura de 400 px antes de subir (para que no pesen 10 MB cada una).
2. **Galería** por fecha con filtro por vivienda y estancia; cada foto se puede asociar a una vivienda, una estancia y a
   la entrada del diario del día. Visor a pantalla completa y descarga.
3. Desde el visor de planos, con una estancia seleccionada, botón «Fotos de esta estancia» (filtro de la galería).

### Fase 6 · Pulido y comprobación (1–2 días)

- Pruebas de `calculo.ts` para `ambito`, `unidad` repartida y `hoja_id`; pruebas de `vinculos.py` con el presupuesto
  de prueba (objetivo: ≥ 60 de 71 partidas vinculadas automáticamente).
- Reprocesar la obra de prueba de cero (`supabase db reset` + subir planos y presupuesto) y recorrer todas las pestañas.
- Revisar que Presupuesto, Certificaciones e Informe cuadran con las marcas hechas sobre vivienda y estancia.

## 3. Resumen de archivos que se tocan

| Área | Archivos |
|---|---|
| Esquema | `supabase/migrations/20261016000000_mejoras.sql` |
| Servicio Python | `planos.py` (encuadre, uso de estancia, elemento VIV, detección de carpinterías), `vinculos.py` (reglas y fases nuevas, reparto por vivienda), `importar.py` (hoja_id, VIV, avisos) |
| Cálculo y tipos | `lib/tipos.ts`, `lib/datos.ts`, `lib/calculo.ts` (+ pruebas) |
| Planos | `planos/VisorPlanos.tsx` (filtro por hoja, selector agrupado, panel de vivienda, puntos), `planos/page.tsx` |
| Interiores | `interiores/page.tsx` (agrupar por capítulo, celdas por unidad) |
| Panel y diario | `obras/[id]/page.tsx`, nuevo `diario/` (página, acciones, componente de dictado), `informe/page.tsx` |
| Documentos y fotos | `documentos/Documentos.tsx`, nuevo `fotos/` (galería, acciones, redimensionado) |
| Navegación | `Pestanas.tsx` (+ Diario, + Fotos o dentro de Documentos) |
| Configuración | `Configuracion.tsx` (campo ámbito, hoja de un elemento, encuadre de hojas) |

## 4. Estimación

| Fase | Días |
|---|---|
| 1 · Planos sin fallos y trabajos ordenados | 2–3 |
| 2 · Cobertura de todas las partidas | 3–4 |
| 3 · Carpinterías | 3–4 |
| 4 · Diario de obra | 2–3 |
| 5 · Fotos | 2 |
| 6 · Pulido | 1–2 |
| **Total** | **13–18 días** |

Las fases 4 y 5 no dependen de las anteriores y se pueden adelantar si interesa enseñarlas antes.

## 5. Decisiones que hay que tomar antes de empezar

1. **Transcripción de voz:** ¿basta con el dictado del navegador (gratis, en vivo, requiere conexión) o hace falta
   grabar y transcribir en servidor (coste por minuto, funciona con cualquier navegador y permite guardar el audio)?
   Propuesta: empezar con el navegador y dejar el audio para más adelante.
2. **IA para el diario:** confirmar que se puede usar la API de Claude con una clave de la empresa (coste estimado
   < 1 € al mes por obra).
3. **Partidas en `ud` con medición distinta del nº de viviendas** (p. ej. 2 inodoros en 1 vivienda con 2 baños):
   ¿reparto automático con aviso, o siempre revisión manual en Configuración? Propuesta: automático con aviso.
4. **Carpintería exterior:** ¿se marca en planta, en alzado o en los dos? Propuesta: detectar en planta y permitir
   colocar a mano en alzado; cualquiera de los dos vale para marcar.
5. **Fotos:** ¿se quieren como pestaña propia o dentro de Documentos? Propuesta: pestaña propia «Fotos» (es lo que más
   se usa desde el móvil) y en Documentos solo un acceso.
