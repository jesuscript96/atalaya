// Cálculo del avance de obra: cantidades medidas en plano, ejecutado por partida, curvas, matriz y certificaciones.
// Funciones puras (sin acceso a datos) para poder usarlas en servidor, en cliente y en pruebas.
import type {
  Ajustes, Avance, AvanceManual, DatosObra, Elemento, LineaCertificacion, Partida, TotalesCertificacion, Trabajo,
} from "./tipos";

export const redondear = (n: number, d = 2) => Math.round((n + Number.EPSILON) * 10 ** d) / 10 ** d;

// ───────────── Geometría ─────────────
function longitudAnillo(c: number[][]) {
  let l = 0;
  for (let i = 1; i < c.length; i++) l += Math.hypot(c[i][0] - c[i - 1][0], c[i][1] - c[i - 1][1]);
  return l;
}

/** Perímetro del contorno exterior; si la estancia solo tiene punto, estimación a partir de la superficie. */
export function perimetro(e: Pick<Elemento, "geojson" | "superficie">): { valor: number; estimado: boolean } {
  const g = e.geojson;
  if (g.type === "Polygon") return { valor: longitudAnillo(g.coordinates[0]), estimado: false };
  if (g.type === "MultiPolygon") return { valor: g.coordinates.reduce((s, p) => s + longitudAnillo(p[0]), 0), estimado: false };
  // estancia rectangular típica (proporción ~1:1,5) → P ≈ 4,1·√A
  return { valor: 4.1 * Math.sqrt(Number(e.superficie ?? 0)), estimado: true };
}

export function longitudGeom(g: GeoJSON.Geometry): number {
  if (g.type === "LineString") return longitudAnillo(g.coordinates);
  if (g.type === "MultiLineString") return g.coordinates.reduce((s, c) => s + longitudAnillo(c), 0);
  return 0;
}

export function areaGeom(g: GeoJSON.Geometry): number {
  const anillo = (c: number[][]) => {
    let a = 0;
    for (let i = 1; i < c.length; i++) a += c[i - 1][0] * c[i][1] - c[i][0] * c[i - 1][1];
    return Math.abs(a) / 2;
  };
  const pol = (p: number[][][]) => anillo(p[0]) - p.slice(1).reduce((s, h) => s + anillo(h), 0);
  if (g.type === "Polygon") return pol(g.coordinates);
  if (g.type === "MultiPolygon") return g.coordinates.reduce((s, p) => s + pol(p), 0);
  return 0;
}

// ───────────── Cantidad de un trabajo sobre un elemento ─────────────
export const UNIDAD: Record<Trabajo["magnitud"], string> = {
  longitud: "m", superficie_pared: "m²", superficie: "m²", perimetro: "m", perimetro_altura: "m²", unidad: "ud",
};

/** ¿Entra el elemento en el ámbito y el filtro del trabajo? (sin comprobar el tipo) */
export function enAmbito(e: Pick<Elemento, "humedo" | "uso" | "vivienda" | "etiqueta">, t: Pick<Trabajo, "ambito" | "filtro">): boolean {
  switch (t.ambito) {
    case "humedas": if (!e.humedo) return false; break;
    case "banos": if (e.uso !== "bano") return false; break;
    case "cocinas": if (e.uso !== "cocina") return false; break;
    case "viviendas": if (!e.vivienda || e.vivienda === "COMUN") return false; break;
    case "comunes": if (e.vivienda !== "COMUN" && e.uso !== "comun") return false; break;
  }
  if (t.filtro && !(e.etiqueta ?? "").toLowerCase().includes(t.filtro.toLowerCase())) return false;
  return true;
}

/** Cantidad (en la unidad de la partida) que aporta un elemento a un trabajo, o null si no le corresponde. */
export function cantidad(e: Elemento, t: Trabajo): number | null {
  if (e.tipo_id !== t.tipo_id) return null;
  if (!enAmbito(e, t)) return null;
  const L = Number(e.longitud ?? 0), H = Number(e.altura ?? 0), S = Number(e.superficie ?? 0);
  let q: number;
  switch (t.magnitud) {
    case "longitud": q = L; break;
    case "superficie_pared": q = L * H; break; // los huecos no se descuentan
    case "superficie": q = S; break;
    case "perimetro": q = perimetro(e).valor; break;
    case "perimetro_altura": q = perimetro(e).valor * (H || 2.5); break;
    case "unidad": q = 1; break;
  }
  return q * Number(t.factor ?? 1);
}

/** Partida a la que se imputa: la variante húmeda si el elemento está en zona húmeda y existe. */
export function partidaDe(e: Elemento, t: Trabajo): string | null {
  return e.humedo && t.partida_humeda_id ? t.partida_humeda_id : t.partida_id;
}

