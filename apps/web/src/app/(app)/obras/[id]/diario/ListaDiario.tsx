"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { Diario } from "@/lib/tipos";
import { borrarEntrada } from "./acciones";
import { EditorDiario } from "./EditorDiario";

const fechaLarga = (f: string) => new Date(`${f}T00:00:00`).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

export function ListaDiario({ obraId, entradas }: { obraId: string; entradas: Diario[] }) {
  const router = useRouter();
  const [editando, setEditando] = useState<string | null>(null);
  const [, start] = useTransition();
  if (!entradas.length) return <p className="muted text-center py-8">Sin anotaciones este mes.</p>;
  const dias = new Map<string, Diario[]>();
  for (const e of entradas) dias.set(e.fecha, [...(dias.get(e.fecha) ?? []), e]);
  return (
    <div className="grid gap-4">
      {[...dias.entries()].map(([fecha, lista]) => (
        <section key={fecha} className="grid gap-2">
          <h3 className="capitalize border-b border-[var(--line)] pb-1">{fechaLarga(fecha)}</h3>
          {lista.map((e) => editando === e.id ? (
            <EditorDiario key={e.id} obraId={obraId} entrada={e} onGuardado={() => setEditando(null)} onCancelar={() => setEditando(null)} />
          ) : (
            <article key={e.id} className="grid gap-1">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                {e.meteo && <span className="chip">{e.meteo}</span>}
                {e.personal != null && <span className="chip">{e.personal} personas</span>}
                <span className="muted text-xs">{new Date(e.created_at).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}{e.updated_at !== e.created_at ? " · editada" : ""}</span>
                <span className="flex-1" />
                <button className="btn btn-sm no-print" onClick={() => setEditando(e.id)}>Editar</button>
                <button className="btn btn-sm btn-danger no-print" onClick={() => {
                  if (confirm("¿Borrar esta anotación?")) start(async () => { await borrarEntrada(obraId, e.id); router.refresh(); });
                }}>Borrar</button>
              </div>
              <p className="whitespace-pre-line">{e.texto}</p>
            </article>
          ))}
        </section>
      ))}
    </div>
  );
}
