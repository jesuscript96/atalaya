# Atalaya · MVP

Control de avance de obra sobre plano: se suben los planos (PDF vectorial de CAD) y el presupuesto (BC3, Excel o PDF), la app
mide los elementos del plano, los enlaza con las partidas y, al marcar fases sobre el plano, calcula el % ejecutado de cada
partida, las certificaciones mensuales y el informe del mes.

El prototipo comercial completo (con 3D, IA, económico…) vive aparte, en el repositorio de la web corporativa (`demo/`).

## Qué hace

| Pestaña | |
|---|---|
| **Panel** | PEM, ejecutado a origen, avance real, plazo consumido, desviación frente a lo previsto, curva de avance, avance por capítulo y el **diario de obra** del día (con dictado y redacción con IA). |
| **Planos** | Visor de hojas (OpenLayers) con capas por tipo: tabiques (TB, MD, TS…), estancias, viviendas (VIV) y carpinterías (PI, PE, VE). El selector de trabajos va por capítulo del presupuesto. Se seleccionan elementos (tocar, recuadro, todo lo visible, tabiques de una estancia) y se marca la fase con su % y fecha. El panel **Por vivienda** marca las partidas por unidad (instalaciones, equipamiento, cocina, carpinterías) sin tocar el plano. Las hojas de planta comparten encuadre; alzados y secciones solo muestran lo que se dibuje en ellas. |
| **Presupuesto** | Rejilla tipo Excel: medición del presupuesto frente a lo medido en plano (desviación), % y € ejecutado. Las partidas sin plano (demoliciones, fachada, residuos…) se anotan a mano. Exporta a Excel. |
| **Interiores** | Matriz viviendas × partidas agrupada por capítulo, con enlace a cada celda en el plano. |
| **Certificaciones** | Cierre mensual a origen − anterior, al cliente o al contratista (coeficiente), con gastos generales, beneficio industrial, IVA y retención activables. Copia fija al cerrar; documento imprimible / PDF y Excel. |
| **Informe mensual** | Trabajos del mes, diario del mes, avance por capítulo y por partida, curva y cronograma. Imprimible. |
| **Diario** | Diario de obra por día: texto escrito o dictado (reconocimiento de voz del navegador), tiempo, personal, mejora de redacción con la API de Claude (opcional, `ANTHROPIC_API_KEY`). |
| **Fotos** | Fotos de obra desde el móvil o la tablet (abre la cámara), reducidas en el navegador antes de subir, por fecha, vivienda y estancia. |
| **Documentos** | Subida y procesado de planos y presupuesto. |
| **Configuración** | Datos de la obra, conceptos de certificación, planificación por capítulo (o importada de Excel/MS Project), vínculos plano ↔ presupuesto (ámbito, filtro, fases y pesos) y encuadre de cada hoja. |

## Estructura

```
apps/web          Next.js 16 (App Router) + Supabase SSR · OpenLayers · AG Grid · ECharts · ExcelJS
services/planos   Servicio Python (FastAPI): lectura de planos y presupuestos, importación y vinculación
supabase          Esquema (Postgres + PostGIS, RLS) y configuración local
scripts           Utilidades (alta de usuarios)
docs              Plan del MVP
fixtures/private  Documentos reales de prueba — fuera del repositorio
```

### Interpretación de planos (`services/planos/atalaya_planos/planos.py`)

1. **Hojas**: título, disciplina y escala (`1:N` del cajetín) de cada página; se rasteriza a PNG para el fondo del visor.
2. **Tabiques**: se lee el dibujo vectorial (PyMuPDF). Cada tipo de la leyenda de tabiquería tiene un color; los trazos de
   ese color se convierten en ejes, se unen los tramos colineales y se miden en metros con la escala.
3. **Estancias y viviendas**: rótulos «Sup: X m²» y cuadro de superficies; contorno de viviendas por cierre morfológico de los
   muros; estancias húmedas (baño, aseo, lavadero, tendedero) por nombre; altura por los rótulos de falso techo.
4. **Puertas**: los batientes dibujados como arcos a trazos se agrupan y se ajusta una circunferencia; el radio da el ancho de hoja (62, 72, 82) y el punto queda en el hueco, con su vivienda y estancia.
5. Cada estancia recibe un **uso** (baño, cocina, lavadero…) por su nombre, y cada vivienda es también un elemento (`VIV`) sobre el que se marcan las partidas por unidad.
6. Todo queda en metros, en el sistema de la hoja (origen abajo a la izquierda), como GeoJSON en `elementos`. Las hojas de planta comparten encuadre (`hojas.encuadre = 'planta'`); el resto tienen encuadre propio.

