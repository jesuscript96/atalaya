"use client";
import { useState, useTransition } from "react";
import type { Ajustes, Ambito, DatosObra, Fase, Hoja, Magnitud, Trabajo } from "@/lib/tipos";
import { actualizarObra, borrarObra, guardarAjustes } from "../../../acciones";
import { borrarTrabajo, guardarEncuadre, guardarPlanificacion, guardarTrabajo, revincular } from "./acciones";

const MAGNITUDES: [Magnitud, string][] = [
  ["superficie_pared", "Longitud × altura (m²)"],
  ["longitud", "Longitud (m)"],
  ["superficie", "Superficie (m²)"],
  ["perimetro", "Perímetro (m)"],
  ["perimetro_altura", "Perímetro × altura (m²)"],
  ["unidad", "Unidades"],
];
const AMBITOS: [Ambito, string][] = [
  ["todas", "Todos los elementos del tipo"],
  ["humedas", "Solo zonas húmedas (baños, lavaderos…)"],
  ["banos", "Solo baños y aseos"],
  ["cocinas", "Solo cocinas"],
  ["viviendas", "Una por vivienda (no zonas comunes)"],
  ["comunes", "Solo zonas comunes"],
];

export function Configuracion({ datos, hojas }: { datos: DatosObra; hojas: Hoja[] }) {
  const o = datos.obra;
  return (
    <main className="w-full max-w-5xl mx-auto p-4 md:p-6 grid gap-5">
      <section className="card card-pad grid gap-3">
        <h2>Datos de la obra</h2>
        <form action={actualizarObra.bind(null, o.id)} className="grid sm:grid-cols-2 gap-3">
          <label className="campo">Nombre<input className="input" name="nombre" defaultValue={o.nombre} required /></label>
          <label className="campo">Cliente<input className="input" name="cliente" defaultValue={o.cliente ?? ""} /></label>
          <label className="campo sm:col-span-2">Dirección<input className="input" name="direccion" defaultValue={o.direccion ?? ""} /></label>
          <label className="campo">Inicio<input className="input" type="date" name="fecha_inicio" defaultValue={o.fecha_inicio ?? ""} /></label>
          <label className="campo">Fin previsto<input className="input" type="date" name="fecha_fin" defaultValue={o.fecha_fin ?? ""} /></label>
          <div className="sm:col-span-2 flex justify-between">
            <button type="button" className="btn btn-danger" onClick={() => {
              const n = prompt(`Para borrar la obra con todos sus datos escribe su nombre: ${o.nombre}`);
              if (n === o.nombre) borrarObra(o.id);
            }}>Borrar obra</button>
            <button className="btn btn-primary">Guardar</button>
          </div>
        </form>
      </section>

      <AjustesObra obraId={o.id} inicial={o.ajustes} />
      <Planificacion datos={datos} />
      <Vinculos datos={datos} />
      <Hojas obraId={o.id} hojas={hojas} />
    </main>
  );
}

