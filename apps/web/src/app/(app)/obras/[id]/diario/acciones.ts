"use server";
import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import { supabaseServidor } from "@/lib/supabase/server";
import type { Diario } from "@/lib/tipos";

const ok = (obraId: string) => revalidatePath(`/obras/${obraId}`, "layout");

export async function guardarEntrada(
  obraId: string,
  e: { id?: string; fecha: string; texto: string; texto_original?: string | null; meteo?: string | null; personal?: number | null },
): Promise<Diario> {
  const texto = e.texto.trim();
  if (!texto) throw new Error("La anotación está vacía");
  const sb = await supabaseServidor();
  const fila = { fecha: e.fecha, texto, texto_original: e.texto_original ?? null, meteo: e.meteo || null, personal: e.personal ?? null };
  const sel = "id,obra_id,fecha,texto,texto_original,meteo,personal,created_at,updated_at";
  const { data, error } = e.id
    ? await sb.from("diario").update({ ...fila, updated_at: new Date().toISOString() }).eq("id", e.id).select(sel).single()
    : await sb.from("diario").insert({ obra_id: obraId, ...fila }).select(sel).single();
  if (error) throw new Error(error.message);
  ok(obraId);
  return data as Diario;
}

export async function borrarEntrada(obraId: string, id: string) {
  const sb = await supabaseServidor();
  const { error } = await sb.from("diario").delete().eq("id", id);
  if (error) throw new Error(error.message);
  ok(obraId);
}

const INSTRUCCIONES = `Eres el redactor del diario de obra de una empresa constructora. Recibes notas dictadas o escritas a toda prisa por el jefe de obra.
Devuelve SOLO el texto redactado en castellano, en párrafos cortos, corrigiendo ortografía y puntuación.
No inventes datos ni cifras. Mantén tal cual los nombres de viviendas, estancias, gremios, empresas, cantidades y fechas.
Tono de parte de obra: impersonal o en tercera persona, frases claras. Sin encabezados, sin viñetas, sin comentarios ni explicaciones adicionales.`;

/** Redacta con IA una anotación dictada o escrita deprisa. Necesita ANTHROPIC_API_KEY en el entorno. */
export async function mejorarTexto(texto: string): Promise<string> {
  if (!texto.trim()) throw new Error("No hay texto que mejorar");
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("Falta ANTHROPIC_API_KEY en .env.local para mejorar el texto con IA");
  const client = new Anthropic();
  try {
    const r = await client.messages.create({
      model: process.env.ATALAYA_MODELO_IA ?? "claude-haiku-5-5",
      max_tokens: 2000,
      system: INSTRUCCIONES,
      messages: [{ role: "user", content: texto }],
    });
    const bloque = r.content.find((b) => b.type === "text");
    if (!bloque || bloque.type !== "text" || !bloque.text.trim()) throw new Error("La IA no ha devuelto texto");
    return bloque.text.trim();
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new Error("La clave de la API de Claude no es válida");
    if (e instanceof Anthropic.RateLimitError) throw new Error("La API de Claude está saturada; vuelve a intentarlo en un momento");
    if (e instanceof Anthropic.APIError) throw new Error(`Error de la API de Claude: ${e.message}`);
    throw e;
  }
}
