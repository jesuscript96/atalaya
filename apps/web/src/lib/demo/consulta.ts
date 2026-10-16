// Modo demo: imitación mínima del cliente de Supabase sobre una base en memoria.
// Cubre solo lo que usa la app (select/insert/update/upsert/delete con eq, in, not is null, gte, lte, order, range, limit,
// single y maybeSingle). La consulta se describe como un objeto plano para poder enviarla del navegador al servidor.

export const DEMO = process.env.NEXT_PUBLIC_ATALAYA_DEMO === "1";

type Valor = string | number | boolean | null;
export type Fila = Record<string, unknown>;
export type Base = Record<string, Fila[]>;

export type Filtro =
  | { op: "eq" | "gte" | "lte"; col: string; v: Valor }
  | { op: "in"; col: string; v: Valor[] }
  | { op: "notnull"; col: string };

export type Consulta = {
  tabla: string;
  accion: "select" | "insert" | "update" | "upsert" | "delete";
  columnas: string | null;       // columnas a devolver (null: no se piden)
  filtros: Filtro[];
  orden: { col: string; asc: boolean }[];
  desde?: number;
  hasta?: number;
  limite?: number;
  unico?: "single" | "maybe";
  valores?: Fila | Fila[];
  conflicto?: string;            // upsert: columnas que identifican la fila
};

export type Respuesta = { data: unknown; error: { message: string } | null; count: null; status: number; statusText: string };

const ok = (data: unknown): Respuesta => ({ data, error: null, count: null, status: 200, statusText: "OK" });
const fallo = (message: string): Respuesta => ({ data: null, error: { message }, count: null, status: 400, statusText: "Error" });

// ───────────── Constructor encadenable (thenable, como el de supabase-js) ─────────────
export class Constructor implements PromiseLike<Respuesta> {
  private c: Consulta;
  constructor(tabla: string, private ejecutar: (c: Consulta) => Promise<Respuesta>) {
    this.c = { tabla, accion: "select", columnas: null, filtros: [], orden: [] };
  }
  select(columnas = "*") {
    this.c.columnas = columnas;
    return this;
  }
  insert(valores: Fila | Fila[]) { this.c.accion = "insert"; this.c.valores = valores; return this; }
  update(valores: Fila) { this.c.accion = "update"; this.c.valores = valores; return this; }
  upsert(valores: Fila | Fila[], o?: { onConflict?: string }) { this.c.accion = "upsert"; this.c.valores = valores; this.c.conflicto = o?.onConflict; return this; }
  delete() { this.c.accion = "delete"; return this; }
  eq(col: string, v: Valor) { this.c.filtros.push({ op: "eq", col, v }); return this; }
  gte(col: string, v: Valor) { this.c.filtros.push({ op: "gte", col, v }); return this; }
  lte(col: string, v: Valor) { this.c.filtros.push({ op: "lte", col, v }); return this; }
  in(col: string, v: Valor[]) { this.c.filtros.push({ op: "in", col, v }); return this; }
  not(col: string, operador: string, v: Valor) {
    if (operador !== "is" || v !== null) throw new Error(`Demo: filtro not(${operador}) no soportado`);
    this.c.filtros.push({ op: "notnull", col });
    return this;
  }
  order(col: string, o?: { ascending?: boolean }) { this.c.orden.push({ col, asc: o?.ascending ?? true }); return this; }
  range(desde: number, hasta: number) { this.c.desde = desde; this.c.hasta = hasta; return this; }
  limit(n: number) { this.c.limite = n; return this; }
  single() { this.c.unico = "single"; return this; }
  maybeSingle() { this.c.unico = "maybe"; return this; }
  then<A = Respuesta, B = never>(ok?: ((r: Respuesta) => A | PromiseLike<A>) | null, ko?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return this.ejecutar(structuredClone(this.c)).then(ok, ko);
  }
}

// ───────────── Ejecución sobre la base en memoria ─────────────
const hoy = () => new Date().toISOString().slice(0, 10);
const AJUSTES = { gg: 0.13, bi: 0.06, iva: 0.1, retencion: 0.05, aplicar: { gg: false, bi: false, iva: true, retencion: false }, criterio: "porcentaje", coeficiente_contratista: 1 };

