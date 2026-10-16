import { cargarDatos } from "@/lib/datos";
import { supabaseServidor } from "@/lib/supabase/server";
import type { Certificacion } from "@/lib/tipos";
import { Certificaciones } from "./Certificaciones";

export const metadata = { title: "Certificaciones" };

export default async function Pagina({ params }: PageProps<"/obras/[id]/certificaciones">) {
  const { id } = await params;
  const sb = await supabaseServidor();
  const [datos, { data }] = await Promise.all([
    cargarDatos(id),
    sb.from("certificaciones").select("*").eq("obra_id", id).order("numero"),
  ]);
  return <Certificaciones datos={datos} certificaciones={(data ?? []) as Certificacion[]} />;
}
