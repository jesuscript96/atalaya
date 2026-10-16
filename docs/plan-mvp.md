# Atalaya · MVP de control de obra y mediciones sobre plano

> Plan técnico del primer producto real. Sale de la reunión con el product manager (6 oct 2026).
> El prototipo comercial completo se conserva en `prototipo/` y en el enlace de claude.ai. No se borra nada.

## 1. Qué es el MVP (y qué no)

**Objetivo:** controlar la ejecución de la obra midiendo sobre los planos. El usuario va a obra con la tablet, abre la planta, marca qué paredes, suelos o tramos de instalación están hechos y en qué fase. La aplicación convierte eso en metros, en porcentaje de cada partida del presupuesto y en euros. A final de mes cierra la certificación y genera el informe.

Sirve igual al project manager (día a día y reporting) y al constructor (pagar a sus contratas por lo realmente medido).

| Entra en el MVP | Queda fuera por ahora |
|---|---|
| Obras con su proyecto: planos, presupuesto y memoria | Modelo 3D y renders |
| Visor de planos por obra, disciplina y planta | Capturas con IA |
| Interpretación de planos: paredes, suelos, carpinterías, aparatos sanitarios, tramos y puntos de instalación | Suministros y pedidos |
| Mediciones automáticas (ml, m², ud) y comparación con el presupuesto | Subcontratas y contratos |
| Marcado de avance sobre el plano por fases (tabiquería, suelos, fachadas, acabados, instalaciones) | Control económico, cambios y desviaciones |
| Avance manual de partidas sin plano (movimiento de tierras…) | Calidad, reuniones, entregas y posventa |
| Presupuesto visible como un Excel (BC3 o Excel) | Integraciones con otros programas |
| Porcentaje ejecutado por partida, capítulo y obra, en cantidad y en euros | |
| Panel: curva de avance, avance real, plazo consumido, avance por capítulo, avisos sencillos | |
| Matriz de viviendas por fases (interiores) | |
| Certificación mensual: cierre del mes, origen menos anterior | |
| Informe mensual: trabajos del mes, % por partida y cronograma | |
| Varios usuarios con perfiles | |
| Fotos como evidencia del avance (opcional, ver preguntas) | |

**Principio:** los presupuestos reales tienen errores de medición. La aplicación nunca bloquea por eso: enseña la diferencia entre lo medido en plano y lo presupuestado, y deja decidir.

## 2. La pieza difícil: interpretar los planos y trabajar sobre ellos

### 2.1 Qué formato de plano permite qué

| Formato | Calidad posible | Cómo se lee |
|---|---|---|
| **DWG / DXF** (CAD original) | La mejor. Capas con nombre, bloques de símbolos (inodoros, enchufes), polilíneas exactas | `ezdxf` (DXF). DWG → DXF con ODA File Converter o LibreDWG |
| **PDF vectorial** (exportado desde AutoCAD, Revit, Archicad) | Muy buena. Líneas exactas, grosores, colores, textos con posición; muchas veces conserva las capas | `PyMuPDF`: `get_drawings()` para el vector, `get_text("dict")` para textos, grupos opcionales (capas) |
| **PDF escaneado o imagen** | Limitada. Hay que reconocer la geometría a partir de píxeles | OpenCV + modelo de segmentación de planos + revisión manual |
| **IFC** (si el arquitecto lo tiene) | Excelente para cantidades | `IfcOpenShell`. Opcional en el MVP |

Lo primero es saber qué formato tienen vuestras obras (pregunta 2).

### 2.2 Cadena de interpretación (se ejecuta al subir el proyecto)

