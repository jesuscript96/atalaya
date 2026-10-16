"use server";
import { revalidatePath } from "next/cache";
import { supabaseServidor } from "@/lib/supabase/server";

/** Registra un documento ya subido al almacenamiento y, si es de planos o presupuesto, pide su procesado. */
export async function registrarDocumento(obraId: string, doc: { tipo: string; nombre: string; ruta: string; tamano: number }) {
  const sb = await supabaseServidor();
  const { data, error } = await sb.from("documentos").insert({ obra_id: obraId, ...doc }).select("id").single();
  if (error) throw new Error(error.message);
  if (doc.tipo === "planos" || doc.tipo === "presupuesto") await procesar(obraId, data.id);
  revalidatePath(`/obras/${obraId}`, "layout");
}

export async function procesar(obraId: string, documentoId: string) {
  const sb = await supabaseServidor();
  // se marca antes de llamar: el servicio puede terminar antes de que esta acción continúe
  await sb.from("documentos").update({ estado: "procesando", mensaje: null }).eq("id", documentoId);
  try {
    const r = await fetch(`${process.env.SERVICIO_PLANOS_URL}/procesar`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.SERVICIO_TOKEN ?? ""}` },
      body: JSON.stringify({ documento_id: documentoId }),
    });
    if (!r.ok) throw new Error(`El servicio respondió ${r.status}`);
  } catch (e) {
    await sb.from("documentos").update({ estado: "error", mensaje: `No se pudo contactar con el servicio de planos (${(e as Error).message})` }).eq("id", documentoId);
  }
  revalidatePath(`/obras/${obraId}`, "layout");
}

export async function borrarDocumento(obraId: string, documentoId: string) {
  const sb = await supabaseServidor();
  const { data } = await sb.from("documentos").select("ruta").eq("id", documentoId).single();
  if (data) await sb.storage.from("obras").remove([data.ruta]);
  await sb.from("documentos").delete().eq("id", documentoId);
  revalidatePath(`/obras/${obraId}`, "layout");
}

export async function enlaceDescarga(ruta: string) {
  const sb = await supabaseServidor();
  const { data } = await sb.storage.from("obras").createSignedUrl(ruta, 300, { download: true });
  return data?.signedUrl ?? null;
}
