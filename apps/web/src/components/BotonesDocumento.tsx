"use client";
import { descargarExcel, type ColumnaExcel } from "@/lib/excel";

export function BotonesDocumento({ excel, extra }: {
  excel?: { nombre: string; titulo: string[]; columnas: ColumnaExcel[]; filas: (string | number | null)[][]; negrita?: number[] };
  extra?: React.ReactNode;
}) {
  return (
    <div className="no-print flex flex-wrap gap-2">
      <button className="btn btn-primary" onClick={() => window.print()}>Imprimir / PDF</button>
      {excel && <button className="btn" onClick={() => descargarExcel(excel.nombre, [{ ...excel, nombre: "Hoja1" }])}>Exportar Excel</button>}
      {extra}
    </div>
  );
}
