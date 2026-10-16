"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const PESTANAS = [
  ["", "Panel"],
  ["/planos", "Planos"],
  ["/presupuesto", "Presupuesto"],
  ["/interiores", "Interiores"],
  ["/certificaciones", "Certificaciones"],
  ["/informe", "Informe mensual"],
  ["/diario", "Diario"],
  ["/fotos", "Fotos"],
  ["/documentos", "Documentos"],
  ["/configuracion", "Configuración"],
] as const;

export function Pestanas({ id }: { id: string }) {
  const ruta = usePathname();
  const base = `/obras/${id}`;
  return (
    <nav className="tabs -mb-px mt-2">
      {PESTANAS.map(([sub, nombre]) => {
        const href = base + sub;
        const on = sub ? ruta.startsWith(href) : ruta === base;
        return (
          <Link key={sub} href={href} className={on ? "on" : ""}>
            {nombre}
          </Link>
        );
      })}
    </nav>
  );
}
