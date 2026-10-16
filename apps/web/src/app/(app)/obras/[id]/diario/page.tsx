import { BotonesDocumento } from "@/components/BotonesDocumento";
import { SelectorMes } from "@/components/SelectorMes";
import { finDeMes, hoyISO, meses, nombreMes } from "@/lib/calculo";
import { cargarObra } from "@/lib/datos";
import { supabaseServidor } from "@/lib/supabase/server";
import type { Diario } from "@/lib/tipos";
import { EditorDiario } from "./EditorDiario";
import { ListaDiario } from "./ListaDiario";

export const metadata = { title: "Diario de obra" };

export default async function PaginaDiario({ params, searchParams }: PageProps<"/obras/[id]/diario">) {
  const { id } = await params;
  const { mes: mesParam } = await searchParams;
  const obra = await cargarObra(id);
  const hoy = hoyISO();
  const mes = typeof mesParam === "string" && /^\d{4}-\d{2}$/.test(mesParam) ? mesParam : hoy.slice(0, 7);
  const sb = await supabaseServidor();
  const [{ data }, { data: primera }] = await Promise.all([
    sb.from("diario").select("id,obra_id,fecha,texto,texto_original,meteo,personal,created_at,updated_at")
      .eq("obra_id", id).gte("fecha", `${mes}-01`).lte("fecha", finDeMes(mes))
      .order("fecha", { ascending: false }).order("created_at", { ascending: false }),
    sb.from("diario").select("fecha").eq("obra_id", id).order("fecha").limit(1).maybeSingle(),
  ]);
  const desde = [obra.fecha_inicio, primera?.fecha, hoy].filter(Boolean).sort()[0] as string;
  const opciones = meses(desde, hoy).reverse();
  return (
    <main className="w-full max-w-4xl mx-auto p-4 md:p-6 grid gap-4">
      <div className="no-print flex flex-wrap items-center gap-3">
        <SelectorMes valor={mes} opciones={opciones} />
        <div className="ml-auto"><BotonesDocumento /></div>
      </div>
      <div className="no-print">
        <EditorDiario obraId={id} />
      </div>
      <article className="card card-pad grid gap-4">
        <header className="border-b border-[var(--line)] pb-3">
          <p className="eyebrow">Diario de obra</p>
          <h1 className="text-2xl">{nombreMes(mes, true)}</h1>
          <p className="muted text-sm">{obra.nombre}{obra.direccion ? ` · ${obra.direccion}` : ""}</p>
        </header>
        <ListaDiario obraId={id} entradas={(data ?? []) as Diario[]} />
      </article>
    </main>
  );
}