/** Valores por defecto de cada tabla (los del esquema SQL). */
function porDefecto(tabla: string, base: Base): Fila {
  const ahora = new Date().toISOString();
  const comun = { id: crypto.randomUUID(), created_at: ahora };
  const siguiente = () => Math.max(0, ...(base[tabla] ?? []).map((f) => Number(f.id) || 0)) + 1;
  switch (tabla) {
    case "obras": return { ...comun, direccion: null, cliente: null, fecha_inicio: null, fecha_fin: null, ajustes: AJUSTES };
    case "documentos": return { ...comun, estado: "pendiente", mensaje: null, resumen: null, tamano: null };
    case "avances": return { id: siguiente(), created_at: ahora, fecha: hoy(), usuario: null, nota: null };
    case "avances_manuales": return { id: siguiente(), created_at: ahora, fecha: hoy(), usuario: null, nota: null };
    case "elementos": return { ...comun, hoja_id: null, vivienda: null, etiqueta: null, uso: null, longitud: null, superficie: null, altura: null, humedo: false, origen: "plano", datos: {} };
    case "trabajos": return { id: comun.id, partida_id: null, partida_humeda_id: null, factor: 1, ambito: "todas", filtro: null, orden: 0 };
    case "fases": return { id: comun.id, peso: 1, orden: 0 };
    case "diario": return { ...comun, fecha: hoy(), texto_original: null, audio: null, meteo: null, personal: null, usuario: null, updated_at: ahora };
    case "fotos": return { ...comun, fecha: hoy(), miniatura: null, vivienda: null, estancia: null, diario_id: null, nota: null, ancho: null, alto: null, usuario: null };
    case "certificaciones": return { ...comun, destinatario: "cliente", usuario: null };
    default: return { id: comun.id };
  }
}

// borrados en cascada del esquema (tabla hija, columna) y columnas que pasan a null
const CASCADA: Record<string, [string, string][]> = {
  obras: ["documentos", "hojas", "viviendas", "capitulos", "partidas", "tipos_elemento", "trabajos", "fases", "elementos", "avances",
    "avances_manuales", "planificacion", "certificaciones", "diario", "fotos"].map((t) => [t, "obra_id"]),
  capitulos: [["partidas", "capitulo_id"], ["planificacion", "capitulo_id"]],
  partidas: [["avances_manuales", "partida_id"]],
  tipos_elemento: [["trabajos", "tipo_id"], ["elementos", "tipo_id"]],
  trabajos: [["fases", "trabajo_id"]],
  fases: [["avances", "fase_id"]],
  elementos: [["avances", "elemento_id"]],
  hojas: [["elementos", "hoja_id"]],
};
const A_NULL: Record<string, [string, string][]> = {
  partidas: [["trabajos", "partida_id"], ["trabajos", "partida_humeda_id"]],
  diario: [["fotos", "diario_id"]],
};

function borrarEnCascada(base: Base, tabla: string, ids: Set<unknown>) {
  base[tabla] = (base[tabla] ?? []).filter((f) => !ids.has(f.id));
  for (const [hija, col] of A_NULL[tabla] ?? []) for (const f of base[hija] ?? []) if (ids.has(f[col])) f[col] = null;
  for (const [hija, col] of CASCADA[tabla] ?? []) {
    const borrar = new Set((base[hija] ?? []).filter((f) => ids.has(f[col])).map((f) => f.id));
    if (borrar.size) borrarEnCascada(base, hija, borrar);
  }
}

const igual = (a: unknown, b: unknown) => (a == null || b == null ? a == b : String(a) === String(b));
const comparar = (a: unknown, b: unknown) => {
  if (a == null) return b == null ? 0 : -1;
  if (b == null) return 1;
  return typeof a === "number" && typeof b === "number" ? a - b : String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
};

function cumple(f: Fila, filtros: Filtro[]) {
  return filtros.every((x) => {
    const v = f[x.col];
    switch (x.op) {
      case "eq": return igual(v, x.v);
      case "in": return x.v.some((y) => igual(v, y));
      case "notnull": return v != null;
      case "gte": return v != null && comparar(v, x.v) >= 0;
      case "lte": return v != null && comparar(v, x.v) <= 0;
    }
  });
}

function proyectar(f: Fila, columnas: string) {
  if (columnas.trim() === "*") return structuredClone(f);
  return Object.fromEntries(columnas.split(",").map((c) => c.trim()).filter(Boolean).map((c) => [c, structuredClone(f[c] ?? null)]));
}

/** Rellena los valores por defecto (ids, fechas…) antes de registrar una escritura, para que al
 *  reproducirla en otra instancia del servidor salgan exactamente las mismas filas. */
