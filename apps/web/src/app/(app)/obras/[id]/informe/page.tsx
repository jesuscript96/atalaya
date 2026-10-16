import { BotonesDocumento } from "@/components/BotonesDocumento";
import { CurvaAvance } from "@/components/CurvaAvance";
import { SelectorMes } from "@/components/SelectorMes";
import { cargarDatos } from "@/lib/datos";
import { supabaseServidor } from "@/lib/supabase/server";
import type { Diario } from "@/lib/tipos";
import {
  cantidad, curva, estadoAvances, eur, finDeMes, hoyISO, meses, nombreMes, num, pct, plazoConsumido, porCapitulo, previstoA,
  resumenPartidas, totales,
} from "@/lib/calculo";
import type { DatosObra } from "@/lib/tipos";

export const metadata = { title: "Informe mensual" };

const mesPrevio = (p: string) => {
  const [a, m] = p.split("-").map(Number);
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, "0")}`;
};

export default async function Informe({ params, searchParams }: PageProps<"/obras/[id]/informe">) {
  const { id } = await params;
  const { mes: mesParam } = await searchParams;
  const d = await cargarDatos(id);
  const hoy = hoyISO();
  const mes = typeof mesParam === "string" && /^\d{4}-\d{2}$/.test(mesParam) ? mesParam : hoy.slice(0, 7);
  const corte = finDeMes(mes) < hoy ? finDeMes(mes) : hoy;
  const corteAnt = finDeMes(mesPrevio(mes));
  const fin = resumenPartidas(d, corte), ini = resumenPartidas(d, corteAnt);
  const tFin = totales(fin), tIni = totales(ini);
  const plazo = plazoConsumido(d.obra.fecha_inicio, d.obra.fecha_fin, corte);
  const previsto = tFin.presupuesto ? previstoA(d, fin, corte) / tFin.presupuesto : null;
  const caps = porCapitulo(d, fin);
  const capsIni = new Map(porCapitulo(d, ini).map((c) => [c.capitulo.id, c]));
  const filas = d.partidas
    .map((p) => ({ p, f: fin.get(p.id)!, i: ini.get(p.id)! }))
    .filter((x) => x.f.cantidad > 1e-6);
  const delMes = filas.filter((x) => x.f.cantidad - x.i.cantidad > 1e-6);
  const tareas = trabajosDelMes(d, corteAnt, corte);
  const opciones = d.obra.fecha_inicio ? meses(d.obra.fecha_inicio, hoy).reverse() : [hoy.slice(0, 7)];
  const sb = await supabaseServidor();
  const { data: diarioDb } = await sb.from("diario").select("id,obra_id,fecha,texto,texto_original,meteo,personal,created_at,updated_at")
    .eq("obra_id", id).gte("fecha", `${mes}-01`).lte("fecha", corte).order("fecha").order("created_at");
  const diario = (diarioDb ?? []) as Diario[];

  return (
    <main className="w-full max-w-5xl mx-auto p-4 md:p-6 grid gap-4">
      <div className="no-print flex flex-wrap items-center gap-3">
        <SelectorMes valor={mes} opciones={opciones} />
        <div className="ml-auto"><BotonesDocumento /></div>
      </div>

      <article className="card card-pad grid gap-6">
        <header className="flex flex-wrap justify-between gap-4 border-b border-[var(--line)] pb-4">
          <div>
            <p className="eyebrow">Informe mensual de obra</p>
            <h1 className="text-2xl">{nombreMes(mes, true)}</h1>
            <p className="muted">Situación a {new Date(corte).toLocaleDateString("es-ES")}</p>
          </div>
          <div className="text-sm text-right">
            <p className="font-semibold">{d.obra.nombre}</p>
            {d.obra.direccion && <p>{d.obra.direccion}</p>}
            {d.obra.cliente && <p>Cliente: {d.obra.cliente}</p>}
          </div>
        </header>

        <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Dato t="Avance a origen" v={pct(tFin.porcentaje, 1)} s={eur(tFin.ejecutado, false)} />
          <Dato t="Avance del mes" v={`+${pct(tFin.porcentaje - tIni.porcentaje, 1)}`} s={eur(tFin.ejecutado - tIni.ejecutado, false)} />
          <Dato t="Previsto a la fecha" v={pct(previsto, 1)} s={previsto == null ? "" : `Desviación ${pct(tFin.porcentaje - previsto, 1)}`} />
          <Dato t="Plazo consumido" v={pct(plazo)} s={d.obra.fecha_fin ? `Fin previsto ${new Date(d.obra.fecha_fin).toLocaleDateString("es-ES")}` : ""} />
        </section>

        <section className="grid gap-2">
          <h2>Trabajos realizados en el mes</h2>
          {tareas.length === 0 && delMes.length === 0 ? <p className="muted">Sin avance registrado este mes.</p> : (
            <ul className="grid gap-1 text-sm list-disc pl-5">
              {tareas.map((t) => (
                <li key={t.clave}><b>{t.trabajo} · {t.fase}</b>: {num(t.cantidad)} {t.unidad} en {t.elementos} elementos{t.viviendas.length ? ` (${t.viviendas.join(", ")})` : ""}.</li>
              ))}
              {delMes.filter((x) => x.f.origen === "manual").map((x) => (
                <li key={x.p.id}><b>{x.p.resumen}</b>: {num(x.f.cantidad - x.i.cantidad)} {x.p.unidad}.</li>
              ))}
            </ul>
          )}
        </section>

        <section className="grid gap-2">
          <h2>Diario del mes</h2>
          {diario.length === 0 ? <p className="muted">Sin anotaciones en el diario este mes.</p> : (
            <div className="grid gap-2 text-sm">
              {diario.map((e) => (
                <div key={e.id} className="grid gap-0.5">
                  <b>{new Date(`${e.fecha}T00:00:00`).toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" })}{e.meteo ? ` · ${e.meteo}` : ""}{e.personal != null ? ` · ${e.personal} personas` : ""}</b>
                  <p className="whitespace-pre-line">{e.texto}</p>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="grid gap-2">
          <h2>Curva de avance</h2>
          <CurvaAvance puntos={curva(d)} alto={240} />
        </section>

        <section className="grid gap-2 print-break">
          <h2>Avance por capítulo</h2>
          <table className="tabla">
            <thead><tr><th>Capítulo</th><th className="text-right">Presupuesto</th><th className="text-right">Mes</th><th className="text-right">Origen</th><th className="w-40">%</th></tr></thead>
            <tbody>
              {caps.map((c) => (
                <tr key={c.capitulo.id}>
                  <td>{c.capitulo.codigo} {c.capitulo.nombre}</td>
                  <td className="num">{eur(c.presupuesto, false)}</td>
                  <td className="num">{eur(c.ejecutado - (capsIni.get(c.capitulo.id)?.ejecutado ?? 0), false)}</td>
                  <td className="num">{eur(c.ejecutado, false)}</td>
                  <td><div className="flex items-center gap-2"><div className="barra flex-1"><i style={{ width: `${Math.min(100, c.porcentaje * 100)}%` }} /></div><span className="num w-10">{num(c.porcentaje * 100, 0)}</span></div></td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td>Total</td><td className="num">{eur(tFin.presupuesto, false)}</td><td className="num">{eur(tFin.ejecutado - tIni.ejecutado, false)}</td><td className="num">{eur(tFin.ejecutado, false)}</td><td className="num">{pct(tFin.porcentaje, 1)}</td></tr></tfoot>
          </table>
        </section>

        <section className="grid gap-2">
          <h2>Cronograma</h2>
          <Cronograma d={d} caps={caps} corte={corte} />
        </section>

        <section className="grid gap-2 print-break">
          <h2>Avance por partida</h2>
          <table className="tabla !text-[0.8rem]">
            <thead><tr><th>Código</th><th>Partida</th><th className="text-right">Medición</th><th className="text-right">Ejecutado</th><th className="text-right">% mes</th><th className="text-right">% origen</th></tr></thead>
            <tbody>
              {filas.map(({ p, f, i }) => (
                <tr key={p.id}>
                  <td className="mono">{p.codigo}</td><td>{p.resumen}</td>
                  <td className="num">{num(p.medicion)} {p.unidad}</td><td className="num">{num(f.cantidad)}</td>
                  <td className="num">{pct(f.porcentaje - i.porcentaje)}</td><td className="num font-semibold">{pct(f.porcentaje)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="grid gap-2">
          <h2>Observaciones</h2>
          <textarea className="input min-h-28 print:border-0 print:p-0" placeholder="Incidencias, previsión para el mes siguiente… (se imprime con el informe)" />
        </section>
      </article>
    </main>
  );
}

function Dato({ t, v, s }: { t: string; v: string; s?: string }) {
  return (
    <div className="kpi border border-[var(--line)] rounded-md p-3">
      <span className="eyebrow">{t}</span><b className="!text-[1.4rem]">{v}</b>{s && <span className="muted text-xs">{s}</span>}
    </div>
  );
}

/** Lo que se avanzó en plano entre dos fechas, por trabajo y fase. */
function trabajosDelMes(d: DatosObra, desde: string, hasta: string) {
  const ini = estadoAvances(d.avances, desde), fin = estadoAvances(d.avances, hasta);
  const UNIDAD: Record<string, string> = { longitud: "m", superficie_pared: "m²", superficie: "m²", perimetro: "m", perimetro_altura: "m²", unidad: "ud" };
  const out: { clave: string; trabajo: string; fase: string; cantidad: number; unidad: string; elementos: number; viviendas: string[] }[] = [];
  for (const t of d.trabajos.slice().sort((a, b) => a.orden - b.orden)) {
    for (const f of d.fases.filter((x) => x.trabajo_id === t.id).sort((a, b) => a.orden - b.orden)) {
      let q = 0, n = 0;
      const viv = new Set<string>();
      for (const e of d.elementos) {
        const c = cantidad(e, t);
        if (c == null) continue;
        const k = `${e.id}|${f.id}`;
        const delta = (fin.get(k) ?? 0) - (ini.get(k) ?? 0);
        if (delta <= 0) continue;
        q += c * delta / 100;
        n++;
        if (e.vivienda) viv.add(e.vivienda);
      }
      if (n) out.push({ clave: f.id, trabajo: t.nombre, fase: f.nombre, cantidad: q, unidad: UNIDAD[t.magnitud], elementos: n, viviendas: [...viv].sort() });
    }
  }
  return out;
}

function Cronograma({ d, caps, corte }: { d: DatosObra; caps: ReturnType<typeof porCapitulo>; corte: string }) {
  const plan = new Map(d.planificacion.map((p) => [p.capitulo_id, p]));
  const filas = caps.map((c) => {
    const p = plan.get(c.capitulo.id);
    return { c, ini: p?.inicio ?? d.obra.fecha_inicio, fin: p?.fin ?? d.obra.fecha_fin, propio: !!p };
  }).filter((f) => f.ini && f.fin) as { c: (typeof caps)[number]; ini: string; fin: string; propio: boolean }[];
  if (!filas.length) return <p className="muted text-sm">Indica las fechas de la obra y de cada capítulo en Configuración.</p>;
  const t0 = Math.min(...filas.map((f) => Date.parse(f.ini))), t1 = Math.max(...filas.map((f) => Date.parse(f.fin)));
  const x = (s: string | number) => ((Number(typeof s === "string" ? Date.parse(s) : s) - t0) / (t1 - t0 || 1)) * 100;
  const ms = meses(new Date(t0).toISOString(), new Date(t1).toISOString());
  return (
    <div className="text-xs">
      <div className="relative h-5 ml-[34%] border-b border-[var(--line)]">
        {ms.map((m) => (
          <span key={m} className="absolute muted" style={{ left: `${Math.max(0, x(`${m}-01`))}%` }}>
            {new Date(`${m}-15T00:00:00Z`).toLocaleDateString("es-ES", { month: "short", timeZone: "UTC" })}
          </span>
        ))}
      </div>
      {filas.map(({ c, ini, fin, propio }) => (
        <div key={c.capitulo.id} className="flex items-center h-7 border-b border-[var(--line)]">
          <span className="w-[34%] pr-2 truncate">{c.capitulo.codigo} {c.capitulo.nombre}</span>
          <div className="relative flex-1 h-full">
            <div className="absolute top-1.5 h-4 rounded-sm overflow-hidden" title={`${ini} → ${fin}`}
                 style={{ left: `${x(ini)}%`, width: `${Math.max(0.8, x(fin) - x(ini))}%`, background: propio ? "var(--accent-soft)" : "var(--surface-2)" }}>
              <div className="h-full" style={{ width: `${Math.min(100, c.porcentaje * 100)}%`, background: c.porcentaje >= 1 ? "var(--ok)" : "var(--accent)" }} />
            </div>
            <div className="absolute inset-y-0 border-l-2 border-[var(--late)]" style={{ left: `${x(corte)}%` }} />
          </div>
        </div>
      ))}
      <p className="muted mt-2">Barra: plazo previsto del capítulo (gris si no tiene fechas propias); relleno: % ejecutado; línea roja: fecha del informe.</p>
    </div>
  );
}
