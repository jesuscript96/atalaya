"use client";
/* eslint-disable @next/next/no-img-element -- las fotos vienen de URLs firmadas del almacenamiento, no pasan por next/image */
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { hoyISO } from "@/lib/calculo";
import { supabaseNavegador } from "@/lib/supabase/client";
import type { Foto } from "@/lib/tipos";
import { actualizarFoto, borrarFoto, enlaceFoto, registrarFoto } from "./acciones";
import { redimensionar } from "./imagen";

type FotoUrl = Foto & { url: string | null };
type Estancia = { vivienda: string; etiqueta: string };

const fechaLarga = (f: string) => new Date(`${f}T00:00:00`).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

export function Galeria({ obraId, fotos, viviendas, estancias, inicial }: {
  obraId: string; fotos: FotoUrl[]; viviendas: string[]; estancias: Estancia[]; inicial: { vivienda: string; estancia: string };
}) {
  const router = useRouter();
  const [fVivienda, setFVivienda] = useState(inicial.vivienda);
  const [fEstancia, setFEstancia] = useState(inicial.estancia);
  const [sVivienda, setSVivienda] = useState(inicial.vivienda);
  const [sEstancia, setSEstancia] = useState(inicial.estancia);
  const [sFecha, setSFecha] = useState(hoyISO());
  const [sNota, setSNota] = useState("");
  const [progreso, setProgreso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [abierta, setAbierta] = useState<number | null>(null);

  function filtrar(v: string, e: string) {
    setFVivienda(v);
    setFEstancia(e);
    const q = new URLSearchParams();
    if (v) q.set("vivienda", v);
    if (e) q.set("estancia", e);
    router.replace(`?${q.toString()}`);
  }

  async function subir(archivos: FileList | null) {
    if (!archivos?.length) return;
    setError(null);
    const sb = supabaseNavegador();
    const lista = Array.from(archivos);
    for (const [i, f] of lista.entries()) {
      setProgreso(`Subiendo ${i + 1} de ${lista.length}…`);
      try {
        const id = crypto.randomUUID();
        const [grande, mini] = await Promise.all([redimensionar(f, 2000), redimensionar(f, 480, 0.8)]);
        const ruta = `${obraId}/fotos/${id}.jpg`, miniatura = `${obraId}/fotos/${id}-min.jpg`;
        const r1 = await sb.storage.from("obras").upload(ruta, grande.blob, { contentType: "image/jpeg" });
        if (r1.error) throw new Error(r1.error.message);
        const r2 = await sb.storage.from("obras").upload(miniatura, mini.blob, { contentType: "image/jpeg" });
        if (r2.error) throw new Error(r2.error.message);
        await registrarFoto(obraId, { id, ruta, miniatura, fecha: sFecha, vivienda: sVivienda || null, estancia: sEstancia || null, nota: sNota.trim() || null, ancho: grande.ancho, alto: grande.alto });
      } catch (e) {
        setError(`${f.name}: ${(e as Error).message}`);
        break;
      }
    }
    setProgreso(null);
    setSNota("");
    router.refresh();
  }

  const visibles = fotos.filter((f) => (!fVivienda || f.vivienda === fVivienda) && (!fEstancia || f.estancia === fEstancia));
  const porFecha = new Map<string, FotoUrl[]>();
  for (const f of visibles) porFecha.set(f.fecha, [...(porFecha.get(f.fecha) ?? []), f]);
  const estanciasDe = (v: string) => estancias.filter((e) => !v || e.vivienda === v).map((e) => e.etiqueta).filter((x, i, a) => a.indexOf(x) === i);

  const subida = (
    <label className={`btn btn-primary cursor-pointer ${progreso ? "opacity-60" : ""}`}>
      {progreso ?? "Hacer o subir fotos"}
      <input type="file" accept="image/*" capture="environment" multiple className="sr-only" disabled={!!progreso} onChange={(e) => { subir(e.target.files); e.target.value = ""; }} />
    </label>
  );

  return (
    <main className="w-full max-w-6xl mx-auto p-4 md:p-6 grid gap-4">
      <section className="card card-pad grid gap-3">
        <h2>Nuevas fotos</h2>
        <div className="grid sm:grid-cols-4 gap-2">
          <label className="campo">Fecha<input className="input" type="date" value={sFecha} max={hoyISO()} onChange={(e) => setSFecha(e.target.value)} /></label>
          <label className="campo">Vivienda
            <select className="select" value={sVivienda} onChange={(e) => { setSVivienda(e.target.value); setSEstancia(""); }}>
              <option value="">—</option>
              {viviendas.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
          <label className="campo">Estancia
            <select className="select" value={sEstancia} onChange={(e) => setSEstancia(e.target.value)}>
              <option value="">—</option>
              {estanciasDe(sVivienda).map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
          </label>
          <label className="campo">Nota<input className="input" value={sNota} onChange={(e) => setSNota(e.target.value)} placeholder="Opcional" /></label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {subida}
          <span className="muted text-sm">Desde el móvil o la tablet abre la cámara. Se reducen a 2000 px antes de subirlas.</span>
          {error && <span className="chip chip-late">{error}</span>}
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto">{visibles.length} fotos</h2>
        <select className="select !w-auto" value={fVivienda} onChange={(e) => filtrar(e.target.value, "")}>
          <option value="">Todas las viviendas</option>
          {viviendas.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <select className="select !w-auto" value={fEstancia} onChange={(e) => filtrar(fVivienda, e.target.value)}>
          <option value="">Todas las estancias</option>
          {estanciasDe(fVivienda).map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
        {(fVivienda || fEstancia) && <button className="btn" onClick={() => filtrar("", "")}>Todas</button>}
      </div>

      {visibles.length === 0 ? (
        <div className="card card-pad text-center py-12 grid gap-3 place-items-center">
          <h2>Sin fotos todavía</h2>
          <p className="muted">Haz fotos desde el móvil en obra y quedarán ordenadas por fecha, vivienda y estancia.</p>
        </div>
      ) : (
        [...porFecha.entries()].map(([fecha, lista]) => (
          <section key={fecha} className="grid gap-2">
            <h3 className="capitalize">{fechaLarga(fecha)} <span className="muted font-normal">· {lista.length}</span></h3>
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
              {lista.map((f) => (
                <button key={f.id} className="text-left grid gap-1" onClick={() => setAbierta(visibles.indexOf(f))}>
                  {f.url ? <img src={f.url} alt={f.nota ?? ""} className="aspect-square w-full object-cover rounded border border-[var(--line)]" loading="lazy" />
                         : <div className="aspect-square rounded bg-[var(--surface-2)]" />}
                  <span className="text-xs muted truncate">{[f.vivienda, f.estancia].filter(Boolean).join(" · ") || f.nota || " "}</span>
                </button>
              ))}
            </div>
          </section>
        ))
      )}

      {abierta != null && visibles[abierta] && (
        <Visor key={visibles[abierta].id} obraId={obraId} foto={visibles[abierta]} viviendas={viviendas} estancias={estancias}
               onCerrar={() => setAbierta(null)}
               onAnterior={abierta > 0 ? () => setAbierta(abierta - 1) : undefined}
               onSiguiente={abierta < visibles.length - 1 ? () => setAbierta(abierta + 1) : undefined} />
      )}
    </main>
  );
}

function Visor({ obraId, foto, viviendas, estancias, onCerrar, onAnterior, onSiguiente }: {
  obraId: string; foto: FotoUrl; viviendas: string[]; estancias: Estancia[]; onCerrar: () => void; onAnterior?: () => void; onSiguiente?: () => void;
}) {
  const router = useRouter();
  const [url, setUrl] = useState<string | null>(null);
  const [nota, setNota] = useState(foto.nota ?? "");
  const [vivienda, setVivienda] = useState(foto.vivienda ?? "");
  const [estancia, setEstancia] = useState(foto.estancia ?? "");
  const [aviso, setAviso] = useState("");

  // el componente se monta de nuevo por cada foto (key = id): solo hay que pedir la URL grande
  useEffect(() => {
    let vigente = true;
    enlaceFoto(foto.ruta).then((u) => { if (vigente) setUrl(u); });
    return () => { vigente = false; };
  }, [foto.ruta]);

  const tecla = useCallback((ev: KeyboardEvent) => {
    if (ev.key === "Escape") onCerrar();
    if (ev.key === "ArrowLeft") onAnterior?.();
    if (ev.key === "ArrowRight") onSiguiente?.();
  }, [onCerrar, onAnterior, onSiguiente]);
  useEffect(() => {
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [tecla]);

  async function guardar(c: { vivienda?: string | null; estancia?: string | null; nota?: string | null }) {
    try { await actualizarFoto(obraId, foto.id, c); setAviso("Guardado"); router.refresh(); }
    catch (e) { setAviso((e as Error).message); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/90 text-white grid grid-rows-[auto_1fr_auto]" onClick={onCerrar}>
      <div className="flex items-center gap-2 p-3" onClick={(e) => e.stopPropagation()}>
        <b>{fechaLarga(foto.fecha)}</b>
        <span className="flex-1" />
        {url && <a className="btn btn-sm" href={url} target="_blank" rel="noreferrer">Descargar</a>}
        <button className="btn btn-sm btn-danger" onClick={async () => {
          if (!confirm("¿Borrar esta foto?")) return;
          await borrarFoto(obraId, foto.id);
          onCerrar();
          router.refresh();
        }}>Borrar</button>
        <button className="btn btn-sm" onClick={onCerrar} aria-label="Cerrar">✕</button>
      </div>
      <div className="relative grid place-items-center min-h-0 px-12">
        {url ? <img src={url} alt={foto.nota ?? ""} className="max-h-full max-w-full object-contain" onClick={(e) => e.stopPropagation()} />
             : <span className="muted">Cargando…</span>}
        {onAnterior && <button className="absolute left-2 top-1/2 -translate-y-1/2 btn !bg-black/50 !text-white !border-white/30" onClick={(e) => { e.stopPropagation(); onAnterior(); }} aria-label="Anterior">‹</button>}
        {onSiguiente && <button className="absolute right-2 top-1/2 -translate-y-1/2 btn !bg-black/50 !text-white !border-white/30" onClick={(e) => { e.stopPropagation(); onSiguiente(); }} aria-label="Siguiente">›</button>}
      </div>
      <div className="p-3 grid sm:grid-cols-[auto_auto_1fr_auto] gap-2 items-end bg-black/60" onClick={(e) => e.stopPropagation()}>
        <label className="campo !text-white/80">Vivienda
          <select className="select !text-black" value={vivienda} onChange={(e) => { setVivienda(e.target.value); setEstancia(""); guardar({ vivienda: e.target.value || null, estancia: null }); }}>
            <option value="">—</option>
            {viviendas.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
        <label className="campo !text-white/80">Estancia
          <select className="select !text-black" value={estancia} onChange={(e) => { setEstancia(e.target.value); guardar({ estancia: e.target.value || null }); }}>
            <option value="">—</option>
            {estancias.filter((x) => !vivienda || x.vivienda === vivienda).map((x) => x.etiqueta).filter((x, i, a) => a.indexOf(x) === i).map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
        <label className="campo !text-white/80">Nota
          <input className="input !text-black" value={nota} onChange={(e) => setNota(e.target.value)} onBlur={() => { if ((nota.trim() || null) !== foto.nota) guardar({ nota: nota.trim() || null }); }} />
        </label>
        <span className="chip chip-ok self-center min-h-6">{aviso || " "}</span>
      </div>
    </div>
  );
}
