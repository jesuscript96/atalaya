"use client";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import type { CellValueChangedEvent, ColDef } from "ag-grid-community";
import { Rejilla } from "@/components/Rejilla";
import { eur, finDeMes, hoyISO, lineasCertificacion, nombreMes, num, totalesCertificacion } from "@/lib/calculo";
import type { Ajustes, Certificacion, DatosObra, LineaCertificacion } from "@/lib/tipos";
import { cerrarCertificacion } from "./acciones";

type Dest = "cliente" | "contratista";
const mesAnterior = () => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
};
const DEF: Ajustes = { gg: 0.13, bi: 0.06, iva: 0.1, retencion: 0.05, aplicar: { gg: false, bi: false, iva: true, retencion: false } };

export function Certificaciones({ datos, certificaciones }: { datos: DatosObra; certificaciones: Certificacion[] }) {
  const base = datos.obra.ajustes ?? DEF;
  const [dest, setDest] = useState<Dest>("cliente");
  const previas = certificaciones.filter((c) => c.destinatario === dest);
  const ultima = previas.at(-1);
  const [periodo, setPeriodo] = useState(() => (hoyISO().slice(8) >= "25" ? hoyISO().slice(0, 7) : mesAnterior()));
  const [ajustes, setAjustes] = useState<Ajustes>(base);
  const [coef, setCoef] = useState(1);
  const [cambios, setCambios] = useState<Map<string, number>>(new Map());
  const [soloMov, setSoloMov] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, start] = useTransition();

  function cambiarDest(d: Dest) {
    setDest(d);
    setCoef(d === "contratista" ? Number(base.coeficiente_contratista ?? 1) : 1);
    setAjustes(d === "contratista" ? { ...base, aplicar: { gg: false, bi: false, iva: base.aplicar.iva, retencion: base.aplicar.retencion } } : base);
    setCambios(new Map());
  }

  const anteriores = ultima?.lineas ?? null;
  const calculadas = lineasCertificacion(datos, finDeMes(periodo), anteriores);
  const lineas = calculadas.map((l) => (cambios.has(l.partida_id) ? { ...l, origen: cambios.get(l.partida_id)! } : l));
  const tot = totalesCertificacion(lineas, ajustes, coef);
  const periodoValido = !ultima || periodo > ultima.periodo;
  const visibles = soloMov ? lineas.filter((l) => Math.abs(l.origen - l.anterior) > 1e-6 || cambios.has(l.partida_id)) : lineas;
  const capitulos = new Map(datos.capitulos.map((c) => [c.id, c]));

  const columnas = useMemo<ColDef<LineaCertificacion>[]>(() => [
    { field: "codigo", headerName: "Código", width: 88, pinned: "left" },
    { field: "resumen", headerName: "Resumen", flex: 1, minWidth: 240 },
    { field: "unidad", headerName: "Ud", width: 60 },
    { field: "precio", headerName: "Precio", width: 96, type: "rightAligned", valueFormatter: (p) => num(p.value) },
    { field: "anterior", headerName: "Anterior", width: 100, type: "rightAligned", valueFormatter: (p) => num(p.value) },
    {
      field: "origen", headerName: "A origen", width: 108, type: "rightAligned", editable: true, valueFormatter: (p) => num(p.value),
      valueParser: (p) => Number(String(p.newValue).replace(",", ".")), cellClass: "celda-editable",
      headerTooltip: "Cantidad a origen calculada a final de mes; se puede corregir antes de cerrar",
    },
    { colId: "periodo", headerName: "Este mes", width: 104, type: "rightAligned", valueGetter: (p) => (p.data ? p.data.origen - p.data.anterior : 0), valueFormatter: (p) => num(p.value) },
    { colId: "importe", headerName: "Importe mes", width: 124, type: "rightAligned", valueGetter: (p) => (p.data ? (p.data.origen - p.data.anterior) * p.data.precio * coef : 0), valueFormatter: (p) => eur(p.value) },
    { colId: "origenEur", headerName: "Importe origen", width: 128, type: "rightAligned", valueGetter: (p) => (p.data ? p.data.origen * p.data.precio * coef : 0), valueFormatter: (p) => eur(p.value) },
  ], [coef]);

  function editar(e: CellValueChangedEvent<LineaCertificacion>) {
    const v = Number(e.newValue);
    if (!Number.isFinite(v) || v < 0) return;
    setCambios((m) => new Map(m).set(e.data.partida_id, v));
  }

  function cerrar() {
    setError(null);
    if (!confirm(`¿Cerrar la certificación nº ${(ultima?.numero ?? 0) + 1} (${nombreMes(periodo)}) al ${dest}? Quedará guardada tal como está.`)) return;
    start(async () => {
      try {
        await cerrarCertificacion(datos.obra.id, { destinatario: dest, periodo, ajustes, lineas, coeficiente: coef });
      } catch (e) {
        if ((e as Error).message?.includes("NEXT_REDIRECT")) throw e;
        setError((e as Error).message);
      }
    });
  }

  const toggle = (k: keyof Ajustes["aplicar"]) => setAjustes((a) => ({ ...a, aplicar: { ...a.aplicar, [k]: !a.aplicar[k] } }));
  const porc = (k: "gg" | "bi" | "iva" | "retencion") => (
    <input className="input !w-16 !min-h-8 !py-0 text-right" type="number" step="0.5" value={+(ajustes[k] * 100).toFixed(2)}
           onChange={(e) => setAjustes((a) => ({ ...a, [k]: Number(e.target.value) / 100 }))} />
  );

  return (
    <main className="w-full max-w-7xl mx-auto p-4 md:p-6 grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="seg">
          {(["cliente", "contratista"] as Dest[]).map((d) => (
            <button key={d} className={dest === d ? "on" : ""} onClick={() => cambiarDest(d)}>{d === "cliente" ? "Al cliente" : "Al contratista"}</button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 ml-auto">
          {previas.map((c) => (
            <Link key={c.id} href={`/obras/${datos.obra.id}/certificaciones/${c.id}`} className="btn btn-sm">
              Nº {c.numero} · {nombreMes(c.periodo)} · {eur(c.totales.total, false)}
            </Link>
          ))}
        </div>
      </div>

      <section className="grid lg:grid-cols-[1fr_320px] gap-4 items-start">
        <div className="card flex flex-col min-h-[560px]">
          <div className="flex flex-wrap items-center gap-3 p-3 border-b border-[var(--line)]">
            <h2 className="mr-auto">Certificación nº {(ultima?.numero ?? 0) + 1}</h2>
            <label className="campo !flex-row items-center gap-2">Mes
              <input className="input !w-44" type="month" value={periodo} onChange={(e) => { setPeriodo(e.target.value); setCambios(new Map()); }} />
            </label>
            <label className="flex gap-2 items-center text-sm"><input type="checkbox" className="size-5" checked={soloMov} onChange={(e) => setSoloMov(e.target.checked)} /> Solo partidas con movimiento</label>
          </div>
          {!periodoValido && <p className="chip chip-late m-3">Ya hay una certificación de {nombreMes(ultima!.periodo)}: elige un mes posterior.</p>}
          <div className="flex-1 relative min-h-[460px]">
            <Rejilla<LineaCertificacion>
              rowData={visibles}
              columnDefs={columnas}
              getRowId={(p) => p.data.partida_id}
              onCellValueChanged={editar}
              singleClickEdit
              stopEditingWhenCellsLoseFocus
              overlayNoRowsTemplate="Sin movimiento en este mes"
              getRowStyle={(p) => (p.data && cambios.has(p.data.partida_id) ? { background: "#fffbea" } : undefined)}
            />
          </div>
          <p className="muted text-xs p-3">Cantidades a origen a {new Date(finDeMes(periodo)).toLocaleDateString("es-ES")} según el avance registrado; {capitulos.size} capítulos. Las celdas «A origen» se pueden corregir.</p>
        </div>

        <aside className="card card-pad grid gap-2 text-sm lg:sticky lg:top-4">
          <h3>Resumen</h3>
          <Fila t="A origen" v={eur(tot.pem_origen)} />
          <Fila t="Anterior" v={`− ${eur(tot.pem_anterior)}`} />
          <Fila t="Ejecución material del mes" v={eur(tot.pem_periodo)} fuerte />
          {dest === "contratista" && (
            <label className="flex justify-between items-center gap-2">Coeficiente
              <input className="input !w-20 !min-h-8 text-right" type="number" step="0.01" value={coef} onChange={(e) => setCoef(Number(e.target.value) || 1)} />
            </label>
          )}
          <hr className="border-[var(--line)]" />
          <Concepto on={ajustes.aplicar.gg} onToggle={() => toggle("gg")} t="Gastos generales" input={porc("gg")} v={tot.gg} />
          <Concepto on={ajustes.aplicar.bi} onToggle={() => toggle("bi")} t="Beneficio industrial" input={porc("bi")} v={tot.bi} />
          <Fila t="Base" v={eur(tot.base)} fuerte />
          <Concepto on={ajustes.aplicar.iva} onToggle={() => toggle("iva")} t="IVA" input={porc("iva")} v={tot.iva} />
          <Concepto on={ajustes.aplicar.retencion} onToggle={() => toggle("retencion")} t="Retención" input={porc("retencion")} v={-tot.retencion} />
          <hr className="border-[var(--line)]" />
          <div className="flex justify-between items-baseline"><span className="font-semibold">Total a certificar</span><b className="font-display text-xl">{eur(tot.total)}</b></div>
          {error && <p className="chip chip-late">{error}</p>}
          <button className="btn btn-primary mt-2" disabled={!periodoValido || pendiente} onClick={cerrar}>
            {pendiente ? "Cerrando…" : `Cerrar ${nombreMes(periodo)}`}
          </button>
          <p className="muted text-xs">Al cerrar se guarda una copia fija: lo que se marque después no la cambia.</p>
        </aside>
      </section>
    </main>
  );
}

function Fila({ t, v, fuerte }: { t: string; v: string; fuerte?: boolean }) {
  return <div className={`flex justify-between ${fuerte ? "font-semibold" : ""}`}><span>{t}</span><span className="num">{v}</span></div>;
}

function Concepto({ on, onToggle, t, input, v }: { on: boolean; onToggle: () => void; t: string; input: React.ReactNode; v: number }) {
  return (
    <div className={`flex items-center gap-2 ${on ? "" : "opacity-55"}`}>
      <input type="checkbox" className="size-5" checked={on} onChange={onToggle} aria-label={t} />
      <span className="flex-1">{t}</span>
      {input}<span className="muted">%</span>
      <span className="num w-24">{on ? eur(v) : "—"}</span>
    </div>
  );
}
