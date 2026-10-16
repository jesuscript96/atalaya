import Link from "next/link";
import { cargarDatos } from "@/lib/datos";
import { UNIDAD, cantidad, estadoAvances, matriz, num, partidaDe, pct } from "@/lib/calculo";

export const metadata = { title: "Interiores" };

function color(p: number) {
  if (p >= 0.999) return { background: "var(--ok)", color: "#fff" };
  if (p > 0) return { background: `color-mix(in srgb, var(--progress) ${Math.round(25 + p * 60)}%, white)`, color: "#3d2a00" };
  return { background: "var(--surface-2)", color: "var(--ink-3)" };
}

export default async function Interiores({ params, searchParams }: PageProps<"/obras/[id]/interiores">) {
  const { id } = await params;
  const { cap } = await searchParams;
  const d = await cargarDatos(id);
  const m = matriz(d);
  const tipos = new Map(d.tipos.map((t) => [t.id, t]));
  const partidas = new Map(d.partidas.map((p) => [p.id, p]));
  const capitulos = new Map(d.capitulos.map((c) => [c.id, c]));
  const capDe = (t: (typeof m.columnas)[number]["trabajo"]) => {
    const p = t.partida_id ? partidas.get(t.partida_id) : null;
    return p ? capitulos.get(p.capitulo_id) ?? null : null;
  };

  // columnas agrupadas por capítulo (en el orden del presupuesto) y, dentro, por trabajo
  type Col = (typeof m.columnas)[number];
  const porCap = new Map<string, { id: string; nombre: string; orden: number; trabajos: { trabajo: Col["trabajo"]; fases: Col["fase"][] }[] }>();
  const columnasOrdenadas = m.columnas.slice().sort((a, b) => (capDe(a.trabajo)?.orden ?? 999) - (capDe(b.trabajo)?.orden ?? 999) || a.trabajo.orden - b.trabajo.orden || a.trabajo.id.localeCompare(b.trabajo.id) || a.fase.orden - b.fase.orden);
  for (const c of columnasOrdenadas) {
    const capitulo = capDe(c.trabajo);
    const k = capitulo?.id ?? "-";
    const g = porCap.get(k) ?? { id: k, nombre: capitulo ? `${capitulo.codigo} ${capitulo.nombre}` : "Sin partida", orden: capitulo?.orden ?? 999, trabajos: [] };
    const ult = g.trabajos.at(-1);
    if (ult && ult.trabajo.id === c.trabajo.id) ult.fases.push(c.fase);
    else g.trabajos.push({ trabajo: c.trabajo, fases: [c.fase] });
    porCap.set(k, g);
  }
  const gruposTodos = [...porCap.values()];
  const grupos = cap ? gruposTodos.filter((g) => g.id === cap) : gruposTodos;

  // avance económico de cada vivienda (importe ejecutado / importe medido en ella)
  const estado = estadoAvances(d.avances);
  const precio = new Map(d.partidas.map((p) => [p.id, p.precio]));
  const porViv = new Map<string, { total: number; hecho: number }>();
  for (const t of d.trabajos) {
    const fases = d.fases.filter((f) => f.trabajo_id === t.id);
    const peso = fases.reduce((s, f) => s + f.peso, 0) || 1;
    for (const e of d.elementos) {
      const q = cantidad(e, t);
      const pid = partidaDe(e, t);
      if (!q || !e.vivienda || !pid) continue;
      const imp = q * (precio.get(pid) ?? 0);
      const fr = fases.reduce((s, f) => s + f.peso * (estado.get(`${e.id}|${f.id}`) ?? 0) / 100, 0) / peso;
      const a = porViv.get(e.vivienda) ?? { total: 0, hecho: 0 };
      a.total += imp;
      a.hecho += imp * fr;
      porViv.set(e.vivienda, a);
    }
  }

  if (!m.viviendas.length) {
    return <main className="p-6 max-w-xl mx-auto w-full"><div className="card card-pad text-center py-12"><h2>Sin viviendas</h2><p className="muted mt-1">Aparecerán al procesar los planos.</p></div></main>;
  }
  const nCols = grupos.reduce((s, g) => s + g.trabajos.reduce((x, t) => x + t.fases.length, 0), 0);
  return (
    <main className="w-full p-4 md:p-6 grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="mr-auto">Viviendas × partidas</h2>
        <nav className="seg flex-wrap">
          <Link href="?" className={`px-3 min-h-10 grid place-items-center font-semibold ${!cap ? "bg-[var(--accent)] text-white" : ""}`}>Todo</Link>
          {gruposTodos.map((g) => (
            <Link key={g.id} href={`?cap=${g.id}`} className={`px-3 min-h-10 grid place-items-center font-semibold border-l border-[var(--line)] ${cap === g.id ? "bg-[var(--accent)] text-white" : ""}`}>{g.nombre.split(" ")[0]}</Link>
          ))}
        </nav>
      </div>
      <div className="card overflow-auto max-h-[calc(100dvh-230px)]">
        <table className="tabla !text-[0.8rem]">
          <thead>
            <tr>
              <th rowSpan={3} className="sticky left-0 z-[2]">Vivienda</th>
              <th rowSpan={3} className="text-right">Avance</th>
              {grupos.map((g) => (
                <th key={g.id} colSpan={g.trabajos.reduce((s, t) => s + t.fases.length, 0)} className="text-center border-l-2 border-[var(--ink-3)] !bg-[#e4e9ec]">{g.nombre}</th>
              ))}
            </tr>
            <tr>
              {grupos.flatMap((g) => g.trabajos.map((t, i) => (
                <th key={t.trabajo.id} colSpan={t.fases.length} className={`!top-[33px] text-center ${i === 0 ? "border-l-2 border-[var(--ink-3)]" : "border-l border-[var(--line)]"}`} title={`${tipos.get(t.trabajo.tipo_id)?.nombre} · ${UNIDAD[t.trabajo.magnitud]}`}>
                  {t.trabajo.nombre}
                </th>
              )))}
            </tr>
            <tr>
              {grupos.flatMap((g) => g.trabajos.flatMap((t, i) => t.fases.map((f, j) => (
                <th key={f.id} className={`!top-[66px] font-medium text-center whitespace-nowrap ${j === 0 ? (i === 0 ? "border-l-2 border-[var(--ink-3)]" : "border-l border-[var(--line)]") : ""}`}>{t.fases.length > 1 ? f.nombre : "·"}</th>
              ))))}
            </tr>
          </thead>
          <tbody>
            {m.viviendas.map((v) => {
              const a = porViv.get(v);
              return (
                <tr key={v}>
                  <td className="sticky left-0 bg-[var(--surface)] font-semibold">{v}</td>
                  <td className="num font-semibold">{a ? pct(a.hecho / a.total) : "—"}</td>
                  {grupos.flatMap((g) => g.trabajos.flatMap((t, i) => t.fases.map((f, j) => {
                    const c = m.celdas.get(`${v}|${f.id}`);
                    const ud = t.trabajo.magnitud === "unidad";
                    return (
                      <td key={f.id} className={`!p-0.5 ${j === 0 ? (i === 0 ? "border-l-2 border-[var(--ink-3)]" : "border-l border-[var(--line)]") : ""}`}>
                        {c ? (
                          <Link href={`/obras/${id}/planos?vivienda=${encodeURIComponent(v)}&trabajo=${t.trabajo.id}&fase=${f.id}`}
                                title={`${v} · ${t.trabajo.nombre} · ${f.nombre}: ${pct(c.porcentaje)} de ${num(c.cantidad)} ${UNIDAD[t.trabajo.magnitud]}`}
                                className="grid place-items-center h-9 min-w-12 rounded font-mono font-medium" style={color(c.porcentaje)}>
                            {ud && c.porcentaje >= 0.999 ? "✓" : Math.round(c.porcentaje * 100)}
                          </Link>
                        ) : <span className="grid place-items-center h-9 muted">·</span>}
                      </td>
                    );
                  })))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted text-sm">% de cada fase en cada vivienda, ponderado por la cantidad medida ({nCols} columnas). Toca una celda para marcarla en el plano; las partidas por unidad se marcan en «Por vivienda».</p>
    </main>
  );
}
