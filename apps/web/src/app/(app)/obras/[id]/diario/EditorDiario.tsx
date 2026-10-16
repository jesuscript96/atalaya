"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { hoyISO } from "@/lib/calculo";
import type { Diario } from "@/lib/tipos";
import { guardarEntrada, mejorarTexto } from "./acciones";

export const METEOS = ["Soleado", "Nublado", "Lluvia", "Viento", "Calor extremo"];

// Tipos mínimos del reconocimiento de voz del navegador (Chrome y Safari lo ofrecen como webkitSpeechRecognition)
type ResultadoVoz = { isFinal: boolean; 0: { transcript: string } };
type EventoVoz = { resultIndex: number; results: { length: number; [i: number]: ResultadoVoz } };
interface ReconocimientoVoz {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((ev: EventoVoz) => void) | null; onend: (() => void) | null; onerror: ((ev: { error: string }) => void) | null;
  start(): void; stop(): void;
}
type ConstructorVoz = new () => ReconocimientoVoz;
const constructorVoz = (): ConstructorVoz | null => {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: ConstructorVoz; webkitSpeechRecognition?: ConstructorVoz };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

export function EditorDiario({ obraId, entrada, compacto, onGuardado, onCancelar }: {
  obraId: string; entrada?: Diario; compacto?: boolean; onGuardado?: () => void; onCancelar?: () => void;
}) {
  const router = useRouter();
  const [fecha, setFecha] = useState(entrada?.fecha ?? hoyISO());
  const [texto, setTexto] = useState(entrada?.texto ?? "");
  const [original, setOriginal] = useState<string | null>(entrada?.texto_original ?? null);
  const [meteo, setMeteo] = useState(entrada?.meteo ?? "");
  const [personal, setPersonal] = useState<string>(entrada?.personal?.toString() ?? "");
  const [estado, setEstado] = useState<"" | "guardando" | "redactando">("");
  const [aviso, setAviso] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [escuchando, setEscuchando] = useState(false);
  const [provisional, setProvisional] = useState("");
  // en el servidor no hay reconocimiento de voz; en el cliente depende del navegador
  const hayVoz = useSyncExternalStore(() => () => {}, () => !!constructorVoz(), () => false);
  const vozRef = useRef<ReconocimientoVoz | null>(null);

  useEffect(() => () => vozRef.current?.stop(), []);

  function dictar() {
    if (escuchando) { vozRef.current?.stop(); return; }
    const C = constructorVoz();
    if (!C) return;
    const r = new C();
    r.lang = "es-ES";
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (ev) => {
      let fin = "", prov = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const t = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) fin += t; else prov += t;
      }
      if (fin) setTexto((prev) => (prev.trimEnd() ? `${prev.trimEnd()} ${fin.trim()}` : fin.trim()));
      setProvisional(prov);
    };
    r.onerror = (ev) => { setAviso({ tipo: "error", texto: ev.error === "not-allowed" ? "No hay permiso para usar el micrófono" : `Dictado: ${ev.error}` }); };
    r.onend = () => { setEscuchando(false); setProvisional(""); vozRef.current = null; };
    vozRef.current = r;
    setAviso(null);
    setEscuchando(true);
    r.start();
  }

  async function mejorar() {
    if (!texto.trim()) return;
    setEstado("redactando");
    setAviso(null);
    try {
      const nuevo = await mejorarTexto(texto);
      setOriginal(texto);
      setTexto(nuevo);
    } catch (e) {
      setAviso({ tipo: "error", texto: (e as Error).message });
    } finally {
      setEstado("");
    }
  }

  async function guardar() {
    if (!texto.trim()) { setAviso({ tipo: "error", texto: "Escribe o dicta algo antes de guardar" }); return; }
    vozRef.current?.stop();
    setEstado("guardando");
    setAviso(null);
    try {
      await guardarEntrada(obraId, { id: entrada?.id, fecha, texto, texto_original: original, meteo: meteo || null, personal: personal ? Number(personal) : null });
      if (!entrada) { setTexto(""); setOriginal(null); setMeteo(""); setPersonal(""); }
      setAviso({ tipo: "ok", texto: "Guardado" });
      onGuardado?.();
      router.refresh();
    } catch (e) {
      setAviso({ tipo: "error", texto: (e as Error).message });
    } finally {
      setEstado("");
    }
  }

  const ocupado = estado !== "";
  return (
    <div className={`grid gap-2 ${compacto ? "" : "card card-pad"}`}>
      <div className={`grid gap-2 ${compacto ? "sm:grid-cols-[auto_auto_auto_1fr]" : "sm:grid-cols-3"}`}>
        <label className="campo">Fecha<input className="input" type="date" value={fecha} max={hoyISO()} onChange={(e) => setFecha(e.target.value)} /></label>
        <label className="campo">Tiempo
          <select className="select" value={meteo} onChange={(e) => setMeteo(e.target.value)}>
            <option value="">—</option>
            {METEOS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label className="campo">Personal en obra<input className="input !w-28" type="number" min={0} inputMode="numeric" value={personal} onChange={(e) => setPersonal(e.target.value)} /></label>
      </div>
      <textarea className={`input ${compacto ? "min-h-24" : "min-h-36"}`} value={texto} onChange={(e) => setTexto(e.target.value)}
                placeholder="Qué se ha hecho hoy, gremios en obra, incidencias, visitas, material recibido…" />
      {provisional && <span className="muted text-sm italic">{provisional}</span>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={`btn ${escuchando ? "on" : ""}`} onClick={dictar} disabled={!hayVoz || ocupado}
                title={hayVoz ? "Dictar con el micrófono" : "Tu navegador no permite dictado; usa Chrome o Safari"}>
          {escuchando ? "● Escuchando… (pulsa para parar)" : "Dictar"}
        </button>
        <button type="button" className="btn" onClick={mejorar} disabled={ocupado || !texto.trim()}>{estado === "redactando" ? "Redactando…" : "Mejorar con IA"}</button>
        {original != null && original !== texto && (
          <button type="button" className="btn btn-sm" onClick={() => { setTexto(original); setOriginal(null); }}>Deshacer mejora</button>
        )}
        <span className="flex-1" />
        {aviso && <span className={`chip ${aviso.tipo === "ok" ? "chip-ok" : "chip-late"}`}>{aviso.texto}</span>}
        {onCancelar && <button type="button" className="btn" onClick={onCancelar}>Cancelar</button>}
        <button type="button" className="btn btn-primary" onClick={guardar} disabled={ocupado}>{estado === "guardando" ? "Guardando…" : entrada ? "Guardar cambios" : "Guardar"}</button>
      </div>
    </div>
  );
}
