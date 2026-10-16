"use server";
import { revalidatePath } from "next/cache";
import { supabaseServidor } from "@/lib/supabase/server";

const ok = (obraId: string) => revalidatePath(`/obras/${obraId}`, "layout");

export async function registrarFoto(obraId: string, f: {
  id: string; ruta: string; miniatura: string; fecha: string; vivienda: string | null; estancia: string | null; nota: string | null; ancho: number; alto: number;
}) {
  const sb = await supabaseServidor();
  const { error } = await sb.from("fotos").insert({ obra_id: obraId, ...f });
  if (error) throw new Error(error.message);
  ok(obraId);
}

export async function actualizarFoto(obraId: string, id: string, c: { fecha?: string; vivienda?: string | null; estancia?: string | null; nota?: string | null }) {
  const sb = await supabaseServidor();
  const { error } = await sb.from("fotos").update(c).eq("id", id);
  if (error) throw new Error(error.message);
  ok(obraId);
}

export async function borrarFoto(obraId: string, id: string) {
  const sb = await supabaseServidor();
  const { data } = await sb.from("fotos").select("ruta,miniatura").eq("id", id).single();
  if (data) await sb.storage.from("obras").remove([data.ruta, data.miniatura].filter(Boolean) as string[]);
  const { error } = await sb.from("fotos").delete().eq("id", id);
  if (error) throw new Error(error.message);
  ok(obraId);
}

export async function enlaceFoto(ruta: string) {
  const sb = await supabaseServidor();
  const { data } = await sb.storage.from("obras").createSignedUrl(ruta, 3600);
  return data?.signedUrl ?? null;
}