function AjustesObra({ obraId, inicial }: { obraId: string; inicial: Ajustes }) {
  const [a, setA] = useState<Ajustes>({ criterio: "porcentaje", coeficiente_contratista: 1, ...inicial });
  const [estado, setEstado] = useState("");
  const [pend, start] = useTransition();
  const campo = (k: "gg" | "bi" | "iva" | "retencion", t: string) => (
    <div className="flex items-center gap-2">
      <input type="checkbox" className="size-5" checked={a.aplicar[k]} onChange={(e) => setA({ ...a, aplicar: { ...a.aplicar, [k]: e.target.checked } })} aria-label={`Aplicar ${t}`} />
      <span className="flex-1">{t}</span>
      <input className="input !w-20 text-right" type="number" step="0.5" value={+(a[k] * 100).toFixed(2)} onChange={(e) => setA({ ...a, [k]: Number(e.target.value) / 100 })} />
      <span className="muted">%</span>
    </div>
  );
  return (
    <section className="card card-pad grid gap-3">
      <h2>Certificaciones</h2>
      <div className="grid md:grid-cols-2 gap-6">
        <div className="grid gap-2 text-sm">
          <p className="muted">Conceptos y porcentajes por defecto (se pueden cambiar en cada certificación).</p>
          {campo("gg", "Gastos generales")}
          {campo("bi", "Beneficio industrial")}
          {campo("iva", "IVA")}
          {campo("retencion", "Retención")}
        </div>
        <div className="grid gap-3 text-sm content-start">
          <fieldset className="grid gap-2">
            <legend className="font-semibold mb-1">Qué se certifica de lo medido en plano</legend>
            <label className="flex gap-2 items-start"><input type="radio" className="size-5" checked={a.criterio !== "medicion"} onChange={() => setA({ ...a, criterio: "porcentaje" })} />
              <span><b>El % ejecutado</b> aplicado a la medición del presupuesto (recomendado: el presupuesto rige).</span></label>
            <label className="flex gap-2 items-start"><input type="radio" className="size-5" checked={a.criterio === "medicion"} onChange={() => setA({ ...a, criterio: "medicion" })} />
              <span><b>La cantidad medida</b> en plano de lo ejecutado.</span></label>
          </fieldset>
          <label className="flex items-center gap-2">Coeficiente al contratista
            <input className="input !w-24 text-right" type="number" step="0.01" value={a.coeficiente_contratista ?? 1} onChange={(e) => setA({ ...a, coeficiente_contratista: Number(e.target.value) || 1 })} />
          </label>
        </div>
      </div>
      <div className="flex justify-end items-center gap-3">
        {estado && <span className="chip chip-ok">{estado}</span>}
        <button className="btn btn-primary" disabled={pend} onClick={() => start(async () => { await guardarAjustes(obraId, a); setEstado("Guardado"); })}>Guardar</button>
      </div>
    </section>
  );
}