// ───────────── Estado del avance a una fecha ─────────────
const clave = (el: string, fase: string) => `${el}|${fase}`;
const posterior = (a: { fecha: string; created_at: string }, b: { fecha: string; created_at: string }) =>
  a.fecha > b.fecha || (a.fecha === b.fecha && a.created_at > b.created_at);

/** % actual (0–100) de cada elemento y fase, considerando solo marcas con fecha ≤ corte. */
export function estadoAvances(avances: Avance[], corte?: string): Map<string, number> {
  const ult = new Map<string, Avance>();
  for (const a of avances) {
    if (corte && a.fecha > corte) continue;
    const k = clave(a.elemento_id, a.fase_id);
    const p = ult.get(k);
    if (!p || posterior(a, p)) ult.set(k, a);
  }
  return new Map([...ult].map(([k, a]) => [k, Number(a.porcentaje)]));
}

export function estadoManuales(manuales: AvanceManual[], corte?: string): Map<string, number> {
  const ult = new Map<string, AvanceManual>();
  for (const m of manuales) {
    if (corte && m.fecha > corte) continue;
    const p = ult.get(m.partida_id);
    if (!p || posterior(m, p)) ult.set(m.partida_id, m);
  }
  return new Map([...ult].map(([k, m]) => [k, Number(m.cantidad)]));
}

// ───────────── Resumen por partida ─────────────
export type ResumenPartida = {
  partida: Partida;
  origen: "plano" | "manual";
  medicionPlano: number;      // lo medido en plano para esa partida
  medidoEjecutado: number;    // cantidad ejecutada según plano (en unidades de lo medido)
  porcentaje: number;         // 0–1
  cantidad: number;           // cantidad ejecutada a certificar
  importe: number;            // cantidad × precio
  presupuesto: number;        // medicion × precio
  estimado: boolean;          // alguna cantidad del plano es estimada (estancia sin contorno)
};

type Indices = {
  fasesPorTrabajo: Map<string, { id: string; peso: number }[]>;
  elementosPorTipo: Map<string, Elemento[]>;
};

function indices(d: Pick<DatosObra, "fases" | "elementos">): Indices {
  const fasesPorTrabajo = new Map<string, { id: string; peso: number }[]>();
  for (const f of d.fases) {
    const l = fasesPorTrabajo.get(f.trabajo_id) ?? [];
    l.push({ id: f.id, peso: Number(f.peso) });
    fasesPorTrabajo.set(f.trabajo_id, l);
  }
  const elementosPorTipo = new Map<string, Elemento[]>();
  for (const e of d.elementos) {
    const l = elementosPorTipo.get(e.tipo_id) ?? [];
    l.push(e);
    elementosPorTipo.set(e.tipo_id, l);
  }
  return { fasesPorTrabajo, elementosPorTipo };
}

/** Fracción ejecutada (0–1) de un trabajo sobre un elemento: Σ peso × % de sus fases. */
function fraccion(e: Elemento, fases: { id: string; peso: number }[], estado: Map<string, number>) {
  const total = fases.reduce((s, f) => s + f.peso, 0) || 1;
  return fases.reduce((s, f) => s + f.peso * (estado.get(clave(e.id, f.id)) ?? 0) / 100, 0) / total;
}

export function resumenPartidas(d: DatosObra, corte?: string): Map<string, ResumenPartida> {
  const criterio = d.obra.ajustes?.criterio ?? "porcentaje";
  const estado = estadoAvances(d.avances, corte);
  const manual = estadoManuales(d.manuales, corte);
  const ix = indices(d);
  const plano = new Map<string, { medido: number; ejecutado: number; estimado: boolean }>();
  for (const t of d.trabajos) {
    const fases = ix.fasesPorTrabajo.get(t.id) ?? [];
    for (const e of ix.elementosPorTipo.get(t.tipo_id) ?? []) {
      const q = cantidad(e, t);
      const pid = partidaDe(e, t);
      if (q == null || !pid) continue;
      const acc = plano.get(pid) ?? { medido: 0, ejecutado: 0, estimado: false };
      acc.medido += q;
      acc.ejecutado += q * fraccion(e, fases, estado);
      if ((t.magnitud === "perimetro" || t.magnitud === "perimetro_altura") && perimetro(e).estimado) acc.estimado = true;
      plano.set(pid, acc);
    }
  }
  const res = new Map<string, ResumenPartida>();
  for (const p of d.partidas) {
    const med = Number(p.medicion), precio = Number(p.precio);
    const pl = plano.get(p.id);
    let r: ResumenPartida;
    if (pl && pl.medido > 0) {
      const pct = pl.ejecutado / pl.medido;
      const cant = criterio === "medicion" ? pl.ejecutado : pct * med;
      r = { partida: p, origen: "plano", medicionPlano: pl.medido, medidoEjecutado: pl.ejecutado, porcentaje: pct,
            cantidad: cant, importe: cant * precio, presupuesto: med * precio, estimado: pl.estimado };
    } else {
      const cant = manual.get(p.id) ?? 0;
      r = { partida: p, origen: "manual", medicionPlano: 0, medidoEjecutado: 0, porcentaje: med > 0 ? cant / med : 0,
            cantidad: cant, importe: cant * precio, presupuesto: med * precio, estimado: false };
    }
    res.set(p.id, r);
  }
  return res;
}

