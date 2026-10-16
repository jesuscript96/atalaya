"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { DEMO, type Consulta } from "./consulta";
import { consultarDemo, firmarDemo, quitarDemo, reiniciar, subirDemo } from "./almacen";

// Puente del navegador a la base en memoria del servidor (solo en modo demo).
function comprobar() {
  if (!DEMO) throw new Error("Solo disponible en modo demo");
}

export async function demoConsulta(c: Consulta) {
  comprobar();
  return consultarDemo(c);
}

export async function demoFirmar(rutas: string[]) {
  comprobar();
  return firmarDemo(rutas);
}

const MAX = 3_000_000; // ~2 MB de imagen en base64

export async function demoSubir(ruta: string, dataUrl: string): Promise<string | null> {
  comprobar();
  if (!dataUrl.startsWith("data:image/")) return "En la demo solo se pueden subir fotos";
  if (dataUrl.length > MAX) return "La imagen es demasiado grande para la demo";
  await subirDemo(ruta, dataUrl);
  return null;
}

export async function demoQuitar(rutas: string[]) {
  comprobar();
  await quitarDemo(rutas);
}

export async function reiniciarDemo() {
  comprobar();
  await reiniciar();
  revalidatePath("/", "layout");
  redirect("/");
}
