import Link from "next/link";
import { cargarDatos } from "@/lib/datos";
import { Presupuesto } from "./Presupuesto";

export const metadata = { title: "Presupuesto" };

export default async function Pagina({ params }: PageProps<"/obras/[id]/presupuesto">) {
  const { id } = await params;
  const datos = await cargarDatos(id);
  if (!datos.partidas.length) {
    return (
      <main className="p-6 max-w-xl mx-auto w-full">
        <div className="card card-pad text-center py-12">
          <h2>Sin presupuesto</h2>
          <p className="muted mt-1">Sube el presupuesto (BC3, Excel o PDF) en <Link className="underline" href={`/obras/${id}/documentos`}>Documentos</Link>.</p>
        </div>
      </main>
    );
  }
  return <Presupuesto datos={datos} />;
}
