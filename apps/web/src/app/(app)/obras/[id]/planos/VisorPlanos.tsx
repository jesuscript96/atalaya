"use client";
import "ol/ol.css";
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import OlMap from "ol/Map";
import View from "ol/View";
import Feature from "ol/Feature";
import ImageLayer from "ol/layer/Image";
import VectorLayer from "ol/layer/Vector";
import Static from "ol/source/ImageStatic";
import VectorSource from "ol/source/Vector";
import GeoJSONFormat from "ol/format/GeoJSON";
import Projection from "ol/proj/Projection";
import { Circle as CircleStyle, Fill, Stroke, Style, Text } from "ol/style";
import DragBox from "ol/interaction/DragBox";
import DragPan from "ol/interaction/DragPan";
import Draw from "ol/interaction/Draw";
import { extend as extenderExtent, createEmpty as extentVacio, isEmpty as extentVacioEs } from "ol/extent";
import type { Geometry } from "ol/geom";
import { UNIDAD, areaGeom, avanceElemento, cantidad, estadoAvances, hoyISO, longitudGeom, num, pct } from "@/lib/calculo";
import { supabaseNavegador } from "@/lib/supabase/client";
import type { Avance, DatosObra, Elemento, Fase, Hoja, Trabajo, Uso } from "@/lib/tipos";

type HojaUrl = Hoja & { url: string | null };
type Modo = "tocar" | "area" | "dibujar" | "contorno";

const fmt = new GeoJSONFormat();
const COLOR_FASE = { nada: "#9aa6ad", parcial: "#d68c06", hecho: "#2f8a57" };
const USOS: [Uso, string][] = [
  ["bano", "Baño / aseo"], ["cocina", "Cocina"], ["lavadero", "Lavadero / tendedero"], ["dormitorio", "Dormitorio"],
  ["salon", "Salón / estar"], ["paso", "Paso / distribuidor"], ["comun", "Zona común"],
];

