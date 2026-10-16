"use server";
import { revalidatePath } from "next/cache";
import { supabaseServidor } from "@/lib/supabase/server";
import type { Fase, Trabajo } from "@/lib/tipos";

const ok = (obraId: string) => revalidatePath(`/obras/${obraId}`, "layout");

export async function guardarPlanificacion(obraId: string, capituloId: string, inicio: string | null, fin: string | null) {
  const sb = await supabaseServidor();
  if (!inicio || !fin) {
    await sb.from("planificacion").delete().eq("obra_id", obraId).eq("capitulo_id", capituloId);
  } else {
    const { error } = await sb.from("planificacion").upsert({ obra_id: obraId, capitulo_id: capituloId, inicio, fin }, { onConflict: "obra_id,capitulo_id" });
    if (error) throw new Error(error.message);
  }
  ok(obraId);
}

export async function guardarTrabajo(obraId: string, t: Omit<Trabajo, "id"> & { id?: string }, fases: (Omit<Fase, "id" | "trabajo_id"> & { id?: string })[]) {
  const sb = await supabaseServidor();
  const fila = { obra_id: obraId, tipo_id: t.tipo_id, partida_id: t.partida_id || null, partida_humeda_id: t.partida_humeda_id || null, nombre: t.nombre,
                 magnitud: t.magnitud, factor: t.factor, ambito: t.ambito, filtro: t.filtro?.trim() || null, orden: t.orden };
  let id = t.id;
  if (id) {
    const { error } = await sb.from("trabajos").update(fila).eq("id", id);
    if (error) throw new Error(error.message);
  } else {
    const { data, error } = await sb.from("trabajos").insert(fila).select("id").single();
    if (error) throw new Error(error.message);
    id = data.id;
  }
  // las fases que ya tienen avances se conservan (se actualizan); las quitadas se borran con sus avances
  const { data: actuales } = await sb.from("fases").select("id").eq("trabajo_id", id);
  const quedan = new Set(fases.filter((f) => f.id).map((f) => f.id));
  const borrar = (actuales ?? []).map((f) => f.id).filter((x) => !quedan.has(x));
  if (borrar.length) await sb.from("fases").delete().in("id", borrar);
  for (const [i, f] of fases.entries()) {
    const datos = { obra_id: obraId, trabajo_id: id, nombre: f.nombre, peso: f.peso, orden: i };
    const { error } = f.id ? await sb.from("fases").update(datos).eq("id", f.id) : await sb.from("fases").insert(datos);
    if (error) throw new Error(error.message);
  }
  ok(obraId);
}

export async function borrarTrabajo(obraId: string, id: string) {
  const sb = await supabaseServidor();
  await sb.from("trabajos").delete().eq("id", id);
  ok(obraId);
}

export async function revincular(obraId: string) {
  const r = await fetch(`${process.env.SERVICIO_PLANOS_URL}/vincular/${obraId}`, {
    method: "POST", headers: { Authorization: `Bearer ${process.env.SERVICIO_TOKEN ?? ""}` },
  });
  if (!r.ok) throw new Error(`El servicio de planos respondió ${r.status}`);
  ok(obraId);
  return (await r.json()) as { trabajos: number };
}

export async function guardarEncuadre(obraId: string, hojaId: string, encuadre: "planta" | "propio") {
  const sb = await supabaseServidor();
  const { error } = await sb.from("hojas").update({ encuadre }).eq("id", hojaId);
  if (error) throw new Error(error.message);
  ok(obraId);
}
