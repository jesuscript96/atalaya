"use client";
import { usePathname, useRouter } from "next/navigation";
import { nombreMes } from "@/lib/calculo";

export function SelectorMes({ valor, opciones }: { valor: string; opciones: string[] }) {
  const router = useRouter();
  const ruta = usePathname();
  const lista = opciones.includes(valor) ? opciones : [valor, ...opciones];
  return (
    <label className="campo !flex-row items-center gap-2">Mes
      <select className="select !w-52" value={valor} onChange={(e) => router.push(`${ruta}?mes=${e.target.value}`)}>
        {lista.map((m) => <option key={m} value={m}>{nombreMes(m, true)}</option>)}
      </select>
    </label>
  );
}
