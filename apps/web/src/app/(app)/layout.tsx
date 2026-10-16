import Link from "next/link";
import { Marca } from "@/components/Marca";
import { DEMO } from "@/lib/demo/consulta";
import { salir } from "../login/actions";
import { ReiniciarDemo } from "./ReiniciarDemo";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <header className="no-print flex items-center gap-4 px-4 h-14" style={{ background: "var(--rail)", color: "var(--rail-ink)" }}>
        <Link href="/" aria-label="Obras"><Marca claro /></Link>
        <nav className="flex-1 text-sm">
          <Link href="/" className="hover:text-white">Obras</Link>
        </nav>
        {DEMO ? <ReiniciarDemo /> : (
          <form action={salir}>
            <button className="text-sm hover:text-white">Salir</button>
          </form>
        )}
      </header>
      <div className="flex-1 flex flex-col">{children}</div>
    </>
  );
}
