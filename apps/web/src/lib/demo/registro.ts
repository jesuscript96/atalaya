// Registro de cambios de la demo en Vercel Blob (privado). Cada escritura es una entrada numerada
// (demo-log/00000001.json…); los reinicios dejan además una marca en demo-reset/. Así todas las instancias del
// servidor llegan al mismo estado reproduciendo las entradas en orden.
import { get, list, put } from "@vercel/blob";
import type { Consulta } from "./consulta";

export const PERSISTE = !!process.env.BLOB_READ_WRITE_TOKEN;
export const COOKIE_VERSION = "atalaya_demo_v";

export type Entrada =
  | { tipo: "consulta"; c: Consulta }
  | { tipo: "archivo"; ruta: string; dataUrl: string }
  | { tipo: "quitar"; rutas: string[] }
  | { tipo: "reiniciar" };

const LOG = "demo-log/", RESET = "demo-reset/";
const nombre = (n: number) => `${LOG}${String(n).padStart(8, "0")}.json`;
const numero = (pathname: string) => Number(pathname.replace(/^.*\//, "").replace(/\.json$/, "")) || 0;

async function todos(prefix: string): Promise<number[]> {
  const out: number[] = [];
  let cursor: string | undefined;
  do {
    const r = await list({ prefix, cursor, limit: 1000 });
    out.push(...r.blobs.map((b) => numero(b.pathname)));
    cursor = r.hasMore ? r.cursor : undefined;
  } while (cursor);
  return out;
}

/** Última entrada y último reinicio registrados. */
export async function situacion(): Promise<{ ultima: number; reinicio: number }> {
  const [log, resets] = await Promise.all([todos(LOG), todos(RESET)]);
  return { ultima: Math.max(0, ...log), reinicio: Math.max(0, ...resets) };
}

export async function leer(n: number): Promise<Entrada | null> {
  const r = await get(nombre(n), { access: "private", useCache: false });
  if (!r || r.statusCode !== 200) return null;
  return JSON.parse(await new Response(r.stream).text()) as Entrada;
}

/** Escribe la entrada n; devuelve false si ya existía (otra instancia se adelantó). */
export async function escribir(n: number, e: Entrada): Promise<boolean> {
  try {
    await put(nombre(n), JSON.stringify(e), { access: "private", addRandomSuffix: false, allowOverwrite: false, contentType: "application/json" });
  } catch (err) {
    if (/exist/i.test((err as Error).message)) return false;
    throw err;
  }
  if (e.tipo === "reiniciar") {
    await put(`${RESET}${String(n).padStart(8, "0")}.json`, "{}", { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json" });
  }
  return true;
}
