"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { supabaseNavegador } from "@/lib/supabase/client";
import type { Documento } from "@/lib/tipos";
import { borrarDocumento, enlaceDescarga, procesar, registrarDocumento } from "./acciones";

const TIPOS: [Documento["tipo"], string, string][] = [
  ["planos", "Planos", "PDF vectorial exportado de CAD. Se detectan hojas, escala, tabiques, estancias y viviendas."],
  ["presupuesto", "Presupuesto", "BC3, Excel o PDF con capítulos, partidas, mediciones y precios."],
  ["memoria", "Memoria", "Se guarda como consulta."],
  ["planificacion", "Planificación", "Excel o MS Project. De momento se guarda; las fechas por capítulo se ajustan en Configuración."],
  ["otro", "Otro", ""],
];

const limpio = (n: string) => n.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\w.-]+/g, "_");
const ESTADO: Record<Documento["estado"], [string, string]> = {
  pendiente: ["Pendiente", ""],
  procesando: ["Procesando…", "chip-progress"],
  listo: ["Procesado", "chip-ok"],
  error: ["Error", "chip-late"],
};

export function Documentos({ obraId, documentos }: { obraId: string; documentos: Documento[] }) {
  const router = useRouter();
  const [tipo, setTipo] = useState<Documento["tipo"]>("planos");
  const [subiendo, setSubiendo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  const procesando = documentos.some((d) => d.estado === "procesando");

  useEffect(() => {
    if (!procesando) return;
    const t = setInterval(() => router.refresh(), 2500);
    return () => clearInterval(t);
  }, [procesando, router]);

  async function subir(archivos: FileList | null) {
    if (!archivos?.length) return;
    setError(null);
    const sb = supabaseNavegador();
    for (const f of Array.from(archivos)) {
      setSubiendo(f.name);
      const ruta = `${obraId}/documentos/${Date.now()}-${limpio(f.name)}`;
      const { error: e } = await sb.storage.from("obras").upload(ruta, f, { contentType: f.type || undefined });
      if (e) {
        setError(`${f.name}: ${e.message}`);
        break;
      }
      await registrarDocumento(obraId, { tipo, nombre: f.name, ruta, tamano: f.size });
    }
    setSubiendo(null);
    router.refresh();
  }

  return (
    <main className="w-full max-w-5xl mx-auto p-4 md:p-6 grid gap-5">
      <section className="card card-pad grid gap-4">
        <h2>Subir documentos</h2>
        <div className="seg flex-wrap self-start">
          {TIPOS.map(([k, n]) => (
            <button key={k} type="button" className={tipo === k ? "on" : ""} onClick={() => setTipo(k)}>{n}</button>
          ))}
        </div>
        <p className="muted text-sm">{TIPOS.find((t) => t[0] === tipo)![2]}</p>
        <label
          className="grid place-items-center border-2 border-dashed border-[var(--line)] rounded-md py-10 cursor-pointer hover:border-[var(--accent)] text-center"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); subir(e.dataTransfer.files); }}
        >
          <input type="file" className="sr-only" multiple onChange={(e) => subir(e.target.files)}
                 accept={tipo === "presupuesto" ? ".bc3,.xlsx,.xls,.pdf" : tipo === "planos" ? ".pdf" : undefined} />
          <span className="font-semibold">{subiendo ? `Subiendo ${subiendo}…` : "Arrastra aquí o toca para elegir archivos"}</span>
          <span className="muted text-sm">Hasta 200 MB por archivo</span>
        </label>
        {error && <p className="chip chip-late">{error}</p>}
      </section>

      <p className="muted text-sm">Las fotos de obra van en la pestaña <Link href={`/obras/${obraId}/fotos`} className="underline">Fotos</Link>.</p>

      <section className="card">
        <table className="tabla">
          <thead>
            <tr><th>Documento</th><th>Tipo</th><th>Estado</th><th className="no-print" /></tr>
          </thead>
          <tbody>
            {documentos.length === 0 && (
              <tr><td colSpan={4} className="muted text-center py-8">Sube los planos y el presupuesto para empezar.</td></tr>
            )}
            {documentos.map((d) => (
              <tr key={d.id}>
                <td>
                  <button className="text-left font-semibold hover:underline" onClick={async () => {
                    const u = await enlaceDescarga(d.ruta);
                    if (u) window.open(u, "_blank");
                  }}>{d.nombre}</button>
                  <div className="muted text-xs">{new Date(d.created_at).toLocaleString("es-ES")} · {((d.tamano ?? 0) / 1048576).toFixed(1)} MB</div>
                  {d.estado === "error" && <p className="text-sm text-[var(--late)] mt-1">{d.mensaje}</p>}
                  {d.estado === "listo" && d.resumen && <Resumen r={d.resumen} />}
                </td>
                <td className="capitalize">{d.tipo}</td>
                <td><span className={`chip ${ESTADO[d.estado][1]}`}>{ESTADO[d.estado][0]}</span></td>
                <td className="no-print text-right whitespace-nowrap">
                  {(d.tipo === "planos" || d.tipo === "presupuesto") && d.estado !== "procesando" && (
                    <button className="btn btn-sm" onClick={() => start(() => procesar(obraId, d.id))}>Reprocesar</button>
                  )}{" "}
                  <button className="btn btn-sm btn-danger" onClick={() => {
                    if (confirm(`¿Borrar «${d.nombre}»? Lo ya importado (hojas, partidas…) se mantiene.`)) start(() => borrarDocumento(obraId, d.id));
                  }}>Borrar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}

function Resumen({ r }: { r: Record<string, unknown> }) {
  const partes: string[] = [];
  if (r.hojas) partes.push(`${r.hojas} hojas`);
  if (r.elementos_lineales) partes.push(`${r.elementos_lineales} tramos de tabique`);
  if (r.estancias) partes.push(`${r.estancias} estancias`);
  if (r.viviendas) partes.push(`${r.viviendas} viviendas`);
  if (r.capitulos) partes.push(`${r.capitulos} capítulos`);
  if (r.partidas) partes.push(`${r.partidas} partidas`);
  if (typeof r.total === "number") partes.push(`total ${r.total.toLocaleString("es-ES", { style: "currency", currency: "EUR" })}`);
  const v = r.vinculacion as { trabajos?: number } | undefined;
  if (v?.trabajos) partes.push(`${v.trabajos} vínculos plano–presupuesto creados`);
  const avisos = (r.avisos as string[] | undefined) ?? [];
  return (
    <div className="text-sm mt-1">
      <span className="text-[var(--ok)]">{partes.join(" · ")}</span>
      {avisos.map((a) => <p key={a} className="text-[#8a5a00]">⚠ {a}</p>)}
    </div>
  );
}
