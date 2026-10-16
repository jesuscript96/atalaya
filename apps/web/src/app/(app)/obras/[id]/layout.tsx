import { cargarObra } from "@/lib/datos";
import { Pestanas } from "./Pestanas";

export default async function ObraLayout({ children, params }: LayoutProps<"/obras/[id]">) {
  const { id } = await params;
  const obra = await cargarObra(id);
  return (
    <div className="flex-1 flex flex-col">
      <div className="no-print px-4 md:px-6 pt-4 bg-[var(--surface)] border-b border-[var(--line)]">
        <p className="eyebrow">{obra.cliente ?? "Obra"}</p>
        <h1 className="text-[1.35rem]">{obra.nombre}</h1>
        <Pestanas id={id} />
      </div>
      <div className="flex-1 flex flex-col">{children}</div>
    </div>
  );
}
