import { cargarDatos } from "@/lib/datos";
import { supabaseServidor } from "@/lib/supabase/server";
import type { Hoja } from "@/lib/tipos";
import Link from "next/link";
import { VisorPlanos } from "./VisorPlanos";

export const metadata = { title: "Planos" };

export default async function Pagina({ params, searchParams }: PageProps<"/obras/[id]/planos">) {
  const { id } = await params;
  const sp = await searchParams;
  const inicial = { vivienda: typeof sp.vivienda === "string" ? sp.vivienda : "", trabajo: typeof sp.trabajo === "string" ? sp.trabajo : "", fase: typeof sp.fase === "string" ? sp.fase : "" };
  const sb = await supabaseServidor();
  const [datos, { data: hojasDb }] = await Promise.all([
    cargarDatos(id),
    sb.from("hojas").select("id,pagina,titulo,disciplina,escala,ancho_m,alto_m,imagen,principal,orden,encuadre").eq("obra_id", id).order("orden"),
  ]);
  const hojas = (hojasDb ?? []) as Hoja[];
  if (!hojas.length) {
    return (
      <main className="p-6 max-w-xl mx-auto w-full">
        <div className="card card-pad text-center py-12">
          <h2>Sin planos</h2>
          <p className="muted mt-1">Sube el PDF de planos en <Link className="underline" href={`/obras/${id}/documentos`}>Documentos</Link>.</p>
        </div>
      </main>
    );
  }
  const rutas = hojas.map((h) => h.imagen).filter(Boolean) as string[];
  const { data: firmadas } = await sb.storage.from("obras").createSignedUrls(rutas, 60 * 60 * 8);
  const urls = Object.fromEntries((firmadas ?? []).map((f) => [f.path, f.signedUrl]));
  return <VisorPlanos datos={datos} inicial={inicial} hojas={hojas.map((h) => ({ ...h, url: h.imagen ? urls[h.imagen] ?? null : null }))} />;
}