El **presupuesto** (`presupuesto.py`) se lee de BC3 (registros `~C/~D/~M`), Excel (detección de cabeceras) o PDF (columnas).
La **vinculación** (`vinculos.py`) reconoce partidas por su texto y crea trabajos con su forma de medir, su **ámbito** (todas,
zonas húmedas, baños, cocinas, por vivienda, zonas comunes), un filtro por etiqueta opcional y sus fases: tabiquería, suelos y
techos, acabados, carpinterías, instalaciones por vivienda y equipamiento de baño y cocina por estancia. Las partidas en `ud` se
reparten entre los elementos del ámbito (5 inodoros entre 5 baños → 1 por baño). Las variantes «H» se asignan a zonas húmedas.

### Modelo de avance

`elemento` (geometría, uso, hoja) → `tipo` → `trabajo` (partida, partida en húmedo, magnitud, factor, ámbito, filtro) → `fases` con peso.
Cada marca es un registro en `avances` (el estado es la última por elemento y fase), así se puede calcular cualquier fecha:
cantidad ejecutada = Σ cantidad del elemento × Σ (peso de fase × %). Por defecto se certifica el % medido en plano aplicado a la
medición del presupuesto (el presupuesto rige); se puede cambiar a certificar lo medido. Los huecos no se descuentan.
El cálculo está en `apps/web/src/lib/calculo.ts` (con pruebas).

## Puesta en marcha (local)

Requisitos: Node 22+, pnpm, Docker, [Supabase CLI](https://supabase.com/docs/guides/cli), Python 3.12+.

```bash
# 1. Base de datos, autenticación y almacenamiento
supabase start -x vector,logflare,imgproxy,edge-runtime
supabase db reset

# 2. Usuario (las altas públicas están desactivadas)
SUPABASE_SECRET_KEY=$(supabase status -o env | grep SERVICE_ROLE_KEY | cut -d= -f2 | tr -d '"') \
  node scripts/crear-usuario.mjs obra@empresa.com 'una-contraseña'

# 3. Servicio de planos
cd services/planos
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env   # SUPABASE_SECRET_KEY: clave secreta de `supabase status`; SERVICIO_TOKEN: cualquiera
./dev.sh               # http://127.0.0.1:8000

# 4. Web
cd apps/web
cp .env.example .env.local   # clave publicable de `supabase status` y el mismo SERVICIO_TOKEN
pnpm install && pnpm dev     # http://localhost:3000
```

Pruebas: `pnpm --dir apps/web test` (cálculo) y `services/planos/.venv/bin/pytest services/planos/tests`
(las de documentos reales se saltan si no está `fixtures/private/esperado.json`).

## Despliegue (pendiente)

Web en Vercel (raíz `apps/web`), Supabase gestionado (Postgres + Storage) y el servicio de planos como contenedor
(`services/planos/Dockerfile`, p. ej. Railway, Fly.io o Cloud Run).

## Fuera del MVP

3D, capturas e IA con fotos, suministros, subcontratas, control económico, cambios, calidad, entregas, integraciones,
avisos y fotos. Siguientes pasos naturales: instalaciones (puntos y tramos), versiones de planos, asistencia con IA para
vincular partidas y leer planos no vectoriales.

## Demo pública (Vercel, sin login)

Con `NEXT_PUBLIC_ATALAYA_DEMO=1` la app no usa Supabase ni pide acceso: lee una copia fija de una obra
(`apps/web/demo-privado/obra.json` y las imágenes de las hojas en `apps/web/public/demo/`) y guarda los cambios de la
visita en un registro de Vercel Blob privado (`BLOB_READ_WRITE_TOKEN`), para que todas las instancias del servidor vean
lo mismo. «Restablecer», en la cabecera, vuelve al estado inicial. El código está en `apps/web/src/lib/demo/`.

La copia de la obra **no está en el repositorio** (son datos de un cliente). Para publicar la demo:

```bash
scripts/exportar-demo.sh                        # base local → demo-privado/ y public/demo/
cd apps/web
vercel pull --yes --environment=production
mv .env.local ../.env.local.aparte              # que no entren claves locales en la compilación
vercel build --prod && vercel deploy --prebuilt --prod
mv ../.env.local.aparte .env.local
```

El proyecto de Vercel `atalaya` no está conectado a GitHub a propósito: una compilación desde el repositorio no
tendría la copia de la obra.