1. **Separar y clasificar hojas.** Cada página del PDF de planos se clasifica: distribución, cotas y superficies, acabados, cimentación, estructura, fontanería, saneamiento, electricidad, climatización, PCI, alzados, secciones. También se detectan la planta (PB, P1…) y la escala del cajetín. Se hace leyendo el texto y con un modelo de visión (Claude) sobre la miniatura.
2. **Escala y registro.** La escala sale del cajetín y se comprueba con una cota real o con dos puntos que marca el usuario. Todas las hojas de una misma planta se alinean con los ejes de pilares, para que la de fontanería caiga encima de la de distribución.
3. **Extracción vectorial.** Segmentos, arcos, rellenos y textos, con su color, grosor, tipo de línea y capa.
4. **Reconocimiento de elementos.** Reglas geométricas, ayudadas por IA donde las reglas no llegan:
   - **Paredes:** pares de líneas paralelas más rayado. El grosor da el tipo (PYL 7–12 cm, fábrica 11,5, fachada 30+). Se obtiene el eje, la longitud y la división en tramos por estancia.
   - **Huecos:** puertas (arco más hoja) y ventanas (símbolo en el muro). Se descuentan de las superficies.
   - **Estancias:** polígonos cerrados entre paredes, con nombre y superficie leídos del texto («BAÑO 1 · 4,85 m²»). Comparar la superficie calculada con la rotulada sirve de control de calidad automático.
   - **Suelos:** a partir del polígono de cada estancia, con sus capas (forjado, nivelante, aislamiento, solado) según la memoria o el cuadro de acabados.
   - **Acabados por uso:** baños y cocinas tienen paredes alicatadas (perímetro × altura − huecos) y aparatos sanitarios contados.
   - **Instalaciones:** tramos por color o tipo de línea en sus hojas, con diámetro leído de las etiquetas. Puntos (enchufes, luces, tomas de agua) contados por símbolo o bloque y la leyenda del plano.
   - **Estructura y fachada:** pilares (rectángulos rellenos), paños de fachada y ventanas.
5. **Lectura de la memoria y del presupuesto con IA.** Alturas libres, tipos de tabique, cuadro de acabados por estancia, capas de suelo. Cada tipo de elemento se asocia a la partida del presupuesto que corresponde (p. ej. «tabique PYL 98/600» → partida 05.01, en m² = longitud × altura − huecos).
6. **Revisión humana.** El usuario ve lo detectado con su nivel de confianza. Confirma, corrige o dibuja lo que falta con herramientas que se ajustan a las líneas del plano (snapping). Es lo que hace que las mediciones sean de fiar.
7. **Comparación con el presupuesto.** Para cada partida, medición en plano frente a medición presupuestada y la diferencia en %. Solo informa; no bloquea.

**Cómo medimos si funciona:** con un proyecto vuestro como referencia, el objetivo del MVP es reconocer bien, sin tocar nada, al menos el 90 % de los metros de tabiquería y de las superficies de estancias de un PDF vectorial. Para un PDF escaneado el objetivo es más bajo y la revisión manual pesa más.

### 2.3 Trabajar sobre el plano (en obra, con tablet)

- **Visor:** el plano de fondo se pre-renderiza a mosaicos de alta resolución, así va fluido en una tablet aunque el PDF pese mucho. Encima va la capa vectorial de elementos, que se puede seleccionar.
- **Selección rápida:** tocar un elemento, arrastrar un lazo, seleccionar la estancia entera, la vivienda o la planta, o filtrar por capa (suelos, estructura, tabiquería, fachadas, carpinterías, acabados, instalaciones).
- **Marcar fase:** «estas paredes: cierre de placas terminado». Se pueden marcar fases intermedias y avance parcial: un tramo al 50 %, o dividir una pared en dos.
- **Resultado inmediato:** metros lineales y m² por fase, % de la partida, € ejecutados; el color del plano cambia según la fase.
- **Herramientas de medida:** distancia, polilínea, área y conteo, para medir cualquier cosa sobre el plano aunque no esté reconocida.
- **Partidas sin plano** (movimiento de tierras, seguridad y salud…): se marcan directamente en el presupuesto, en % o en cantidad.
- **Historial:** cada marca guarda quién, cuándo y (opcional) una foto. Así salen la curva diaria o semanal y el avance por contrata.

### 2.4 Del plano al dinero

```
Elemento (geometría, tipo, estancia, planta)
   └─ regla de medición → cantidad (ml, m², ud)
        └─ partida del presupuesto (precio, unidad)
             └─ plantilla de fases con pesos (perfilería 20 %, 1ª placa 20 %, aislamiento 10 %, cierre 30 %, encintado 20 %…)
                  └─ marcas de avance → cantidad ejecutada → % y € por partida → capítulo → obra
                       └─ cierre mensual = certificación (origen − anterior) → informe
```

## 3. Tecnologías