function Planificacion({ datos }: { datos: DatosObra }) {
  const plan = new Map(datos.planificacion.map((p) => [p.capitulo_id, p]));
  const [, start] = useTransition();
  const [aviso, setAviso] = useState("");

  function cambiar(capId: string, campo: "inicio" | "fin", valor: string, otro: HTMLInputElement | null) {
    const ini = campo === "inicio" ? valor : otro?.value ?? "";
    const fin = campo === "fin" ? valor : otro?.value ?? "";
    if ((ini && fin && ini <= fin) || (!ini && !fin)) start(() => guardarPlanificacion(datos.obra.id, capId, ini || null, fin || null));
  }

  async function importar(f: File) {
    const ExcelJS = (await import("exceljs")).default;
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(await f.arrayBuffer());
    const norm = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
    let n = 0;
    for (const ws of libro.worksheets) {
      ws.eachRow((row) => {
        const vals = (row.values as unknown[]).slice(1);
        const textos = vals.filter((v): v is string => typeof v === "string").map(norm);
        const fechas = vals.filter((v): v is Date => v instanceof Date).map((d) => d.toISOString().slice(0, 10));
        if (fechas.length < 2) return;
        const cap = datos.capitulos.find((c) => textos.some((t) => t === norm(c.codigo) || t.includes(norm(c.nombre))));
        if (!cap) return;
        const [ini, fin] = [fechas[0], fechas[1]].sort();
        start(() => guardarPlanificacion(datos.obra.id, cap.id, ini, fin));
        n++;
      });
    }
    setAviso(n ? `${n} capítulos con fechas importadas` : "No se encontraron filas con capítulo y dos fechas");
  }

  return (
    <section className="card card-pad grid gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="mr-auto">Planificación por capítulo</h2>
        {aviso && <span className="chip chip-accent">{aviso}</span>}
        <label className="btn btn-sm cursor-pointer">Importar Excel
          <input type="file" accept=".xlsx" className="sr-only" onChange={(e) => e.target.files?.[0] && importar(e.target.files[0])} />
        </label>
      </div>
      <p className="muted text-sm">Sirve para la curva prevista y el cronograma. Sin fechas, el capítulo se reparte en todo el plazo de la obra. Desde MS Project: exporta a Excel las tareas resumen con su inicio y fin.</p>
      {datos.capitulos.length === 0 ? <p className="muted">Sube el presupuesto primero.</p> : (
        <table className="tabla">
          <thead><tr><th>Capítulo</th><th>Inicio</th><th>Fin</th></tr></thead>
          <tbody>
            {datos.capitulos.map((c) => {
              const p = plan.get(c.id);
              return (
                <tr key={c.id}>
                  <td>{c.codigo} {c.nombre}</td>
                  <td><input className="input !min-h-9" type="date" defaultValue={p?.inicio ?? ""} id={`ini-${c.id}`}
                             onChange={(e) => cambiar(c.id, "inicio", e.target.value, document.getElementById(`fin-${c.id}`) as HTMLInputElement)} /></td>
                  <td><input className="input !min-h-9" type="date" defaultValue={p?.fin ?? ""} id={`fin-${c.id}`}
                             onChange={(e) => cambiar(c.id, "fin", e.target.value, document.getElementById(`ini-${c.id}`) as HTMLInputElement)} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

type FaseEd = Omit<Fase, "id" | "trabajo_id"> & { id?: string };

function Vinculos({ datos }: { datos: DatosObra }) {
  const [nuevo, setNuevo] = useState(false);
  const [aviso, setAviso] = useState("");
  const [pend, start] = useTransition();
  const vinculadas = new Set(datos.trabajos.flatMap((t) => [t.partida_id, t.partida_humeda_id]).filter(Boolean));
  const sueltas = datos.partidas.filter((p) => !vinculadas.has(p.id));
  return (
    <section className="card card-pad grid gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="mr-auto">Vínculos plano ↔ presupuesto</h2>
        {aviso && <span className="chip chip-ok">{aviso}</span>}
        <button className="btn btn-sm" disabled={pend} onClick={() => start(async () => {
          try { const r = await revincular(datos.obra.id); setAviso(r.trabajos ? `${r.trabajos} vínculos nuevos` : "No hay vínculos nuevos que proponer"); }
          catch (e) { setAviso((e as Error).message); }
        })}>Proponer automáticamente</button>
        <button className="btn btn-sm btn-primary" onClick={() => setNuevo(true)} disabled={!datos.tipos.length}>Añadir trabajo</button>
      </div>
      <p className="muted text-sm">Cada trabajo dice qué elementos del plano miden una partida, cómo se mide y en qué fases se reparte su importe. Las partidas sin vínculo avanzan a mano en Presupuesto.</p>
      {nuevo && <EditorTrabajo datos={datos} onCerrar={() => setNuevo(false)} />}
      {datos.trabajos.slice().sort((a, b) => a.orden - b.orden).map((t) => <EditorTrabajo key={t.id} datos={datos} trabajo={t} />)}
      {sueltas.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer font-semibold">{sueltas.length} partidas con avance manual</summary>
          <p className="muted mt-1">{sueltas.map((p) => `${p.codigo} ${p.resumen}`).join(" · ")}</p>
        </details>
      )}
    </section>
  );
}

function EditorTrabajo({ datos, trabajo, onCerrar }: { datos: DatosObra; trabajo?: Trabajo; onCerrar?: () => void }) {
  const [t, setT] = useState<Omit<Trabajo, "id"> & { id?: string }>(trabajo ?? {
    tipo_id: datos.tipos[0]?.id ?? "", partida_id: null, partida_humeda_id: null, nombre: "Nuevo trabajo",
    magnitud: "superficie_pared", factor: 1, ambito: "todas", filtro: null, orden: 100,
  });
  const [fases, setFases] = useState<FaseEd[]>(
    trabajo ? datos.fases.filter((f) => f.trabajo_id === trabajo.id).sort((a, b) => a.orden - b.orden) : [{ nombre: "Ejecución", peso: 1, orden: 0 }],
  );
  const [abierto, setAbierto] = useState(!trabajo);
  const [error, setError] = useState("");
  const [pend, start] = useTransition();
  const tipo = datos.tipos.find((x) => x.id === t.tipo_id);
  const partida = datos.partidas.find((p) => p.id === t.partida_id);
  const suma = fases.reduce((s, f) => s + Number(f.peso), 0);
  const opcionesPartida = datos.partidas.map((p) => <option key={p.id} value={p.id}>{p.codigo} · {p.resumen.slice(0, 70)}</option>);

  if (!abierto) {
    return (
      <button className="text-left border border-[var(--line)] rounded-md px-3 py-2 hover:border-[var(--accent)] flex flex-wrap gap-x-3 gap-y-1 items-center" onClick={() => setAbierto(true)}>
        <span className="chip" style={{ background: tipo?.color + "33" }}>{tipo?.clave}</span>
        <b>{t.nombre}</b>
        <span className="muted text-sm">{partida ? `${partida.codigo} ${partida.resumen.slice(0, 50)}` : "sin partida"}{t.partida_humeda_id ? " · con variante H" : ""}{t.ambito !== "todas" ? ` · ${AMBITOS.find((a) => a[0] === t.ambito)?.[1].toLowerCase()}` : ""}{t.filtro ? ` · «${t.filtro}»` : ""}</span>
        <span className="muted text-sm ml-auto">{fases.map((f) => `${f.nombre} ${Math.round(f.peso * 100)}%`).join(" · ")}</span>
      </button>
    );
  }

  function guardar() {
    setError("");
    if (Math.abs(suma - 1) > 0.001) { setError("Los pesos de las fases deben sumar 100 %"); return; }
    start(async () => {
      try {
        await guardarTrabajo(datos.obra.id, t, fases);
        if (trabajo) setAbierto(false); else onCerrar?.();
      } catch (e) { setError((e as Error).message); }
    });
  }

  return (
    <div className="border border-[var(--accent)] rounded-md p-3 grid gap-3 bg-white">
      <div className="grid sm:grid-cols-3 gap-3">
        <label className="campo">Elementos del plano
          <select className="select" value={t.tipo_id} onChange={(e) => setT({ ...t, tipo_id: e.target.value })}>
            {datos.tipos.map((x) => <option key={x.id} value={x.id}>{x.clave} · {x.nombre}</option>)}
          </select>
        </label>
        <label className="campo">Nombre<input className="input" value={t.nombre} onChange={(e) => setT({ ...t, nombre: e.target.value })} /></label>
        <label className="campo">Se mide por
          <select className="select" value={t.magnitud} onChange={(e) => setT({ ...t, magnitud: e.target.value as Magnitud })}>
            {MAGNITUDES.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
          </select>
        </label>
        <label className="campo sm:col-span-2">Partida
          <select className="select" value={t.partida_id ?? ""} onChange={(e) => setT({ ...t, partida_id: e.target.value || null })}>
            <option value="">—</option>{opcionesPartida}
          </select>
        </label>
        <label className="campo">Factor (caras…)<input className="input" type="number" step="0.05" value={t.factor} onChange={(e) => setT({ ...t, factor: Number(e.target.value) || 1 })} /></label>
        <label className="campo sm:col-span-2">Partida en zonas húmedas (opcional)
          <select className="select" value={t.partida_humeda_id ?? ""} onChange={(e) => setT({ ...t, partida_humeda_id: e.target.value || null })}>
            <option value="">— la misma —</option>{opcionesPartida}
          </select>
        </label>
        <label className="campo">Ámbito
          <select className="select" value={t.ambito} onChange={(e) => setT({ ...t, ambito: e.target.value as Ambito })}>
            {AMBITOS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
          </select>
        </label>
        <label className="campo sm:col-span-2">Filtro por etiqueta (opcional; p. ej. «72» para puertas de 72)
          <input className="input" value={t.filtro ?? ""} onChange={(e) => setT({ ...t, filtro: e.target.value || null })} />
        </label>
        <p className="muted text-xs sm:col-span-1 self-end">{t.magnitud === "unidad" ? "Con «Unidades», el factor es cuántas ud del presupuesto corresponden a cada elemento (p. ej. 2 inodoros por baño)." : "El factor multiplica la cantidad medida (2 caras de pintura, desperdicio…)."}</p>
      </div>
      <div className="grid gap-1.5">
        <span className="text-sm font-semibold">Fases <span className={`chip ${Math.abs(suma - 1) > 0.001 ? "chip-late" : "chip-ok"}`}>{Math.round(suma * 100)} %</span></span>
        {fases.map((f, i) => (
          <div key={f.id ?? `n${i}`} className="flex gap-2 items-center">
            <span className="muted w-5 text-right">{i + 1}</span>
            <input className="input" value={f.nombre} onChange={(e) => setFases(fases.map((x, j) => (j === i ? { ...x, nombre: e.target.value } : x)))} />
            <input className="input !w-20 text-right" type="number" step="5" value={Math.round(f.peso * 1000) / 10} onChange={(e) => setFases(fases.map((x, j) => (j === i ? { ...x, peso: Number(e.target.value) / 100 } : x)))} />
            <span className="muted">%</span>
            <button className="btn btn-sm" disabled={i === 0} onClick={() => setFases(fases.map((x, j) => (j === i - 1 ? fases[i] : j === i ? fases[i - 1] : x)))} aria-label="Subir">↑</button>
            <button className="btn btn-sm btn-danger" disabled={fases.length === 1} onClick={() => {
              if (!f.id || confirm(`¿Quitar la fase «${f.nombre}»? Se borrarán sus avances.`)) setFases(fases.filter((_, j) => j !== i));
            }} aria-label="Quitar">✕</button>
          </div>
        ))}
        <button className="btn btn-sm self-start" onClick={() => setFases([...fases, { nombre: "Nueva fase", peso: 0, orden: fases.length }])}>Añadir fase</button>
      </div>
      {error && <p className="chip chip-late">{error}</p>}
      <div className="flex justify-between">
        {trabajo ? (
          <button className="btn btn-danger" onClick={() => confirm(`¿Borrar el trabajo «${t.nombre}» y todos sus avances?`) && start(() => borrarTrabajo(datos.obra.id, trabajo.id))}>Borrar</button>
        ) : <span />}
        <div className="flex gap-2">
          <button className="btn" onClick={() => (trabajo ? setAbierto(false) : onCerrar?.())}>Cancelar</button>
          <button className="btn btn-primary" disabled={pend} onClick={guardar}>Guardar</button>
        </div>
      </div>
    </div>
  );
}

function Hojas({ obraId, hojas }: { obraId: string; hojas: Hoja[] }) {
  const [, start] = useTransition();
  if (!hojas.length) return null;
  return (
    <section className="card card-pad grid gap-3">
      <h2>Hojas de los planos</h2>
      <p className="muted text-sm">Las hojas de <b>planta</b> comparten encuadre y muestran los elementos medidos. Las de <b>encuadre propio</b> (alzados, secciones, situación) solo muestran lo que se dibuje en ellas.</p>
      <table className="tabla">
        <thead><tr><th>Hoja</th><th>Disciplina</th><th>Escala</th><th>Encuadre</th></tr></thead>
        <tbody>
          {hojas.map((h) => (
            <tr key={h.id}>
              <td>{h.pagina}. {h.titulo}</td>
              <td className="capitalize">{h.disciplina.replace("_", " ")}</td>
              <td className="num">{h.escala ? `1:${h.escala}` : "—"}</td>
              <td>
                <select className="select !min-h-9 !w-auto" defaultValue={h.encuadre} onChange={(e) => start(() => guardarEncuadre(obraId, h.id, e.target.value as Hoja["encuadre"]))}>
                  <option value="planta">Planta</option>
                  <option value="propio">Propio</option>
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
