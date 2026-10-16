import { cargarObra } from "@/lib/datos";
import { supabaseServidor } from "@/lib/supabase/server";
import type { Foto } from "@/lib/tipos";
import { Galeria } from "./Galeria";

export const metadata = { title: "Fotos de obra" };

export default async function PaginaFotos({ params, searchParams }: PageProps<"/obras/[id]/fotos">) {
  const { id } = await params;
  const sp = await searchParams;
  await cargarObra(id);
  const sb = await supabaseServidor();
  const [{ data: fotosDb }, { data: viviendasDb }, { data: tipoEst }] = await Promise.all([
    sb.from("fotos").select("id,obra_id,ruta,miniatura,fecha,vivienda,estancia,nota,ancho,alto,created_at").eq("obra_id", id)
      .order("fecha", { ascending: false }).order("created_at", { ascending: false }).limit(500),
    sb.from("viviendas").select("codigo").eq("obra_id", id).order("codigo"),
    sb.from("tipos_elemento").select("id").eq("obra_id", id).eq("clave", "EST").maybeSingle(),
  ]);
  const { data: estanciasDb } = tipoEst
    ? await sb.from("elementos").select("vivienda,etiqueta").eq("obra_id", id).eq("tipo_id", tipoEst.id).not("etiqueta", "is", null)
    : { data: [] as { vivienda: string | null; etiqueta: string | null }[] };
  const fotos = (fotosDb ?? []) as Foto[];
  const rutas = fotos.map((f) => f.miniatura ?? f.ruta);
  const { data: firmadas } = rutas.length ? await sb.storage.from("obras").createSignedUrls(rutas, 3600) : { data: [] };
  const urls = new Map((firmadas ?? []).map((f) => [f.path, f.signedUrl]));
  const estancias = [...new Set((estanciasDb ?? []).filter((e) => e.vivienda && e.etiqueta).map((e) => `${e.vivienda}|${e.etiqueta}`))]
    .sort().map((k) => { const [vivienda, etiqueta] = k.split("|"); return { vivienda, etiqueta }; });
  const viviendas = [...new Set([...(viviendasDb ?? []).map((v) => v.codigo), ...estancias.map((e) => e.vivienda), "COMUN"])].sort();
  return (
    <Galeria
      obraId={id}
      fotos={fotos.map((f) => ({ ...f, url: urls.get(f.miniatura ?? f.ruta) ?? null }))}
      viviendas={viviendas}
      estancias={estancias}
      inicial={{ vivienda: typeof sp.vivienda === "string" ? sp.vivienda : "", estancia: typeof sp.estancia === "string" ? sp.estancia : "" }}
    />
  );
}
