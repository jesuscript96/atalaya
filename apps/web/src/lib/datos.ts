import "server-only";
import { notFound } from "next/navigation";
import { supabaseServidor } from "./supabase/server";
import type { DatosObra, Obra } from "./tipos";

type Cliente = Awaited<ReturnType<typeof supabaseServidor>>;

/** Lee todas las filas de una tabla de la obra, por páginas (la API devuelve como máximo 1000 por petición). */
async function todas<T>(sb: Cliente, tabla: string, obraId: string, columnas = "*", orden = "id"): Promise<T[]> {
  const out: T[] = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await sb.from(tabla).select(columnas).eq("obra_id", obraId).order(orden).range(desde, desde + 999);
    if (error) throw new Error(`${tabla}: ${error.message}`);
    out.push(...(data as T[]));
    if (!data || data.length < 1000) return out;
  }
}

export async function cargarObra(id: string): Promise<Obra> {
  const sb = await supabaseServidor();
  const { data } = await sb.from("obras").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  return data as Obra;
}

export async function cargarDatos(id: string): Promise<DatosObra> {
  const sb = await supabaseServidor();
  const obra = await cargarObra(id);
  const [capitulos, partidas, tipos, trabajos, fases, elementos, avances, manuales, planificacion, viviendas] = await Promise.all([
    todas<DatosObra["capitulos"][number]>(sb, "capitulos", id, "id,codigo,nombre,orden", "orden"),
    todas<DatosObra["partidas"][number]>(sb, "partidas", id, "id,capitulo_id,codigo,resumen,descripcion,unidad,medicion,precio,orden", "orden"),
    todas<DatosObra["tipos"][number]>(sb, "tipos_elemento", id, "id,clave,nombre,categoria,geometria,color,orden", "orden"),
    todas<DatosObra["trabajos"][number]>(sb, "trabajos", id, "id,tipo_id,partida_id,partida_humeda_id,nombre,magnitud,factor,ambito,filtro,orden", "orden"),
    todas<DatosObra["fases"][number]>(sb, "fases", id, "id,trabajo_id,nombre,peso,orden", "orden"),
    todas<DatosObra["elementos"][number]>(sb, "elementos", id, "id,tipo_id,hoja_id,vivienda,etiqueta,uso,geojson,longitud,superficie,altura,humedo,origen,datos", "created_at"),
    todas<DatosObra["avances"][number]>(sb, "avances", id, "id,elemento_id,fase_id,porcentaje,fecha,created_at,nota"),
    todas<DatosObra["manuales"][number]>(sb, "avances_manuales", id, "id,partida_id,cantidad,fecha,created_at,nota"),
    todas<DatosObra["planificacion"][number]>(sb, "planificacion", id, "id,capitulo_id,inicio,fin"),
    todas<DatosObra["viviendas"][number]>(sb, "viviendas", id, "id,codigo,superficie_util,superficie_detectada,geojson", "codigo"),
  ]);
  // los numeric de Postgres llegan como texto o número según el caso: se normalizan
  const n = (v: unknown) => (v == null ? null : Number(v));
  // partidas en el orden del presupuesto: capítulo y, dentro, su orden
  const ordenCap = new Map(capitulos.map((c) => [c.id, c.orden]));
  partidas.sort((a, b) => (ordenCap.get(a.capitulo_id) ?? 0) - (ordenCap.get(b.capitulo_id) ?? 0) || a.orden - b.orden);
  return {
    obra, capitulos, tipos, planificacion, viviendas,
    partidas: partidas.map((p) => ({ ...p, medicion: Number(p.medicion), precio: Number(p.precio) })),
    trabajos: trabajos.map((t) => ({ ...t, factor: Number(t.factor) })),
    fases: fases.map((f) => ({ ...f, peso: Number(f.peso) })),
    elementos: elementos.map((e) => ({ ...e, longitud: n(e.longitud), superficie: n(e.superficie), altura: n(e.altura) })),
    avances: avances.map((a) => ({ ...a, porcentaje: Number(a.porcentaje) })),
    manuales: manuales.map((m) => ({ ...m, cantidad: Number(m.cantidad) })),
  };
}
