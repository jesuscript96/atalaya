import Link from "next/link";
import { supabaseServidor } from "@/lib/supabase/server";
import type { Diario } from "@/lib/tipos";
import { EditorDiario } from "./EditorDiario";

export const fechaCorta = (f: string) => new Date(`${f}T00:00:00`).toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" });

/** Cuadro del Panel: anotación de hoy y las últimas entradas. */
export async function DiarioPanel({ obraId }: { obraId: string }) {
  const sb = await supabaseServidor();
  const { data } = await sb.from("diario").select("id,obra_id,fecha,texto,texto_original,meteo,personal,created_at,updated_at")
    .eq("obra_id", obraId).order("fecha", { ascending: false }).order("created_at", { ascending: false }).limit(7);
  const entradas = (data ?? []) as Diario[];
  return (
    <section className="card card-pad grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2>Diario de obra</h2>
        <Link href={`/obras/${obraId}/diario`} className="text-sm underline">Ver todo el diario →</Link>
      </div>
      <EditorDiario obraId={obraId} compacto />
      {entradas.length > 0 && (
        <ul className="grid gap-2 border-t border-[var(--line)] pt-3">
          {entradas.map((e) => (
            <li key={e.id} className="text-sm grid gap-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <b>{fechaCorta(e.fecha)}</b>
                {e.meteo && <span className="chip">{e.meteo}</span>}
                {e.personal != null && <span className="chip">{e.personal} personas</span>}
              </div>
              <p className="whitespace-pre-line">{e.texto.length > 300 ? `${e.texto.slice(0, 300)}…` : e.texto}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
