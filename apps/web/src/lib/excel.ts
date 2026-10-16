// Exportación a Excel en el navegador (ExcelJS).
export type ColumnaExcel = { titulo: string; ancho?: number; formato?: string };

export async function descargarExcel(nombre: string, hojas: { nombre: string; titulo?: string[]; columnas: ColumnaExcel[]; filas: (string | number | null)[][]; negrita?: number[] }[]) {
  const ExcelJS = (await import("exceljs")).default;
  const libro = new ExcelJS.Workbook();
  libro.creator = "Atalaya";
  for (const h of hojas) {
    const ws = libro.addWorksheet(h.nombre.slice(0, 31));
    let fila = 1;
    for (const t of h.titulo ?? []) {
      ws.getCell(fila, 1).value = t;
      ws.getCell(fila, 1).font = { bold: fila === 1, size: fila === 1 ? 14 : 11 };
      fila++;
    }
    if (h.titulo?.length) fila++;
    const cab = ws.getRow(fila);
    h.columnas.forEach((c, i) => {
      cab.getCell(i + 1).value = c.titulo;
      ws.getColumn(i + 1).width = c.ancho ?? 14;
      if (c.formato) ws.getColumn(i + 1).numFmt = c.formato;
    });
    cab.font = { bold: true };
    cab.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE3E7E5" } };
    ws.views = [{ state: "frozen", ySplit: fila }];
    h.filas.forEach((f, i) => {
      const r = ws.getRow(fila + 1 + i);
      f.forEach((v, j) => (r.getCell(j + 1).value = v));
      if (h.negrita?.includes(i)) r.font = { bold: true };
    });
  }
  const buf = await libro.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre.endsWith(".xlsx") ? nombre : `${nombre}.xlsx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const EUR = '#,##0.00 "€"';
export const NUM = "#,##0.00";
export const PCT = "0.0%";
