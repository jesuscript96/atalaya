import { supabaseServidor } from "@/lib/supabase/server";
import type { Documento } from "@/lib/tipos";
import { Documentos } from "./Documentos";

export const metadata = { title: "Documentos" };

export default async function Pagina({ params }: PageProps<"/obras/[id]/documentos">) {
  const { id } = await params;
  const sb = await supabaseServidor();
  const { data } = await sb.from("documentos").select("*").eq("obra_id", id).order("created_at", { ascending: false });
  return <Documentos obraId={id} documentos={(data ?? []) as Documento[]} />;
}
