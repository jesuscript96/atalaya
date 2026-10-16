import Link from "next/link";
import { CurvaAvance } from "@/components/CurvaAvance";
import { cargarDatos } from "@/lib/datos";
import { DiarioPanel } from "./diario/DiarioPanel";
import { curva, eur, hoyISO, plazoConsumido, porCapitulo, pct, previstoA, resumenPartidas, totales } from "@/lib/calculo";

export const metadata = { title: "Panel" };

export default async function Panel({ params }: PageProps<"/obras/[id]">) {
  const { id } = await params;
  const d = await cargarDatos(id);
  if (!d.partidas.length) {
    return (
      <main className="p-6 max-w-xl mx-auto w-full">
        <div className="card card-pad text-center py-12">
          <h2>Empieza por los documentos</h2>
          <p className="muted mt-1">Sube los planos y el presupuesto en <Link className="underline" href={`/obras/${id}/documentos`}>Documentos</Link>: la app medirá el plano y enlazará cada elemento con su partida.</p>
        </div>
      </main>
    );
  }
  const res = resumenPartidas(d);
  const t = totales(res);
  const plazo = plazoConsumido(d.obra.fecha_inicio, d.obra.fecha_fin);
  const previsto = t.presupuesto ? previstoA(d, res, hoyISO()) / t.presupuesto : null;
  const desv = previsto == null ? null : t.porcentaje - previsto;
  const caps = porCapitulo(d, res);
  const puntos = curva(d);
  const ultimas = [...d.avances].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 1)[0];

  return (
    <main className="w-full max-w-7xl mx-auto p-4 md:p-6 grid gap-4">
      <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Kpi t="Presupuesto (PEM)" v={eur(t.presupuesto, false)} />
        <Kpi t="Ejecutado a origen" v={eur(t.ejecutado, false)} />
        <Kpi t="Avance real" v={pct(t.porcentaje, 1)} barra={t.porcentaje} />
        <Kpi t="Plazo consumido" v={pct(plazo)} barra={plazo ?? 0} sub={d.obra.fecha_fin ? `Fin ${new Date(d.obra.fecha_fin).toLocaleDateString("es-ES")}` : "Sin fechas"} />
        <Kpi t="Frente a lo previsto" v={desv == null ? "—" : `${desv >= 0 ? "+" : ""}${pct(desv, 1)}`}
             tono={desv == null ? "" : desv >= -0.02 ? "chip-ok" : desv >= -0.08 ? "chip-progress" : "chip-late"}
             sub={previsto == null ? "" : `Previsto hoy ${pct(previsto, 1)}`} />
      </section>

      <section className="grid lg:grid-cols-[1.4fr_1fr] gap-4">
        <div className="card card-pad">
          <h2>Curva de avance</h2>
          <p className="muted text-sm">Importe ejecutado a origen sobre el presupuesto, a final de cada mes.</p>
          <CurvaAvance puntos={puntos} />
        </div>
        <div className="card card-pad">
          <h2>Avance por capítulo</h2>
          <table className="tabla mt-2">
            <tbody>
              {caps.map((c) => (
                <tr key={c.capitulo.id}>
                  <td className="w-full">
                    <div className="flex justify-between gap-2"><span>{c.capitulo.codigo} {c.capitulo.nombre}</span><b className="num">{pct(c.porcentaje)}</b></div>
                    <div className="barra mt-1"><i style={{ width: `${Math.min(100, c.porcentaje * 100)}%`, background: c.porcentaje >= 1 ? "var(--ok)" : undefined }} /></div>
                  </td>
                  <td className="num muted">{eur(c.presupuesto, false)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <DiarioPanel obraId={id} />
      {ultimas && <p className="muted text-sm">Última marca en plano: {new Date(ultimas.created_at).toLocaleString("es-ES")}</p>}
    </main>
  );
}

function Kpi({ t, v, sub, barra, tono }: { t: string; v: string; sub?: string; barra?: number; tono?: string }) {
  return (
    <div className="card card-pad kpi">
      <span className="eyebrow">{t}</span>
      <b className={tono ? `chip ${tono} !text-[1.4rem] !px-2 self-start` : ""}>{v}</b>
      {barra != null && <div className="barra mt-2"><i style={{ width: `${Math.min(100, barra * 100)}%` }} /></div>}
      {sub && <span className="muted text-xs mt-1">{sub}</span>}
    </div>
  );
}
