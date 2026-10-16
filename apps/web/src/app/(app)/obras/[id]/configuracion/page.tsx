import { cargarDatos } from "@/lib/datos";
import { supabaseServidor } from "@/lib/supabase/server";
import type { Hoja } from "@/lib/tipos";
import { Configuracion } from "./Configuracion";

export const metadata = { title: "Configuración" };

export default async function Pagina({ params }: PageProps<"/obras/[id]/configuracion">) {
  const { id } = await params;
  const sb = await supabaseServidor();
  const [datos, { data: hojas }] = await Promise.all([
    cargarDatos(id),
    sb.from("hojas").select("id,pagina,titulo,disciplina,escala,ancho_m,alto_m,imagen,principal,orden,encuadre").eq("obra_id", id).order("orden"),
  ]);
  return <Configuracion datos={datos} hojas={(hojas ?? []) as Hoja[]} />;
}