| Capa | Tecnología | Para qué |
|---|---|---|
| App web | **Next.js + TypeScript**, Tailwind, shadcn/ui, en **Vercel** | Aplicación de oficina y de obra, instalable en tablet (PWA) |
| Visor y editor de planos | **OpenLayers** con proyección métrica propia | Mosaicos del plano, capa vectorial, selección, lazo, dibujo, edición, ajuste a líneas, medición. Está pensado justo para geometría editable a gran escala |
| Rejilla de presupuesto y certificación | **AG Grid Community** | Ver el presupuesto «como un Excel», editar avances, copiar y pegar |
| Gráficos | **ECharts** | Curva de avance, avance por capítulo, cronograma |
| Base de datos | **Supabase** (Postgres + **PostGIS**), región UE | Elementos con geometría real, longitudes y áreas calculadas en base de datos, consultas espaciales (qué paredes hay en esta estancia) |
| Usuarios y permisos | Supabase Auth + seguridad por filas | Varios usuarios por cliente, perfiles por obra |
| Archivos | Supabase Storage (o Cloudflare R2 si hay muchas fotos) | Planos originales, mosaicos, fotos comprimidas, informes |
| Servicio de procesado | **Python + FastAPI** en Railway o Fly, con cola de trabajos | Todo lo pesado de planos y presupuestos |
| Lectura de PDF | **PyMuPDF** | Vector, textos, capas y render a mosaicos |
| Lectura de CAD | **ezdxf** + **ODA File Converter** (DWG→DXF) | Capas y bloques exactos (revisar la licencia de ODA para uso comercial) |
| Geometría | **Shapely 2 / GEOS**, **NumPy**, **rtree** | Paredes por pares paralelos, ejes, cierre de estancias (polygonize), descuento de huecos |
| Imagen (planos escaneados) | **OpenCV** + modelo de segmentación de planos | Solo si hay planos sin vector |
| IA | **API de Claude** (Opus 5.5 para interpretar hojas y memoria; Sonnet 5.5 para tareas en lote) con salidas estructuradas | Clasificar hojas, leer cajetín y leyendas, asignar elementos a partidas, leer la memoria y el cuadro de acabados |
| Presupuesto | Lector propio de **BC3 (FIEBDC-3)** + **openpyxl/pandas** para Excel | Importar capítulos, partidas, mediciones y precios |
| Exportaciones | **ExcelJS** (Excel con formato) y **Playwright** (PDF a partir de plantilla HTML) | Certificación e informe mensual con el aspecto de los vuestros |
| Calidad | **Vitest** (reglas de cálculo), **Playwright** (flujos), juego de planos de referencia con medidas comprobadas | Que las mediciones no se rompan entre versiones |
| Errores y registro | Sentry + tabla de auditoría | Quién cambió qué y cuándo |

**Estructura del repositorio**
```
apps/web            Next.js (oficina + obra)
services/planos     Python: ingesta, interpretación, mosaicos, BC3, exportaciones
supabase/           migraciones SQL, políticas de seguridad, semillas
packages/shared     tipos y reglas de cálculo compartidas
docs/               decisiones y criterios de aceptación
fixtures/           proyecto de referencia con mediciones verificadas
```

**Coste aproximado de infraestructura:** Supabase Pro 25 $/mes, Vercel Pro 20 $/usuario de desarrollo, servicio Python 10–20 $/mes y IA unos 2–10 € por proyecto interpretado. En total, del orden de 60–100 €/mes.

## 4. Orden de trabajo

| Fase | Contenido | Resultado | Duración orientativa |
|---|---|---|---|
| 0 · Prueba con vuestro proyecto | Interpretar 2 plantas reales y medir el acierto frente a vuestras mediciones | Saber qué se automatiza y qué se revisa a mano | 2 semanas |
| 1 · Base | Usuarios, obras, subida del proyecto, visor de planos, presupuesto importado y visible, avance manual por partida, panel básico | Ya se puede usar para ver planos y presupuesto en obra | 3–4 semanas |
| 2 · Medición sobre plano | Interpretación automática, revisión, asociación con partidas, fases, marcado en obra, % automático, matriz de viviendas | El núcleo del producto | 5–6 semanas |
| 3 · Mes y reporting | Cierre mensual y certificación, informe mensual (PDF y Excel), curva y plazo, avisos sencillos | Lo que se manda al cliente y a dirección | 2–3 semanas |
| 4 · Instalaciones y piloto | Hojas de instalaciones, puntos y tramos; ajustes con una obra real; fotos si entran | MVP completo en una obra piloto | 2–3 semanas |

Total orientativo: **14–18 semanas**. La fase 0 decide si el plazo se mantiene: depende sobre todo del formato de los planos.
