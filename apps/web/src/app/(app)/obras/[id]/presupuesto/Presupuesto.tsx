"use client";
import { useMemo, useState } from "react";
import type { CellValueChangedEvent, ColDef, RowClassParams } from "ag-grid-community";
import { Rejilla } from "@/components/Rejilla";
import { eur, hoyISO, num, pct, resumenPartidas, totales } from "@/lib/calculo";
import { descargarExcel, EUR, NUM, PCT } from "@/lib/excel";
import { supabaseNavegador } from "@/lib/supabase/client";
import type { AvanceManual, DatosObra } from "@/lib/tipos";

type Fila = {
  tipo: "capitulo" | "partida";
  id: string;
  codigo: string;
  resumen: string;
  descripcion?: string | null;
  unidad?: string;
  medicion?: number;
  medicionPlano?: number | null;
  desviacion?: number | null;
  precio?: number;
  presupuesto: number;
  cantidad?: number;
  porcentaje: number;
  importe: number;
  origen?: "plano" | "manual";
  estimado?: boolean;
};

export function Presupuesto({ datos }: { datos: DatosObra }) {
  const [manuales, setManuales] = useState<AvanceManual[]>(datos.manuales);
  const [fecha, setFecha] = useState(hoyISO());
  const [buscar, setBuscar] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  const d = useMemo(() => ({ ...datos, manuales }), [datos, manuales]);
  const resumen = useMemo(() => resumenPartidas(d), [d]);
  const tot = totales(resumen);

  const filas = useMemo(() => {
    const out: Fila[] = [];
    for (const c of datos.capitulos) {
      const ps = datos.partidas.filter((p) => p.capitulo_id === c.id);
      const rs = ps.map((p) => resumen.get(p.id)!);
      const pres = rs.reduce((s, r) => s + r.presupuesto, 0), imp = rs.reduce((s, r) => s + r.importe, 0);
      out.push({ tipo: "capitulo", id: c.id, codigo: c.codigo, resumen: c.nombre, presupuesto: pres, importe: imp, porcentaje: pres ? imp / pres : 0 });
      for (const r of rs) {
        const p = r.partida;
        out.push({
          tipo: "partida", id: p.id, codigo: p.codigo, resumen: p.resumen, descripcion: p.descripcion, unidad: p.unidad,
          medicion: p.medicion, medicionPlano: r.origen === "plano" ? r.medicionPlano : null,
          desviacion: r.origen === "plano" && p.medicion ? r.medicionPlano / p.medicion - 1 : null,
          precio: p.precio, presupuesto: r.presupuesto, cantidad: r.cantidad, porcentaje: r.porcentaje, importe: r.importe,
          origen: r.origen, estimado: r.estimado,
        });
      }
    }
    return out;
  }, [datos, resumen]);

  async function guardarManual(e: CellValueChangedEvent<Fila>) {
    const f = e.data;
    const cantidad = Number(String(e.newValue).replace(",", "."));
    if (f.tipo !== "partida" || f.origen !== "manual" || !Number.isFinite(cantidad) || cantidad < 0) return;
    const { data, error } = await supabaseNavegador()
      .from("avances_manuales")
      .insert({ obra_id: datos.obra.id, partida_id: f.id, cantidad, fecha })
      .select("id,partida_id,cantidad,fecha,created_at,nota")
      .single();
    if (error) { setAviso(error.message); return; }
    setManuales((m) => [...m, { ...(data as AvanceManual), cantidad: Number(data.cantidad) }]);
    setAviso(`${f.codigo}: ${num(cantidad)} ${f.unidad} a origen a ${new Date(fecha).toLocaleDateString("es-ES")}`);
  }

  const columnas = useMemo<ColDef<Fila>[]>(() => {
    const n = (d = 2) => (p: { value: number | null | undefined }) => (p.value == null ? "" : num(p.value, d));
    return [
      { field: "codigo", headerName: "Código", width: 92, pinned: "left" },
      { field: "resumen", headerName: "Resumen", flex: 1, minWidth: 260, tooltipField: "descripcion", pinned: "left" },
      { field: "unidad", headerName: "Ud", width: 64 },
      { field: "medicion", headerName: "Medición", width: 104, type: "rightAligned", valueFormatter: n() },
      {
        field: "medicionPlano", headerName: "Medido en plano", width: 132, type: "rightAligned",
        valueFormatter: (p) => (p.value == null ? "" : `${num(p.value)}${p.data?.estimado ? " *" : ""}`),
        headerTooltip: "Cantidad medida automáticamente sobre el plano (* incluye perímetros estimados)",
      },
      {
        field: "desviacion", headerName: "Desv.", width: 84, type: "rightAligned",
        valueFormatter: (p) => (p.value == null ? "" : `${p.value > 0 ? "+" : ""}${num(p.value * 100, 0)} %`),
        cellStyle: (p) => (p.value != null && Math.abs(p.value) > 0.1 ? { color: "#c3412b", fontWeight: 600 } : null),
        headerTooltip: "Diferencia entre lo medido en plano y la medición del presupuesto",
      },
      { field: "precio", headerName: "Precio", width: 100, type: "rightAligned", valueFormatter: n() },
      { field: "presupuesto", headerName: "Importe", width: 120, type: "rightAligned", valueFormatter: (p) => eur(p.value) },
      {
        field: "cantidad", headerName: "Ejecutado", width: 112, type: "rightAligned",
        valueFormatter: n(),
        editable: (p) => p.data?.tipo === "partida" && p.data.origen === "manual",
        cellClassRules: { "celda-editable": (p) => p.data?.tipo === "partida" && p.data.origen === "manual" },
        headerTooltip: "Cantidad ejecutada a origen. En partidas manuales se escribe directamente",
      },
      {
        field: "porcentaje", headerName: "%", width: 120,
        cellRenderer: (p: { value: number }) => (
          <span className="flex items-center gap-2 h-full">
            <span className="barra flex-1"><i style={{ width: `${Math.min(100, p.value * 100)}%` }} /></span>
            <span className="num w-10">{num(p.value * 100, 0)}</span>
          </span>
        ),
      },
      { field: "importe", headerName: "Ejecutado €", width: 124, type: "rightAligned", valueFormatter: (p) => eur(p.value) },
      {
        field: "origen", headerName: "Avance", width: 96,
        cellRenderer: (p: { value?: string }) => (p.value ? <span className={`chip ${p.value === "plano" ? "chip-accent" : ""}`}>{p.value === "plano" ? "Plano" : "Manual"}</span> : null),
      },
    ];
  }, []);

  function exportar() {
    const filasX = filas.map((f) => [
      f.codigo, f.resumen, f.unidad ?? "", f.medicion ?? null, f.medicionPlano ?? null, f.precio ?? null, f.presupuesto,
      f.cantidad ?? null, f.porcentaje, f.importe, f.origen ?? "",
    ]);
    descargarExcel(`Presupuesto ${datos.obra.nombre}`, [{
      nombre: "Presupuesto",
      titulo: [datos.obra.nombre, `Avance a ${new Date().toLocaleDateString("es-ES")}`],
      columnas: [
        { titulo: "Código", ancho: 10 }, { titulo: "Resumen", ancho: 60 }, { titulo: "Ud", ancho: 6 },
        { titulo: "Medición", formato: NUM }, { titulo: "Medido en plano", formato: NUM }, { titulo: "Precio", formato: EUR },
        { titulo: "Importe", formato: EUR, ancho: 16 }, { titulo: "Ejecutado", formato: NUM }, { titulo: "%", formato: PCT },
        { titulo: "Ejecutado €", formato: EUR, ancho: 16 }, { titulo: "Avance", ancho: 10 },
      ],
      filas: [...filasX, ["", "TOTAL", "", null, null, null, tot.presupuesto, null, tot.porcentaje, tot.ejecutado, ""]],
      negrita: [...filas.map((f, i) => (f.tipo === "capitulo" ? i : -1)).filter((i) => i >= 0), filas.length],
    }]);
  }

  return (
    <main className="flex-1 flex flex-col gap-3 p-4 md:p-5 min-h-0">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid grid-cols-3 gap-4 mr-auto">
          <div className="kpi"><span className="eyebrow">Presupuesto (PEM)</span><b>{eur(tot.presupuesto, false)}</b></div>
          <div className="kpi"><span className="eyebrow">Ejecutado</span><b>{eur(tot.ejecutado, false)}</b></div>
          <div className="kpi"><span className="eyebrow">Avance</span><b>{pct(tot.porcentaje, 1)}</b></div>
        </div>
        <input className="input !w-56" placeholder="Buscar partida…" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
        <label className="campo !flex-row items-center gap-2">Fecha de lo anotado
          <input className="input !w-40" type="date" value={fecha} max={hoyISO()} onChange={(e) => setFecha(e.target.value)} />
        </label>
        <button className="btn" onClick={exportar}>Exportar Excel</button>
      </div>
      <p className="text-sm muted">
        Las partidas <span className="chip chip-accent">Plano</span> avanzan al marcar en Planos; en las <span className="chip">Manual</span> escribe la cantidad ejecutada a origen en la columna «Ejecutado».
        {aviso && <span className="chip chip-ok ml-2">{aviso}</span>}
      </p>
      <div className="flex-1 min-h-[480px] relative">
        <Rejilla<Fila>
          rowData={filas}
          columnDefs={columnas}
          getRowId={(p) => p.data.id}
          quickFilterText={buscar}
          onCellValueChanged={guardarManual}
          singleClickEdit
          stopEditingWhenCellsLoseFocus
          tooltipShowDelay={400}
          getRowStyle={(p: RowClassParams<Fila>) => (p.data?.tipo === "capitulo" ? { background: "#eef1ef", fontWeight: 650 } : undefined)}
          pinnedBottomRowData={[{ tipo: "capitulo", id: "total", codigo: "", resumen: "TOTAL", presupuesto: tot.presupuesto, importe: tot.ejecutado, porcentaje: tot.porcentaje }]}
        />
      </div>
    </main>
  );
}
