import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { cookies } from "next/headers";
import { type Base, type Consulta, type Respuesta, clienteDemo, ejecutar, materializar } from "./consulta";
import { COOKIE_VERSION, type Entrada, PERSISTE, escribir, leer, situacion } from "./registro";

// Copia de la obra exportada con scripts/exportar-demo.sh. No está en el repositorio: se despliega desde local.
const ARCHIVO = path.join(process.cwd(), "demo-privado", "obra.json");

type Estado = { base: Base; archivos: Map<string, string>; version: number; listo: boolean };
const g = globalThis as unknown as { __atalayaDemo?: Estado; __atalayaCola?: Promise<unknown> };

function cargar(): Base {
  try {
    return JSON.parse(readFileSync(ARCHIVO, "utf8")) as Base;
  } catch {
    return { obras: [] };
  }
}

const estado = (): Estado => (g.__atalayaDemo ??= { base: cargar(), archivos: new Map(), version: 0, listo: !PERSISTE });

/** Las operaciones sobre el estado van de una en una dentro de cada instancia. */
function enCola<T>(fn: () => Promise<T>): Promise<T> {
  const r = (g.__atalayaCola ?? Promise.resolve()).then(fn, fn);
  g.__atalayaCola = r.catch(() => undefined);
  return r;
}

function aplicar(e: Estado, x: Entrada): Respuesta | null {
  switch (x.tipo) {
    case "consulta": return ejecutar(e.base, x.c);
    case "archivo": e.archivos.set(x.ruta, x.dataUrl); return null;
    case "quitar": x.rutas.forEach((r) => e.archivos.delete(r)); return null;
    case "reiniciar": e.base = cargar(); e.archivos = new Map(); return null;
  }
}

/** Aplica las entradas registradas que falten, en lotes, hasta `hasta` (o hasta que no haya más). */
async function avanzar(e: Estado, hasta?: number) {
  for (;;) {
    const fin = hasta ?? e.version + 20;
    if (e.version >= fin) return;
    const ns = Array.from({ length: Math.min(20, fin - e.version) }, (_, i) => e.version + 1 + i);
    const entradas = await Promise.all(ns.map(leer));
    for (const x of entradas) {
      if (!x) return;
      aplicar(e, x);
      e.version++;
    }
  }
}

async function versionCookie(): Promise<number | null> {
  try {
    const v = (await cookies()).get(COOKIE_VERSION)?.value;
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}

async function guardarCookie(v: number) {
  try {
    (await cookies()).set(COOKIE_VERSION, String(v), { path: "/", httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 12 });
  } catch {
    // al renderizar no se pueden escribir cookies: solo se guardan desde acciones
  }
}

/** Primera vez en esta instancia: desde el último reinicio. Después, hasta la versión que trae el visitante. */
async function sincronizar(): Promise<Estado> {
  const e = estado();
  if (!PERSISTE) return e;
  return enCola(async () => {
    const pedida = await versionCookie();
    if (!e.listo) {
      const s = await situacion();
      if (s.reinicio > e.version) { e.base = cargar(); e.archivos = new Map(); e.version = s.reinicio; }
      await avanzar(e, s.ultima);
      e.listo = true;
    }
    if (pedida != null && pedida > e.version) await avanzar(e, pedida);
    return e;
  });
}

/** Registra un cambio (si hay almacén) y lo aplica; la cookie del visitante pasa a la nueva versión. */
async function registrar(crear: (e: Estado) => Entrada): Promise<Respuesta | null> {
  await sincronizar();
  return enCola(async () => {
    const e = estado();
    let x = crear(e);
    if (PERSISTE) {
      while (!(await escribir(e.version + 1, x))) {
        await avanzar(e);   // otra instancia escribió antes: ponerse al día y volver a preparar la entrada
        x = crear(e);
      }
    }
    const r = aplicar(e, x);
    e.version++;
    await guardarCookie(e.version);
    return r;
  });
}

export async function consultarDemo(c: Consulta): Promise<Respuesta> {
  if (c.accion === "select") return ejecutar((await sincronizar()).base, c);
  return (await registrar((e) => ({ tipo: "consulta", c: materializar(e.base, c) })))!;
}

/** Las imágenes de las hojas están en public/demo; las fotos subidas en la visita, en el registro como data URL. */
export async function firmarDemo(rutas: string[]): Promise<(string | null)[]> {
  const { archivos } = await sincronizar();
  return rutas.map((r) => archivos.get(r) ?? (r.includes("/documentos/") || r.includes("/fotos/") ? null : `/demo/${r}`));
}

export async function subirDemo(ruta: string, dataUrl: string) {
  await registrar(() => ({ tipo: "archivo", ruta, dataUrl }));
}

export async function quitarDemo(rutas: string[]) {
  await registrar(() => ({ tipo: "quitar", rutas }));
}

export async function reiniciar() {
  await registrar(() => ({ tipo: "reiniciar" }));
}

export function clienteServidorDemo() {
  return clienteDemo(consultarDemo, {
    firmar: firmarDemo,
    subir: async () => "En la demo no se suben archivos desde el servidor",
    quitar: quitarDemo,
  });
}
