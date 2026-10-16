#!/bin/sh
# Exporta la base local (Supabase en Docker) a apps/web/demo-privado/obra.json y las imágenes de las hojas a
# apps/web/public/demo/, para el modo demo (NEXT_PUBLIC_ATALAYA_DEMO=1). Ambas carpetas están fuera de Git.
# Uso: scripts/exportar-demo.sh   (necesita services/planos/.env con SUPABASE_SECRET_KEY)
set -eu
cd "$(dirname "$0")/.."
WEB=apps/web
mkdir -p "$WEB/demo-privado" "$WEB/public/demo"
CONTENEDOR=${CONTENEDOR:-supabase_db_atalaya}

tablas="obras documentos hojas viviendas capitulos partidas tipos_elemento trabajos fases avances avances_manuales planificacion certificaciones diario fotos"
sql="select json_build_object("
for t in $tablas; do
  sql="$sql'$t', (select coalesce(json_agg(x), '[]') from public.$t x),"
done
# elementos sin la columna geom (calculada)
sql="$sql'elementos', (select coalesce(json_agg(x), '[]') from (select id, obra_id, tipo_id, hoja_id, vivienda, etiqueta, uso, geojson,
  longitud, superficie, altura, humedo, origen, datos, created_at from public.elementos) x))"
docker exec "$CONTENEDOR" psql -U postgres -tA -c "$sql" > "$WEB/demo-privado/obra.json"
echo "Datos: $(wc -c < "$WEB/demo-privado/obra.json") bytes"

# imágenes de las hojas desde el almacenamiento local
. services/planos/.env
URL=${SUPABASE_URL:-http://127.0.0.1:54321}
docker exec "$CONTENEDOR" psql -U postgres -tA -c "select imagen from public.hojas where imagen is not null" | while read -r ruta; do
  mkdir -p "$WEB/public/demo/$(dirname "$ruta")"
  curl -sf -H "apikey: $SUPABASE_SECRET_KEY" -H "Authorization: Bearer $SUPABASE_SECRET_KEY" \
    "$URL/storage/v1/object/obras/$ruta" -o "$WEB/public/demo/$ruta"
done
echo "Imágenes: $(find "$WEB/public/demo" -type f | wc -l) ($(du -sh "$WEB/public/demo" | cut -f1))"