export function materializar(base: Base, c: Consulta): Consulta {
  if (c.accion !== "insert" && c.accion !== "upsert") return c;
  const lista = Array.isArray(c.valores) ? c.valores : [c.valores ?? {}];
  const claves = (c.conflicto ?? "id").split(",").map((k) => k.trim());
  const tabla = base[c.tabla] ?? [];
  const valores = lista.map((v, i) => {
    if (c.accion === "upsert" && tabla.some((f) => claves.every((k) => igual(f[k], v[k])))) return v;
    const d = porDefecto(c.tabla, base);
    if (typeof d.id === "number") d.id = d.id + i;
    return { ...d, ...v };
  });
  return { ...c, valores: Array.isArray(c.valores) ? valores : valores[0] };
}

export function ejecutar(base: Base, c: Consulta): Respuesta {
  const tabla = (base[c.tabla] ??= []);
  let filas: Fila[];
  switch (c.accion) {
    case "select":
      filas = tabla.filter((f) => cumple(f, c.filtros));
      break;
    case "insert": {
      const nuevas = (materializar(base, c).valores as Fila[] | Fila);
      const lista = Array.isArray(nuevas) ? nuevas.map((n) => ({ ...n })) : [{ ...nuevas }];
      tabla.push(...lista);
      filas = lista;
      break;
    }
    case "update":
      filas = tabla.filter((f) => cumple(f, c.filtros));
      for (const f of filas) Object.assign(f, structuredClone(c.valores as Fila));
      break;
    case "upsert": {
      const claves = (c.conflicto ?? "id").split(",").map((k) => k.trim());
      filas = [];
      for (const v of Array.isArray(c.valores) ? c.valores : [c.valores ?? {}]) {
        const existente = tabla.find((f) => claves.every((k) => igual(f[k], v[k])));
        if (existente) { Object.assign(existente, structuredClone(v)); filas.push(existente); }
        else { const n = { ...porDefecto(c.tabla, base), ...v }; tabla.push(n); filas.push(n); }
      }
      break;
    }
    case "delete":
      filas = tabla.filter((f) => cumple(f, c.filtros));
      borrarEnCascada(base, c.tabla, new Set(filas.map((f) => f.id)));
      break;
  }
  if (c.accion !== "select" && c.columnas == null) return ok(null);
  for (const o of [...c.orden].reverse()) filas = [...filas].sort((a, b) => (o.asc ? 1 : -1) * comparar(a[o.col], b[o.col]));
  if (c.desde != null) filas = filas.slice(c.desde, (c.hasta ?? filas.length) + 1);
  if (c.limite != null) filas = filas.slice(0, c.limite);
  const datos = filas.map((f) => proyectar(f, c.columnas ?? "*"));
  if (c.unico === "single") return datos.length === 1 ? ok(datos[0]) : fallo(`Se esperaba una fila y hay ${datos.length}`);
  if (c.unico === "maybe") return datos.length > 1 ? fallo("Hay más de una fila") : ok(datos[0] ?? null);
  return ok(datos);
}

// ───────────── Cliente con la forma de supabase-js ─────────────
export type Almacenamiento = {
  firmar: (rutas: string[]) => Promise<(string | null)[]>;
  subir: (ruta: string, archivo: Blob) => Promise<string | null>; // devuelve el error o null
  quitar: (rutas: string[]) => Promise<void>;
};

export function clienteDemo(consultar: (c: Consulta) => Promise<Respuesta>, alm: Almacenamiento) {
  return {
    from: (tabla: string) => new Constructor(tabla, consultar),
    auth: {
      getClaims: async () => ({ data: { claims: { sub: "demo" } }, error: null }),
      getUser: async () => ({ data: { user: { id: "demo", email: "demo@atalaya" } }, error: null }),
      signInWithPassword: async () => ({ data: {}, error: null }),
      signOut: async () => ({ error: null }),
    },
    storage: {
      from: () => ({
        createSignedUrl: async (ruta: string) => {
          const [u] = await alm.firmar([ruta]);
          return u ? { data: { signedUrl: u }, error: null } : { data: null, error: { message: "No disponible en la demo" } };
        },
        createSignedUrls: async (rutas: string[]) => {
          const us = await alm.firmar(rutas);
          return { data: rutas.map((path, i) => ({ path, signedUrl: us[i] ?? "", error: us[i] ? null : "No disponible" })), error: null };
        },
        upload: async (ruta: string, archivo: Blob) => {
          const e = await alm.subir(ruta, archivo);
          return e ? { data: null, error: { message: e } } : { data: { path: ruta }, error: null };
        },
        remove: async (rutas: string[]) => { await alm.quitar(rutas); return { data: [], error: null }; },
        list: async () => ({ data: [] as { name: string }[], error: null }),
      }),
    },
  };
}
