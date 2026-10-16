import Link from "next/link";
import { cargarDatos } from "@/lib/datos";
import { eur, pct, plazoConsumido, resumenPartidas, totales } from "@/lib/calculo";
import { supabaseServidor } from "@/lib/supabase/server";
import { crearObra } from "./acciones";

export const metadata = { title: "Obras" };

export default async function Obras() {
  const sb = await supabaseServidor();
  const { data: obras } = await sb.from("obras").select("id").order("created_at", { ascending: false });
  const filas = await Promise.all(
    (obras ?? []).map(async ({ id }) => {
      const d = await cargarDatos(id);
      const t = totales(resumenPartidas(d));
      return { obra: d.obra, ...t, plazo: plazoConsumido(d.obra.fecha_inicio, d.obra.fecha_fin), partidas: d.partidas.length, elementos: d.elementos.length };
    }),
  );
  return (
    <main className="w-full max-w-6xl mx-auto p-4 md:p-6 flex flex-col gap-5">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="eyebrow">Cartera</p>
          <h1>Obras</h1>
        </div>
        <details className="relative">
          <summary className="btn btn-primary list-none">Nueva obra</summary>
          <form action={crearObra} className="card card-pad absolute right-0 mt-2 z-10 w-[min(92vw,420px)] grid gap-3">
            <label className="campo">Nombre<input className="input" name="nombre" required placeholder="Edificio Calle Mayor 10" /></label>
            <label className="campo">Dirección<input className="input" name="direccion" /></label>
            <label className="campo">Cliente<input className="input" name="cliente" /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="campo">Inicio<input className="input" name="fecha_inicio" type="date" /></label>
              <label className="campo">Fin previsto<input className="input" name="fecha_fin" type="date" /></label>
            </div>
            <button className="btn btn-primary">Crear y subir documentos</button>
          </form>
        </details>
      </div>
      {filas.length === 0 ? (
        <div className="card card-pad text-center py-16">
          <h2>Todavía no hay obras</h2>
          <p className="muted mt-1">Crea la primera y sube sus planos y presupuesto.</p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {filas.map((f) => (
            <Link key={f.obra.id} href={`/obras/${f.obra.id}`} className="card card-pad flex flex-col gap-3 hover:border-[var(--accent)]">
              <div>
                <h2>{f.obra.nombre}</h2>
                <p className="muted text-sm">{[f.obra.direccion, f.obra.cliente].filter(Boolean).join(" · ") || "Sin datos"}</p>
              </div>
              {f.partidas ? (
                <>
                  <div className="flex justify-between text-sm">
                    <span>Avance <b>{pct(f.porcentaje, 1)}</b></span>
                    <span className="muted">Plazo {pct(f.plazo)}</span>
                  </div>
                  <div className="barra"><i style={{ width: `${Math.min(100, f.porcentaje * 100)}%` }} /></div>
                  <p className="text-sm muted">{eur(f.ejecutado, false)} de {eur(f.presupuesto, false)}</p>
                </>
              ) : (
                <p className="chip chip-progress self-start">Falta subir el presupuesto</p>
              )}
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
