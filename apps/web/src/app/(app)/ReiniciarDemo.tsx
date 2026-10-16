"use client";
import { useTransition } from "react";
import { reiniciarDemo } from "@/lib/demo/acciones";

export function ReiniciarDemo() {
  const [pend, start] = useTransition();
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="chip !bg-[var(--hivis)] !text-[#15212a]">Demo</span>
      <button className="hover:text-white" disabled={pend}
              onClick={() => confirm("¿Volver la demo a su estado inicial? Se pierden las marcas, anotaciones y fotos de esta visita.") && start(() => reiniciarDemo())}>
        {pend ? "Restableciendo…" : "Restablecer"}
      </button>
    </div>
  );
}