export function totales(resumen: Map<string, ResumenPartida>) {
  let presupuesto = 0, ejecutado = 0;
  for (const r of resumen.values()) {
    presupuesto += r.presupuesto;
    ejecutado += r.importe;
  }
  return { presupuesto, ejecutado, porcentaje: presupuesto ? ejecutado / presupuesto : 0 };
}

export function porCapitulo(d: DatosObra, resumen: Map<string, ResumenPartida>) {
  return d.capitulos.map((c) => {
    let presupuesto = 0, ejecutado = 0;
    for (const p of d.partidas) {
      if (p.capitulo_id !== c.id) continue;
      const r = resumen.get(p.id)!;
      presupuesto += r.presupuesto;
      ejecutado += r.importe;
    }
    return { capitulo: c, presupuesto, ejecutado, porcentaje: presupuesto ? ejecutado / presupuesto : 0 };
  });
}

// ───────────── Fechas y curvas ─────────────
export const hoyISO = () => new Date().toISOString().slice(0, 10);

export function finDeMes(periodo: string): string {
  const [a, m] = periodo.split("-").map(Number);
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
}

export function meses(desde: string, hasta: string): string[] {
  const out: string[] = [];
  let [a, m] = desde.slice(0, 7).split("-").map(Number);
  const [af, mf] = hasta.slice(0, 7).split("-").map(Number);
  while (a < af || (a === af && m <= mf)) {
    out.push(`${a}-${String(m).padStart(2, "0")}`);
    if (++m > 12) { m = 1; a++; }
  }
  return out;
}

const dias = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86400000;

/** Fracción del plazo transcurrida a una fecha. */
export function plazoConsumido(inicio: string | null, fin: string | null, fecha = hoyISO()) {
  if (!inicio || !fin) return null;
  const total = dias(inicio, fin);
  return total > 0 ? Math.min(1, Math.max(0, dias(inicio, fecha) / total)) : null;
}

/** Importe previsto a origen en una fecha: cada capítulo se reparte linealmente en su planificación (o en el plazo de la obra). */
export function previstoA(d: DatosObra, resumen: Map<string, ResumenPartida>, fecha: string) {
  const plan = new Map(d.planificacion.map((p) => [p.capitulo_id, p]));
  let total = 0;
  for (const c of porCapitulo(d, resumen)) {
    const p = plan.get(c.capitulo.id);
    const ini = p?.inicio ?? d.obra.fecha_inicio, fin = p?.fin ?? d.obra.fecha_fin;
    if (!ini || !fin) continue;
    const dur = Math.max(1, dias(ini, fin) + 1);
    total += c.presupuesto * Math.min(1, Math.max(0, (dias(ini, fecha) + 1) / dur));
  }
  return total;
}

export type PuntoCurva = { periodo: string; corte: string; previsto: number; real: number | null };

export function curva(d: DatosObra): PuntoCurva[] {
  const hoy = hoyISO();
  const fechas = [d.obra.fecha_inicio, d.obra.fecha_fin, ...d.planificacion.flatMap((p) => [p.inicio, p.fin]),
    ...d.avances.map((a) => a.fecha), ...d.manuales.map((m) => m.fecha)].filter(Boolean) as string[];
  if (!fechas.length) return [];
  const ini = fechas.reduce((a, b) => (a < b ? a : b)), fin = fechas.reduce((a, b) => (a > b ? a : b), hoy);
  const base = resumenPartidas(d);
  const pres = totales(base).presupuesto || 1;
  return meses(ini, fin).map((periodo) => {
    const corte = finDeMes(periodo);
    const real = periodo <= hoy.slice(0, 7) ? totales(resumenPartidas(d, corte < hoy ? corte : hoy)).ejecutado / pres : null;
    return { periodo, corte, previsto: previstoA(d, base, corte) / pres, real };
  });
}