function alfa(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function VisorPlanos({ datos, hojas, inicial }: { datos: DatosObra; hojas: HojaUrl[]; inicial?: { vivienda: string; trabajo: string; fase: string } }) {
  const sb = useMemo(() => supabaseNavegador(), []);
  const obraId = datos.obra.id;
  const [elementos, setElementos] = useState<Elemento[]>(datos.elementos);
  const [avances, setAvances] = useState<Avance[]>(datos.avances);
  const plantas = hojas.filter((h) => h.url);
  const [hojaId, setHojaId] = useState(() => (plantas.find((h) => h.principal) ?? plantas[0])?.id);
  const hoja = plantas.find((h) => h.id === hojaId);
  const [tiposOcultos, setTiposOcultos] = useState<Set<string>>(new Set());
  const [verViviendas, setVerViviendas] = useState(true);
  const [vivienda, setVivienda] = useState<string>(inicial?.vivienda ?? "");
  const tipos = useMemo(() => new Map(datos.tipos.map((t) => [t.id, t])), [datos.tipos]);
  const partidas = useMemo(() => new Map(datos.partidas.map((p) => [p.id, p])), [datos.partidas]);
  const capitulos = useMemo(() => new Map(datos.capitulos.map((c) => [c.id, c])), [datos.capitulos]);
  const tipoViv = useMemo(() => datos.tipos.find((t) => t.clave === "VIV")?.id, [datos.tipos]);

  // trabajos agrupados por capítulo del presupuesto (en el orden del presupuesto)
  const grupos = useMemo(() => {
    const porCap = new Map<string, { nombre: string; orden: number; trabajos: Trabajo[] }>();
    for (const t of datos.trabajos.slice().sort((a, b) => a.orden - b.orden)) {
      const p = t.partida_id ? partidas.get(t.partida_id) : null;
      const c = p ? capitulos.get(p.capitulo_id) : null;
      const k = c?.id ?? "-";
      const g = porCap.get(k) ?? { nombre: c ? `${c.codigo} ${c.nombre}` : "Sin partida", orden: c?.orden ?? 999, trabajos: [] };
      g.trabajos.push(t);
      porCap.set(k, g);
    }
    return [...porCap.values()].sort((a, b) => a.orden - b.orden);
  }, [datos.trabajos, partidas, capitulos]);
  const trabajos = useMemo(() => grupos.flatMap((g) => g.trabajos), [grupos]);
  const [trabajoId, setTrabajoId] = useState<string>(inicial?.trabajo || trabajos[0]?.id || "");
  const fasesTrabajo = useMemo(
    () => datos.fases.filter((f) => f.trabajo_id === trabajoId).sort((a, b) => a.orden - b.orden),
    [datos.fases, trabajoId],
  );
  const [faseId, setFaseId] = useState<string>(inicial?.fase ?? "");
  const fase = fasesTrabajo.find((f) => f.id === faseId) ?? fasesTrabajo[0];
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [modo, setModo] = useState<Modo>("tocar");
  const [tipoDibujo, setTipoDibujo] = useState<string>(datos.tipos[0]?.id ?? "");
  const [porcentaje, setPorcentaje] = useState(100);
  const [fecha, setFecha] = useState(hoyISO());
  const [anteriores, setAnteriores] = useState(true);
  const [ultimoLote, setUltimoLote] = useState<number[] | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const trabajo = trabajos.find((t) => t.id === trabajoId);
  const porId = useMemo(() => new Map(elementos.map((e) => [e.id, e])), [elementos]);
  const estado = useMemo(() => estadoAvances(avances), [avances]);
  const viviendas = useMemo(
    () => [...new Set(elementos.map((e) => e.vivienda).filter(Boolean) as string[])].sort(),
    [elementos],
  );

  // en una hoja de planta se ven los elementos importados (sin hoja) y los dibujados en cualquier planta;
  // en una hoja con encuadre propio (alzado, sección…) solo los dibujados en ella
  const visible = useCallback(
    (e: Elemento) => {
      if (tiposOcultos.has(e.tipo_id) || (vivienda && e.vivienda !== vivienda)) return false;
      if (!hoja) return true;
      return hoja.encuadre === "planta" ? e.hoja_id == null : e.hoja_id === hoja.id;
    },
    [tiposOcultos, vivienda, hoja],
  );

  // ───────────── Mapa ─────────────
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<OlMap | null>(null);
  const fondoRef = useRef<ImageLayer<Static> | null>(null);
  const capaRef = useRef<VectorLayer | null>(null);
  const capaVivRef = useRef<VectorLayer | null>(null);
  const fuenteRef = useRef(new VectorSource());
  const interRef = useRef<{ box: DragBox; pan: DragPan; draw: Draw | null }>(null);
  // lo que leen las funciones de estilo y los eventos del mapa sin volver a crearlo
  const vivo = useRef({ porId, estado, trabajo, fase, seleccion, visible, tipos, modo, tipoViv });
  useLayoutEffect(() => {
    vivo.current = { porId, estado, trabajo, fase, seleccion, visible, tipos, modo, tipoViv };
  });

  // solo se seleccionan elementos a los que aplica el trabajo activo (si lo hay)
  const filtrarAplicables = useCallback((ids: string[]) => {
    const { trabajo, porId } = vivo.current;
    if (!trabajo) return ids;
    return ids.filter((id) => {
      const e = porId.get(id);
      return e && cantidad(e, trabajo) != null;
    });
  }, []);

  const cache = useRef(new Map<string, Style[]>());
  const estilo = useCallback((f: Feature, res: number) => {
    const { porId, estado, trabajo, fase, seleccion, visible, tipos, tipoViv } = vivo.current;
    const e = porId.get(String(f.getId()));
    if (!e || !visible(e)) return undefined;
    const tipo = tipos.get(e.tipo_id);
    const sel = seleccion.has(e.id);
    const esViv = e.tipo_id === tipoViv;
    // la vivienda solo se pinta (y se puede tocar) cuando el trabajo activo es por vivienda o está seleccionada
    if (esViv && !sel && trabajo?.tipo_id !== tipoViv) return undefined;
    let color = tipo?.color ?? "#888888";
    let tenue = false;
    if (trabajo && fase) {
      if (e.tipo_id === trabajo.tipo_id && cantidad(e, trabajo) != null) {
        const p = estado.get(`${e.id}|${fase.id}`) ?? 0;
        color = p >= 100 ? COLOR_FASE.hecho : p > 0 ? COLOR_FASE.parcial : COLOR_FASE.nada;
      } else tenue = true;
    }
    const g = e.geojson.type;
    const etiqueta = g !== "LineString" && g !== "MultiLineString" && (res < 0.06 || g === "Point") && e.etiqueta
      ? `${e.etiqueta}${e.superficie && !esViv ? `\n${num(Number(e.superficie))} m²` : ""}` : "";
    const k = `${color}|${tenue}|${sel}|${g}|${esViv}|${etiqueta}`;
    let s = cache.current.get(k);
    if (!s) {
      const c = tenue ? alfa(color, 0.25) : color;
      s = [];
      if (sel) s.push(new Style({ stroke: new Stroke({ color: "rgba(28,95,143,.55)", width: 12 }), image: new CircleStyle({ radius: 16, fill: new Fill({ color: "rgba(28,95,143,.45)" }) }) }));
      s.push(new Style({
        stroke: new Stroke({ color: c, width: g.includes("Polygon") ? (esViv ? 3 : 2) : 4.5, lineCap: "butt", lineDash: esViv ? [8, 6] : undefined }),
        fill: new Fill({ color: alfa(color, tenue ? 0.05 : sel ? 0.35 : esViv ? 0.12 : 0.18) }),
        image: new CircleStyle({ radius: 9, fill: new Fill({ color: c }), stroke: new Stroke({ color: "#fff", width: 2 }) }),
        text: etiqueta ? new Text({ text: etiqueta, font: `${esViv ? 700 : 600} ${esViv ? 15 : 12}px IBM Plex Sans, sans-serif`, offsetY: g === "Point" ? 20 : 0,
                                     fill: new Fill({ color: "#15212a" }), stroke: new Stroke({ color: "#fff", width: 3 }) }) : undefined,
      }));
      cache.current.set(k, s);
    }
    return s;
  }, []);

  // creación del mapa (una vez)
  useEffect(() => {
    if (!divRef.current) return;
    const capa = new VectorLayer({ source: fuenteRef.current, style: estilo as never, updateWhileInteracting: false });
    const capaViv = new VectorLayer({
      source: new VectorSource({
        features: datos.viviendas.filter((v) => v.geojson).map((v) => {
          const f = new Feature(fmt.readGeometry(v.geojson) as Geometry);
          f.set("codigo", v.codigo);
          return f;
        }),
      }),
      style: (f) => new Style({
        stroke: new Stroke({ color: "rgba(20,32,42,.55)", width: 1.5, lineDash: [6, 5] }),
        text: new Text({ text: f.get("codigo"), font: "700 14px Archivo, sans-serif", fill: new Fill({ color: "#1c5f8f" }),
                         stroke: new Stroke({ color: "#fff", width: 4 }), overflow: true }),
      }),
    });
    const fondo = new ImageLayer<Static>();
    const map = new OlMap({ target: divRef.current, layers: [fondo, capaViv, capa], controls: [] });
    const box = new DragBox({ condition: () => vivo.current.modo === "area" });
    const pan = map.getInteractions().getArray().find((i) => i instanceof DragPan) as DragPan;
    box.on("boxend", () => {
      const ext = box.getGeometry().getExtent();
      const ids: string[] = [];
      fuenteRef.current.forEachFeatureIntersectingExtent(ext, (f) => {
        const e = vivo.current.porId.get(String(f.getId()));
        if (e && vivo.current.visible(e) && e.tipo_id !== vivo.current.tipoViv && f.getGeometry()!.intersectsExtent(ext)) ids.push(e.id);
      });
      setSeleccion((s) => new Set([...s, ...filtrarAplicables(ids)]));
    });
    map.addInteraction(box);
    map.on("singleclick", (ev) => {
      if (vivo.current.modo !== "tocar") return;
      // bajo el dedo puede haber varios elementos: se prefiere uno al que aplique el trabajo activo
      const { porId, visible, trabajo } = vivo.current;
      const candidatos: Elemento[] = [];
      map.forEachFeatureAtPixel(ev.pixel, (f) => {
        const e = porId.get(String(f.getId()));
        if (e && visible(e)) candidatos.push(e);
      }, { hitTolerance: 10, layerFilter: (l) => l === capa });
      // los puntos (carpinterías) y las líneas tienen prioridad sobre los polígonos que los contienen
      const peso = (e: Elemento) => (e.geojson.type === "Point" ? 0 : e.geojson.type.includes("Line") ? 1 : e.tipo_id === vivo.current.tipoViv ? 3 : 2);
      candidatos.sort((a, b) => peso(a) - peso(b));
      const preferido = (trabajo && candidatos.find((e) => cantidad(e, trabajo) != null)) || candidatos[0];
      if (!preferido) return;
      const elegido = preferido.id;
      setSeleccion((s) => {
        const n = new Set(s);
        if (n.has(elegido)) n.delete(elegido); else n.add(elegido);
        return n;
      });
    });
    mapRef.current = map;
    fondoRef.current = fondo;
    capaRef.current = capa;
    capaVivRef.current = capaViv;
    interRef.current = { box, pan, draw: null };
    return () => map.setTarget(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // hoja de fondo: cada hoja tiene su propio sistema de coordenadas; se encuadra a lo visible en ella
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !hoja?.url) return;
    const extent = [0, 0, hoja.ancho_m, hoja.alto_m];
    const proj = new Projection({ code: `hoja-${hoja.id}`, units: "m", extent });
    fondoRef.current!.setSource(new Static({ url: hoja.url, projection: proj, imageExtent: extent, interpolate: true }));
    const vista = new View({ projection: proj, extent: [-20, -20, hoja.ancho_m + 20, hoja.alto_m + 20], maxZoom: 9, constrainOnlyCenter: true });
    map.setView(vista);
    capaVivRef.current?.setVisible(hoja.encuadre === "planta" && verViviendas);
    const ext = extentVacio();
    for (const f of fuenteRef.current.getFeatures()) {
      const e = vivo.current.porId.get(String(f.getId()));
      if (e && vivo.current.visible(e) && e.tipo_id !== vivo.current.tipoViv) extenderExtent(ext, f.getGeometry()!.getExtent());
    }
    vista.fit(extentVacioEs(ext) ? extent : ext, { padding: [30, 30, 30, 30] });
    capaRef.current?.changed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoja?.id, hoja?.url, hoja?.ancho_m, hoja?.alto_m]);

  // elementos → entidades del mapa
  useEffect(() => {
    const src = fuenteRef.current;
    src.clear();
    src.addFeatures(elementos.map((e) => {
      const f = new Feature(fmt.readGeometry(e.geojson) as Geometry);
      f.setId(e.id);
      return f;
    }));
  }, [elementos]);

  useEffect(() => {
    capaRef.current?.changed();
  }, [estado, trabajo, fase, seleccion, visible]);
  useEffect(() => {
    capaVivRef.current?.setVisible(verViviendas && hoja?.encuadre !== "propio");
  }, [verViviendas, hoja?.encuadre]);

  // modos de interacción
  useEffect(() => {
    const map = mapRef.current, it = interRef.current;
    if (!map || !it) return;
    it.pan.setActive(modo !== "area");
    if (it.draw) map.removeInteraction(it.draw);
    it.draw = null;
    if (modo === "dibujar" || modo === "contorno") {
      const tipo = modo === "contorno" ? "Polygon" : tipos.get(tipoDibujo)?.geometria === "poligono" ? "Polygon" : tipos.get(tipoDibujo)?.geometria === "punto" ? "Point" : "LineString";
      const draw = new Draw({ type: tipo, stopClick: true });
      draw.on("drawend", (ev) => {
        const g = fmt.writeGeometryObject(ev.feature.getGeometry() as Geometry, { decimals: 3 }) as GeoJSON.Geometry;
        if (vivo.current.modo === "contorno") accionesRef.current.guardarContorno(g);
        else accionesRef.current.crearElemento(g);
      });
      map.addInteraction(draw);
      it.draw = draw;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modo, tipoDibujo]);

  useEffect(() => {
    const tecla = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") { setSeleccion(new Set()); setModo("tocar"); }
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, []);

  // al cambiar de trabajo, la selección se limita a lo que le aplica
  const trabajoPrevio = useRef(trabajoId);
  useEffect(() => {
    if (trabajoPrevio.current === trabajoId) return;
    trabajoPrevio.current = trabajoId;
    setFaseId("");
    setSeleccion((s) => new Set(filtrarAplicables([...s])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trabajoId]);

  // ───────────── Acciones ─────────────
  const seleccionados = [...seleccion].map((id) => porId.get(id)).filter(Boolean) as Elemento[];
  const cantidadSel = trabajo ? seleccionados.reduce((s, e) => s + (cantidad(e, trabajo) ?? 0), 0) : 0;

  function seleccionarVisibles() {
    const ids = elementos.filter((e) => visible(e) && (e.tipo_id !== tipoViv || trabajo?.tipo_id === tipoViv)).map((e) => e.id);
    setSeleccion(new Set(filtrarAplicables(ids)));
  }

  /** Guarda marcas para unos elementos en una fase; con `completarAnteriores`, da por hechas las fases previas. */
  async function marcar(els: Elemento[], t: Trabajo, f: Fase, p: number, dia: string, completarAnteriores: boolean) {
    const fasesT = datos.fases.filter((x) => x.trabajo_id === t.id).sort((a, b) => a.orden - b.orden);
    const aplicables = els.filter((e) => cantidad(e, t) != null);
    if (!aplicables.length) return null;
    const filas: { obra_id: string; elemento_id: string; fase_id: string; porcentaje: number; fecha: string }[] = [];
    for (const e of aplicables) {
      filas.push({ obra_id: obraId, elemento_id: e.id, fase_id: f.id, porcentaje: p, fecha: dia });
      if (completarAnteriores && p > 0) {
        for (const x of fasesT) {
          if (x.orden < f.orden && (estado.get(`${e.id}|${x.id}`) ?? 0) < 100)
            filas.push({ obra_id: obraId, elemento_id: e.id, fase_id: x.id, porcentaje: 100, fecha: dia });
        }
      }
    }
    setGuardando(true);
    setAviso(null);
    const { data, error } = await sb.from("avances").insert(filas).select("id,elemento_id,fase_id,porcentaje,fecha,created_at,nota");
    setGuardando(false);
    if (error) { setAviso(`No se ha guardado: ${error.message}`); return null; }
    setAvances((a) => [...a, ...(data as Avance[]).map((x) => ({ ...x, porcentaje: Number(x.porcentaje) }))]);
    setUltimoLote((data as Avance[]).map((x) => x.id));
    return aplicables.length;
  }

  async function guardarAvance() {
    if (!trabajo || !fase || !seleccionados.length) return;
    const n = await marcar(seleccionados, trabajo, fase, porcentaje, fecha, anteriores);
    if (n == null) return;
    setAviso(`Guardado: ${n} elementos · ${fase.nombre} ${porcentaje} %`);
    setSeleccion(new Set());
  }

  async function deshacer() {
    if (!ultimoLote) return;
    const { error } = await sb.from("avances").delete().in("id", ultimoLote);
    if (error) { setAviso(error.message); return; }
    const borrar = new Set(ultimoLote);
    setAvances((a) => a.filter((x) => !borrar.has(x.id)));
    setUltimoLote(null);
    setAviso("Deshecho");
  }

  /** Vivienda y estancia en las que cae un punto (para puertas y ventanas dibujadas a mano). */
  function contexto(g: GeoJSON.Geometry): { vivienda: string | null; uso: Uso | null; estancia: string | null; humedo: boolean } {
    const geom = fmt.readGeometry(g) as Geometry;
    const [cx, cy] = geom.getType() === "Point" ? (geom as unknown as { getCoordinates(): number[] }).getCoordinates() : (geom.getExtent().slice(0, 2));
    const contiene = (e: Elemento) => {
      if (!e.geojson.type.includes("Polygon")) return false;
      const f = fuenteRef.current.getFeatureById(e.id);
      return !!f?.getGeometry()?.intersectsCoordinate([cx, cy]);
    };
    const est = elementos.find((e) => e.etiqueta && e.tipo_id !== tipoViv && contiene(e));
    const viv = elementos.find((e) => e.tipo_id === tipoViv && contiene(e));
    return { vivienda: est?.vivienda ?? viv?.vivienda ?? vivienda ?? null, uso: est?.uso ?? null, estancia: est?.etiqueta ?? null, humedo: est?.humedo ?? false };
  }

  async function crearElemento(g: GeoJSON.Geometry) {
    const tipo = tipos.get(tipoDibujo);
    if (!tipo || !hoja) return;
    const mismos = elementos.filter((e) => e.tipo_id === tipo.id && e.altura);
    const altura = mismos.length ? Number(mismos[Math.floor(mismos.length / 2)].altura) : 2.6;
    const ctx = hoja.encuadre === "planta" ? contexto(g) : { vivienda: vivienda || null, uso: null, estancia: null, humedo: false };
    const fila = {
      obra_id: obraId, tipo_id: tipo.id, vivienda: ctx.vivienda, geojson: g, origen: "manual",
      hoja_id: hoja.encuadre === "propio" ? hoja.id : null,
      longitud: tipo.geometria === "linea" ? Math.round(longitudGeom(g) * 1000) / 1000 : null,
      superficie: tipo.geometria === "poligono" ? Math.round(areaGeom(g) * 100) / 100 : null,
      altura: tipo.geometria === "linea" ? altura : null,
      humedo: ctx.humedo, uso: ctx.uso,
      etiqueta: tipo.geometria === "poligono" ? "Estancia" : tipo.geometria === "punto" ? tipo.nombre.split(" ")[0] : null,
      datos: ctx.estancia ? { estancia: ctx.estancia } : {},
    };
    const { data, error } = await sb.from("elementos").insert(fila).select("id,tipo_id,hoja_id,vivienda,etiqueta,uso,geojson,longitud,superficie,altura,humedo,origen,datos").single();
    if (error) { setAviso(error.message); return; }
    setElementos((l) => [...l, data as Elemento]);
    setSeleccion(new Set([data.id]));
    setAviso(`${tipo.nombre} añadido${fila.longitud ? ` (${num(fila.longitud)} m)` : fila.superficie ? ` (${num(fila.superficie)} m²)` : ""}${ctx.vivienda ? ` en ${ctx.vivienda}` : ""}`);
  }

  async function guardarContorno(g: GeoJSON.Geometry) {
    const e = seleccionados[0];
    if (!e) return;
    const datosE = { ...e.datos, superficie_dibujada: Math.round(areaGeom(g) * 100) / 100, contorno_manual: true };
    const cambios = { geojson: g, datos: datosE, superficie: e.superficie ?? Math.round(areaGeom(g) * 100) / 100 };
    const { error } = await sb.from("elementos").update(cambios).eq("id", e.id);
    if (error) { setAviso(error.message); return; }
    setElementos((l) => l.map((x) => (x.id === e.id ? { ...x, ...cambios } : x)));
    setModo("tocar");
    setAviso(`Contorno guardado (${num(datosE.superficie_dibujada)} m² dibujados; se mantiene la superficie del proyecto)`);
  }

  async function editar(e: Elemento, cambios: Partial<Elemento>) {
    const { error } = await sb.from("elementos").update(cambios).eq("id", e.id);
    if (error) { setAviso(error.message); return; }
    setElementos((l) => l.map((x) => (x.id === e.id ? { ...x, ...cambios } : x)));
  }

  async function borrar(e: Elemento) {
    if (!confirm("¿Borrar este elemento dibujado a mano y sus avances?")) return;
    const { error } = await sb.from("elementos").delete().eq("id", e.id);
    if (error) { setAviso(error.message); return; }
    setElementos((l) => l.filter((x) => x.id !== e.id));
    setSeleccion(new Set());
  }

  function tabiquesDeEstancia(e: Elemento) {
    const ids = elementos
      .filter((x) => x.vivienda === e.vivienda && ((x.datos?.estancias as string[] | undefined) ?? []).some((n) => n.toLowerCase() === (e.etiqueta ?? "").toLowerCase()))
      .map((x) => x.id);
    setTrabajoId(trabajos.find((t) => tipos.get(t.tipo_id)?.geometria === "linea")?.id ?? trabajoId);
    setSeleccion(new Set(ids));
  }

  // los manejadores del mapa llaman siempre a la versión actual de estas acciones
  const accionesRef = useRef({ crearElemento, guardarContorno });
  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/immutability -- patrón «última versión del manejador» para los eventos de OpenLayers
    accionesRef.current = { crearElemento, guardarContorno };
  });

  const unico = seleccionados.length === 1 ? seleccionados[0] : null;
  const contadorTipo = useMemo(() => {
    const m = new Map<string, number>();
    elementos.forEach((e) => m.set(e.tipo_id, (m.get(e.tipo_id) ?? 0) + 1));
    return m;
  }, [elementos]);
  const vinculadas = useMemo(() => new Set(datos.trabajos.flatMap((t) => [t.partida_id, t.partida_humeda_id]).filter(Boolean)), [datos.trabajos]);
  const sinPlano = datos.partidas.filter((p) => !vinculadas.has(p.id)).length;

  // en pantallas anchas el visor ocupa justo el alto que queda: solo se desplaza el panel lateral
  const raizRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = raizRef.current;
    if (!el) return;
    const ajustar = () => el.style.setProperty("--visor-top", `${el.getBoundingClientRect().top + window.scrollY}px`);
    ajustar();
    window.addEventListener("resize", ajustar);
    return () => window.removeEventListener("resize", ajustar);
  }, []);

  // ───────────── Interfaz ─────────────
  return (
    <div ref={raizRef} className="flex-1 flex flex-col lg:flex-row min-h-0 lg:h-[calc(100dvh-var(--visor-top,180px))] lg:flex-none">
      <div className="relative flex-1 min-h-[58dvh] lg:min-h-0 bg-white">
        <div ref={divRef} className="absolute inset-0" style={{ cursor: modo === "tocar" ? "pointer" : "crosshair" }} />
        <div className="absolute top-3 left-3 right-3 flex flex-wrap gap-2 pointer-events-none">
          <div className="seg pointer-events-auto shadow">
            {([["tocar", "Tocar"], ["area", "Área"], ["dibujar", "Dibujar"]] as [Modo, string][]).map(([m, n]) => (
              <button key={m} className={modo === m ? "on" : ""} onClick={() => setModo(m)}>{n}</button>
            ))}
          </div>
          {modo === "dibujar" && (
            <select className="select !w-auto pointer-events-auto shadow" value={tipoDibujo} onChange={(e) => setTipoDibujo(e.target.value)}>
              {datos.tipos.filter((t) => t.clave !== "VIV").map((t) => <option key={t.id} value={t.id}>{t.clave} · {t.nombre}</option>)}
            </select>
          )}
          {(modo === "dibujar" || modo === "contorno") && (
            <span className="chip chip-accent self-center">
              {modo === "contorno" ? "Dibuja el contorno de la estancia; doble toque para cerrar"
                : tipos.get(tipoDibujo)?.geometria === "punto" ? "Toca el plano donde está la puerta o ventana" : "Toca para añadir vértices; doble toque para terminar"}
            </span>
          )}
          <select className="select !w-auto ml-auto pointer-events-auto shadow max-w-[46vw]" value={hojaId} onChange={(e) => setHojaId(e.target.value)}>
            <optgroup label="Plantas">
              {plantas.filter((h) => h.encuadre === "planta").map((h) => <option key={h.id} value={h.id}>{h.pagina}. {h.titulo}</option>)}
            </optgroup>
            <optgroup label="Alzados, secciones y otras">
              {plantas.filter((h) => h.encuadre !== "planta").map((h) => <option key={h.id} value={h.id}>{h.pagina}. {h.titulo}</option>)}
            </optgroup>
          </select>
        </div>
        <div className="absolute bottom-3 left-3 flex gap-3 text-xs card px-3 py-2">
          <Leyenda color={COLOR_FASE.nada} t="Sin empezar" />
          <Leyenda color={COLOR_FASE.parcial} t="En curso" />
          <Leyenda color={COLOR_FASE.hecho} t="Terminado" />
          {hoja?.encuadre === "propio" && <span className="muted">· Hoja con encuadre propio: solo lo dibujado en ella</span>}
        </div>
      </div>

      <aside className="w-full lg:w-[380px] lg:overflow-y-auto border-l border-[var(--line)] bg-[var(--surface)] p-4 grid gap-5 content-start">
        <section className="grid gap-2">
          <h3>Trabajo</h3>
          {trabajos.length === 0 ? (
            <p className="muted text-sm">Sin vínculos entre plano y presupuesto. Sube ambos documentos o créalos en Configuración.</p>
          ) : (
            <>
              <select className="select" value={trabajoId} onChange={(e) => setTrabajoId(e.target.value)}>
                {grupos.map((g) => (
                  <optgroup key={g.nombre} label={g.nombre}>
                    {g.trabajos.map((t) => {
                      const p = t.partida_id ? partidas.get(t.partida_id) : null;
                      return <option key={t.id} value={t.id}>{tipos.get(t.tipo_id)?.clave} · {t.nombre}{p ? ` — ${p.codigo}` : ""}</option>;
                    })}
                  </optgroup>
                ))}
              </select>
              {trabajo && <AmbitoTexto t={trabajo} tipoClave={tipos.get(trabajo.tipo_id)?.clave ?? ""} />}
              <div className="flex flex-wrap gap-1.5">
                {fasesTrabajo.map((f) => (
                  <button key={f.id} className={`btn btn-sm ${fase?.id === f.id ? "on" : ""}`} onClick={() => setFaseId(f.id)}>
                    {f.nombre}{fasesTrabajo.length > 1 && <span className="muted">{Math.round(f.peso * 100)}%</span>}
                  </button>
                ))}
              </div>
            </>
          )}
          {sinPlano > 0 && (
            <p className="muted text-xs">{sinPlano} partidas sin plano (demoliciones, fachada, residuos…) avanzan en <Link className="underline" href={`/obras/${obraId}/presupuesto`}>Presupuesto</Link>.</p>
          )}
        </section>

        <section className="grid gap-2">
          <div className="flex items-center justify-between">
            <h3>Selección</h3>
            <div className="flex gap-1.5">
              <button className="btn btn-sm" onClick={seleccionarVisibles}>Todo lo visible</button>
              <button className="btn btn-sm" onClick={() => setSeleccion(new Set())} disabled={!seleccion.size}>Limpiar</button>
            </div>
          </div>
          <p className="text-sm">
            {seleccion.size ? <><b>{seleccion.size}</b> elementos{trabajo && <> · <b>{num(cantidadSel)}</b> {UNIDAD[trabajo.magnitud]}</>}</> : <span className="muted">Toca elementos en el plano o usa «Área» para recuadrar.</span>}
          </p>
          {trabajo && fase && seleccion.size > 0 && (
            <div className="grid gap-3 card card-pad !p-3">
              <div className="seg w-full">
                {[0, 25, 50, 75, 100].map((p) => (
                  <button key={p} className={`flex-1 ${porcentaje === p ? "on" : ""}`} onClick={() => setPorcentaje(p)}>{p}%</button>
                ))}
              </div>
              <label className="campo">Fecha de ejecución<input className="input" type="date" value={fecha} max={hoyISO()} onChange={(e) => setFecha(e.target.value)} /></label>
              {fasesTrabajo.length > 1 && fase.orden > 0 && (
                <label className="flex gap-2 items-center text-sm"><input type="checkbox" checked={anteriores} onChange={(e) => setAnteriores(e.target.checked)} className="size-5" /> Dar por terminadas las fases anteriores</label>
              )}
              <button className="btn btn-primary" onClick={guardarAvance} disabled={guardando}>
                {guardando ? "Guardando…" : `Marcar ${fase.nombre} al ${porcentaje} %`}
              </button>
            </div>
          )}
          {aviso && (
            <div className="flex items-center gap-2 text-sm">
              <span className="chip chip-ok">{aviso}</span>
              {ultimoLote && <button className="btn btn-sm" onClick={deshacer}>Deshacer</button>}
            </div>
          )}
        </section>

        {unico && (
          <Detalle
            e={unico} datos={datos} estado={estado} tipoNombre={tipos.get(unico.tipo_id)?.nombre ?? ""} esViv={unico.tipo_id === tipoViv}
            viviendas={viviendas} onEditar={editar} onBorrar={borrar}
            onContorno={() => setModo("contorno")} onTabiques={() => tabiquesDeEstancia(unico)}
            onUnidades={() => setVivienda(unico.vivienda ?? "")}
          />
        )}

        <PorVivienda
          datos={datos} grupos={grupos} elementos={elementos} estado={estado} vivienda={vivienda} viviendas={viviendas}
          tipos={tipos} partidas={partidas} fecha={fecha} guardando={guardando}
          onVivienda={setVivienda} onMarcar={(els, t, f, p) => marcar(els, t, f, p, fecha, true).then((n) => n != null && setAviso(`${t.nombre} · ${f.nombre} ${p} % en ${vivienda}`))}
        />

        <section className="grid gap-2">
          <h3>Capas</h3>
          <select className="select" value={vivienda} onChange={(e) => setVivienda(e.target.value)}>
            <option value="">Todas las viviendas y zonas</option>
            {viviendas.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <div className="grid gap-1">
            {datos.tipos.map((t) => (
              <label key={t.id} className="flex items-center gap-2 text-sm min-h-8">
                <input type="checkbox" className="size-5" checked={!tiposOcultos.has(t.id)} onChange={() => setTiposOcultos((s) => {
                  const n = new Set(s);
                  if (n.has(t.id)) n.delete(t.id); else n.add(t.id);
                  return n;
                })} />
                <i className="inline-block w-4 h-1.5 rounded" style={{ background: t.color }} />
                <span className="flex-1">{t.clave} · {t.nombre}</span>
                <span className="muted">{contadorTipo.get(t.id) ?? 0}</span>
              </label>
            ))}
            <label className="flex items-center gap-2 text-sm min-h-8">
              <input type="checkbox" className="size-5" checked={verViviendas} onChange={(e) => setVerViviendas(e.target.checked)} />
              <i className="inline-block w-4 h-0 border-t-2 border-dashed border-[var(--ink-2)]" />
              Contorno de viviendas
            </label>
          </div>
        </section>
      </aside>
    </div>
  );
}

function Leyenda({ color, t }: { color: string; t: string }) {
  return <span className="flex items-center gap-1.5"><i className="inline-block w-3 h-3 rounded-sm" style={{ background: color }} />{t}</span>;
}

const AMBITO_TEXTO: Record<Trabajo["ambito"], string> = {
  todas: "", humedas: "solo en zonas húmedas", banos: "solo en baños", cocinas: "solo en cocinas",
  viviendas: "una por vivienda", comunes: "en zonas comunes",
};

function AmbitoTexto({ t, tipoClave }: { t: Trabajo; tipoClave: string }) {
  const partes = [AMBITO_TEXTO[t.ambito], t.filtro ? `etiqueta «${t.filtro}»` : "", t.magnitud === "unidad" && t.factor !== 1 ? `${num(t.factor, 2)} ud por elemento` : ""].filter(Boolean);
  if (!partes.length && tipoClave !== "VIV") return null;
  return <p className="muted text-xs">{tipoClave === "VIV" ? "Se marca tocando la vivienda en el plano o en «Por vivienda». " : ""}{partes.join(" · ")}</p>;
}

/** Partidas por unidad (instalaciones, equipamiento, carpinterías…) de una vivienda, para marcarlas sin tocar el plano. */
function PorVivienda({ datos, grupos, elementos, estado, vivienda, viviendas, tipos, partidas, fecha, guardando, onVivienda, onMarcar }: {
  datos: DatosObra; grupos: { nombre: string; trabajos: Trabajo[] }[]; elementos: Elemento[]; estado: Map<string, number>;
  vivienda: string; viviendas: string[]; tipos: Map<string, DatosObra["tipos"][number]>; partidas: Map<string, DatosObra["partidas"][number]>;
  fecha: string; guardando: boolean; onVivienda: (v: string) => void; onMarcar: (els: Elemento[], t: Trabajo, f: Fase, p: number) => void;
}) {
  const [abierto, setAbierto] = useState<string | null>(null);
  const enViv = vivienda ? elementos.filter((e) => e.vivienda === vivienda) : [];
  const filas = grupos.map((g) => ({
    nombre: g.nombre,
    trabajos: g.trabajos
      .filter((t) => t.magnitud === "unidad" || tipos.get(t.tipo_id)?.clave === "VIV")
      .map((t) => {
        const els = enViv.filter((e) => cantidad(e, t) != null);
        const fases = datos.fases.filter((f) => f.trabajo_id === t.id).sort((a, b) => a.orden - b.orden);
        const peso = fases.reduce((s, f) => s + f.peso, 0) || 1;
        const porFase = fases.map((f) => {
          const q = els.reduce((s, e) => s + (cantidad(e, t) ?? 0), 0) || 1;
          return els.reduce((s, e) => s + (cantidad(e, t) ?? 0) * (estado.get(`${e.id}|${f.id}`) ?? 0), 0) / q;
        });
        const total = fases.reduce((s, f, i) => s + f.peso * porFase[i] / 100, 0) / peso;
        return { t, els, fases, porFase, total };
      })
      .filter((x) => x.els.length > 0),
  })).filter((g) => g.trabajos.length > 0);

  return (
    <section className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3>Por vivienda</h3>
        <select className="select !w-auto !min-h-9" value={vivienda} onChange={(e) => onVivienda(e.target.value)}>
          <option value="">Elige vivienda…</option>
          {viviendas.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>
      {!vivienda ? (
        <p className="muted text-sm">Instalaciones, equipamiento y carpinterías de cada vivienda: elige una y marca el porcentaje directamente.</p>
      ) : filas.length === 0 ? (
        <p className="muted text-sm">No hay partidas por unidad vinculadas a {vivienda}.</p>
      ) : (
        <div className="grid gap-2">
          {filas.map((g) => (
            <div key={g.nombre} className="grid gap-1">
              <p className="eyebrow">{g.nombre}</p>
              {g.trabajos.map(({ t, els, fases, porFase, total }) => {
                const p = t.partida_id ? partidas.get(t.partida_id) : null;
                const on = abierto === t.id;
                return (
                  <div key={t.id} className="border border-[var(--line)] rounded-md bg-white">
                    <button className="w-full text-left px-3 min-h-10 flex items-center gap-2" onClick={() => setAbierto(on ? null : t.id)}>
                      <span className="flex-1 text-sm"><b>{t.nombre}</b>{p && <span className="muted"> · {p.codigo}</span>}
                        {els.length > 1 && <span className="muted"> · {els.length} {tipos.get(t.tipo_id)?.clave === "EST" ? "estancias" : "ud"}</span>}</span>
                      <span className={`chip ${total >= 0.999 ? "chip-ok" : total > 0 ? "chip-progress" : ""}`}>{pct(total)}</span>
                    </button>
                    {on && (
                      <div className="px-3 pb-3 grid gap-2">
                        {fases.map((f, i) => (
                          <div key={f.id} className="grid gap-1">
                            <span className="text-xs">{f.nombre}{fases.length > 1 && <span className="muted"> · {Math.round(f.peso * 100)} %</span>}</span>
                            <div className="seg w-full">
                              {[0, 25, 50, 75, 100].map((v) => (
                                <button key={v} className={`flex-1 !min-h-9 text-sm ${Math.round(porFase[i]) === v ? "on" : ""}`} disabled={guardando}
                                        onClick={() => onMarcar(els, t, f, v)}>{v}</button>
                              ))}
                            </div>
                          </div>
                        ))}
                        <p className="muted text-xs">Se guarda con fecha {new Date(fecha).toLocaleDateString("es-ES")}{els.length > 1 ? ` en ${els.map((e) => e.etiqueta ?? "").join(", ")}` : ""}.</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Detalle({ e, datos, estado, tipoNombre, esViv, viviendas, onEditar, onBorrar, onContorno, onTabiques, onUnidades }: {
  e: Elemento; datos: DatosObra; estado: Map<string, number>; tipoNombre: string; esViv: boolean; viviendas: string[];
  onEditar: (e: Elemento, c: Partial<Elemento>) => void; onBorrar: (e: Elemento) => void; onContorno: () => void; onTabiques: () => void; onUnidades: () => void;
}) {
  const trabajos = datos.trabajos.filter((t) => t.tipo_id === e.tipo_id && cantidad(e, t) != null);
  const esLinea = e.geojson.type.includes("LineString");
  const esPunto = e.geojson.type === "Point" && !e.superficie && !(e.datos?.punto);
  const esEstancia = !esLinea && !esViv && !esPunto;
  const estancia = e.datos?.estancia as string | undefined;
  return (
    <section className="grid gap-2">
      <h3>{e.etiqueta ?? tipoNombre}</h3>
      <div className="text-sm grid grid-cols-2 gap-x-3 gap-y-1">
        <span className="muted">Tipo</span><span>{tipoNombre}{e.origen === "manual" && " (a mano)"}</span>
        {e.longitud != null && <><span className="muted">Longitud</span><span>{num(Number(e.longitud))} m</span></>}
        {e.superficie != null && <><span className="muted">Superficie</span><span>{num(Number(e.superficie))} m²</span></>}
        {e.datos?.superficie_detectada != null && <><span className="muted">Medida en plano</span><span>{num(Number(e.datos.superficie_detectada))} m²</span></>}
        {estancia && <><span className="muted">Estancia</span><span>{estancia}</span></>}
        {e.datos?.ancho != null && <><span className="muted">Ancho de hoja</span><span>{num(Number(e.datos.ancho) * 100, 1)} cm</span></>}
        {e.geojson.type === "Point" && !esPunto && <><span className="muted">Contorno</span><span className="text-[#8a5a00]">sin dibujar (perímetro estimado)</span></>}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="campo">Vivienda
          <select className="select" value={e.vivienda ?? ""} onChange={(ev) => onEditar(e, { vivienda: ev.target.value || null })}>
            <option value="">—</option>
            {[...new Set([...viviendas, "COMUN"])].map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
        {esLinea ? (
          <label className="campo">Altura (m)
            <input className="input" type="number" step="0.01" defaultValue={e.altura ?? ""} key={e.id + "h"}
                   onBlur={(ev) => { const v = Number(ev.target.value); if (v > 0 && v !== Number(e.altura)) onEditar(e, { altura: v }); }} />
          </label>
        ) : !esViv && (
          <label className="campo">Uso
            <select className="select" value={e.uso ?? ""} onChange={(ev) => onEditar(e, { uso: (ev.target.value || null) as Uso | null })}>
              <option value="">—</option>
              {USOS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
            </select>
          </label>
        )}
        {esPunto && (
          <label className="campo col-span-2">Etiqueta (p. ej. «Puerta 72»)
            <input className="input" defaultValue={e.etiqueta ?? ""} key={e.id + "e"}
                   onBlur={(ev) => { const v = ev.target.value.trim(); if (v && v !== e.etiqueta) onEditar(e, { etiqueta: v }); }} />
          </label>
        )}
      </div>
      {!esViv && <label className="flex gap-2 items-center text-sm"><input type="checkbox" className="size-5" checked={e.humedo} onChange={(ev) => onEditar(e, { humedo: ev.target.checked })} /> Zona húmeda (partidas «H»)</label>}
      {trabajos.length > 0 && (
        <table className="tabla mt-1">
          <tbody>
            {trabajos.map((t) => {
              const fases = datos.fases.filter((f) => f.trabajo_id === t.id).sort((a, b) => a.orden - b.orden);
              const ps = avanceElemento(e, fases.map((f) => f.id), estado);
              const total = fases.reduce((s, f, i) => s + f.peso * ps[i] / 100, 0) / (fases.reduce((s, f) => s + f.peso, 0) || 1);
              return (
                <tr key={t.id}>
                  <td>{t.nombre}<div className="muted text-xs">{fases.map((f, i) => `${f.nombre} ${ps[i]}%`).join(" · ")}</div></td>
                  <td className="num">{pct(total)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <div className="flex flex-wrap gap-1.5">
        {esEstancia && <button className="btn btn-sm" onClick={onContorno}>{e.geojson.type === "Point" ? "Dibujar contorno" : "Redibujar contorno"}</button>}
        {esEstancia && e.etiqueta && <button className="btn btn-sm" onClick={onTabiques}>Tabiques de la estancia</button>}
        {e.vivienda && (esViv || esEstancia) && <button className="btn btn-sm" onClick={onUnidades}>Partidas de {e.vivienda}</button>}
        {e.vivienda && e.etiqueta && esEstancia && <Link className="btn btn-sm" href={`/obras/${datos.obra.id}/fotos?vivienda=${encodeURIComponent(e.vivienda)}&estancia=${encodeURIComponent(e.etiqueta)}`}>Fotos</Link>}
        {e.origen === "manual" && <button className="btn btn-sm btn-danger" onClick={() => onBorrar(e)}>Borrar</button>}
      </div>
    </section>
  );
}
