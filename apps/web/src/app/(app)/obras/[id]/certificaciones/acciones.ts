"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { finDeMes, totalesCertificacion } from "@/lib/calculo";
import { supabaseServidor } from "@/lib/supabase/server";
import type { Ajustes, LineaCertificacion } from "@/lib/tipos";

export async function cerrarCertificacion(obraId: string, c: {
  destinatario: "cliente" | "contratista"; periodo: string; ajustes: Ajustes; lineas: LineaCertificacion[]; coeficiente: number;
}) {
  const sb = await supabaseServidor();
  const { data: previas } = await sb.from("certificaciones").select("numero,periodo").eq("obra_id", obraId).eq("destinatario", c.destinatario)
    .order("numero", { ascending: false }).limit(1);
  const ultima = previas?.[0];
  if (ultima && ultima.periodo >= c.periodo) throw new Error(`Ya hay una certificación de ${ultima.periodo}; solo se puede cerrar un mes posterior.`);
  const ajustes = { ...c.ajustes, coeficiente: c.coeficiente };
  const { data, error } = await sb.from("certificaciones").insert({
    obra_id: obraId, destinatario: c.destinatario, numero: (ultima?.numero ?? 0) + 1, periodo: c.periodo,
    fecha_cierre: finDeMes(c.periodo), ajustes, lineas: c.lineas, totales: totalesCertificacion(c.lineas, c.ajustes, c.coeficiente),
  }).select("id").single();
  if (error) throw new Error(error.message);
  revalidatePath(`/obras/${obraId}/certificaciones`);
  redirect(`/obras/${obraId}/certificaciones/${data.id}`);
}

export async function borrarCertificacion(obraId: string, id: string) {
  const sb = await supabaseServidor();
  const { data: c } = await sb.from("certificaciones").select("numero,destinatario").eq("id", id).single();
  if (!c) return;
  const { data: posteriores } = await sb.from("certificaciones").select("id").eq("obra_id", obraId).eq("destinatario", c.destinatario).gt("numero", c.numero);
  if (posteriores?.length) throw new Error("Solo se puede borrar la última certificación.");
  await sb.from("certificaciones").delete().eq("id", id);
  revalidatePath(`/obras/${obraId}/certificaciones`);
  redirect(`/obras/${obraId}/certificaciones`);
}