// ───────────── Matriz viviendas × fases ─────────────
export type CeldaMatriz = { porcentaje: number; cantidad: number } | null;

export function matriz(d: DatosObra, corte?: string) {
  const estado = estadoAvances(d.avances, corte);
  const ix = indices(d);
  const columnas = d.trabajos
    .slice()
    .sort((a, b) => a.orden - b.orden)
    .flatMap((t) => d.fases.filter((f) => f.trabajo_id === t.id).sort((a, b) => a.orden - b.orden).map((f) => ({ trabajo: t, fase: f })));
  const viviendas = [...new Set(d.elementos.map((e) => e.vivienda).filter(Boolean) as string[])].sort();
  const celdas = new Map<string, CeldaMatriz>();
  for (const { trabajo, fase } of columnas) {
    const acc = new Map<string, { q: number; hecho: number }>();
    for (const e of ix.elementosPorTipo.get(trabajo.tipo_id) ?? []) {
      const q = cantidad(e, trabajo);
      if (!q || !e.vivienda) continue;
      const a = acc.get(e.vivienda) ?? { q: 0, hecho: 0 };
      a.q += q;
      a.hecho += q * (estado.get(clave(e.id, fase.id)) ?? 0) / 100;
      acc.set(e.vivienda, a);
    }
    for (const v of viviendas) {
      const a = acc.get(v);
      celdas.set(`${v}|${fase.id}`, a ? { porcentaje: a.hecho / a.q, cantidad: a.q } : null);
    }
  }
  return { columnas, viviendas, celdas };
}

/** % de cada fase de un elemento (para colorear el plano). */
export function avanceElemento(e: Elemento, faseIds: string[], estado: Map<string, number>) {
  return faseIds.map((f) => estado.get(clave(e.id, f)) ?? 0);
}

// ───────────── Certificaciones ─────────────
export function lineasCertificacion(d: DatosObra, corte: string, anteriores: LineaCertificacion[] | null): LineaCertificacion[] {
  const res = resumenPartidas(d, corte);
  const ant = new Map((anteriores ?? []).map((l) => [l.partida_id, l.origen]));
  return d.partidas.map((p) => ({
    partida_id: p.id, capitulo_id: p.capitulo_id, codigo: p.codigo, resumen: p.resumen, unidad: p.unidad,
    precio: Number(p.precio), medicion: Number(p.medicion),
    anterior: redondear(ant.get(p.id) ?? 0, 3),
    origen: redondear(res.get(p.id)!.cantidad, 3),
  }));
}

export function totalesCertificacion(lineas: LineaCertificacion[], a: Ajustes, coeficiente = 1): TotalesCertificacion {
  const pem_origen = redondear(lineas.reduce((s, l) => s + redondear(l.origen * l.precio), 0) * coeficiente);
  const pem_anterior = redondear(lineas.reduce((s, l) => s + redondear(l.anterior * l.precio), 0) * coeficiente);
  const pem_periodo = redondear(pem_origen - pem_anterior);
  const gg = a.aplicar.gg ? redondear(pem_periodo * a.gg) : 0;
  const bi = a.aplicar.bi ? redondear(pem_periodo * a.bi) : 0;
  const base = redondear(pem_periodo + gg + bi);
  const iva = a.aplicar.iva ? redondear(base * a.iva) : 0;
  const retencion = a.aplicar.retencion ? redondear(base * a.retencion) : 0;
  return { pem_origen, pem_anterior, pem_periodo, gg, bi, base, iva, retencion, total: redondear(base + iva - retencion) };
}

// ───────────── Formato ─────────────
// Formato español hecho a mano: Intl no agrupa los miles de 4 cifras (1113) y varía según la versión de Node.
export function num(n: number, d = 2): string {
  const v = Number.isFinite(n) ? n : 0;
  const [ent, dec] = Math.abs(v).toFixed(d).split(".");
  const signo = v < 0 && Number(`${ent}.${dec ?? 0}`) !== 0 ? "−" : "";
  return signo + ent.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + (dec ? `,${dec}` : "");
}
export const eur = (n: number, dec = true) => `${num(n || 0, dec ? 2 : 0)} €`;
export const pct = (n: number | null | undefined, d = 0) => (n == null ? "—" : `${num(n * 100, d)} %`);
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
/** «septiembre de 2026»; con mayuscula=true, «Septiembre de 2026». */
export const nombreMes = (periodo: string, mayuscula = false) => {
  const [a, m] = periodo.split("-").map(Number);
  const t = `${MESES[m - 1]} de ${a}`;
  return mayuscula ? t[0].toUpperCase() + t.slice(1) : t;
};
