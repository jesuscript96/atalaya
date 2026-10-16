import Link from "next/link";
import { notFound } from "next/navigation";
import { BotonesDocumento } from "@/components/BotonesDocumento";
import { cargarDatos } from "@/lib/datos";
import { eur, finDeMes, nombreMes, num } from "@/lib/calculo";
import { EUR, NUM } from "@/lib/excel";
import { supabaseServidor } from "@/lib/supabase/server";
import type { Certificacion } from "@/lib/tipos";
import { BorrarCertificacion } from "./BorrarCertificacion";

export const metadata = { title: "Certificación" };

export default async function Pagina({ params }: PageProps<"/obras/[id]/certificaciones/[cid]">) {
  const { id, cid } = await params;
  const sb = await supabaseServidor();
  const [d, { data }, { data: siguientes }] = await Promise.all([
    cargarDatos(id),
    sb.from("certificaciones").select("*").eq("id", cid).maybeSingle(),
    sb.from("certificaciones").select("id,numero,destinatario").eq("obra_id", id),
  ]);
  if (!data) notFound();
  const c = data as Certificacion;
  const esUltima = !(siguientes ?? []).some((s) => s.destinatario === c.destinatario && s.numero > c.numero);
  const coef = Number(c.ajustes.coeficiente ?? 1);
  const a = c.ajustes;
  const t = c.totales;
  const caps = d.capitulos
    .map((cap) => ({ cap, lineas: c.lineas.filter((l) => l.capitulo_id === cap.id && (l.origen || l.anterior)) }))
    .filter((g) => g.lineas.length);
  const imp = (q: number, p: number) => q * p * coef;

  const filasX: (string | number | null)[][] = [];
  const negrita: number[] = [];
  for (const g of caps) {
    negrita.push(filasX.length);
    filasX.push([g.cap.codigo, g.cap.nombre, "", null, null, null, null, null, g.lineas.reduce((s, l) => s + imp(l.origen - l.anterior, l.precio), 0), g.lineas.reduce((s, l) => s + imp(l.origen, l.precio), 0)]);
    for (const l of g.lineas) filasX.push([l.codigo, l.resumen, l.unidad, l.precio * coef, l.medicion, l.anterior, l.origen - l.anterior, l.origen, imp(l.origen - l.anterior, l.precio), imp(l.origen, l.precio)]);
  }
  const titulo = `Certificación nº ${c.numero} · ${nombreMes(c.periodo)}`;

  return (
    <main className="w-full max-w-5xl mx-auto p-4 md:p-6 grid gap-4">
      <div className="no-print flex flex-wrap items-center gap-3">
        <Link href={`/obras/${id}/certificaciones`} className="btn btn-sm">← Certificaciones</Link>
        <div className="ml-auto">
          <BotonesDocumento
            excel={{
              nombre: `${d.obra.nombre} - Certificación ${c.numero} ${c.periodo}`,
              titulo: [d.obra.nombre, `${titulo} (${c.destinatario})`, `Total: ${eur(t.total)}`],
              columnas: [
                { titulo: "Código", ancho: 10 }, { titulo: "Resumen", ancho: 50 }, { titulo: "Ud", ancho: 6 }, { titulo: "Precio", formato: EUR },
                { titulo: "Medición", formato: NUM }, { titulo: "Anterior", formato: NUM }, { titulo: "Mes", formato: NUM }, { titulo: "Origen", formato: NUM },
                { titulo: "Importe mes", formato: EUR, ancho: 16 }, { titulo: "Importe origen", formato: EUR, ancho: 16 },
              ],
              filas: filasX,
              negrita,
            }}
            extra={esUltima ? <BorrarCertificacion obraId={id} id={c.id} /> : null}
          />
        </div>
      </div>

      <article className="card card-pad grid gap-5 print:shadow-none">
        <header className="flex flex-wrap justify-between gap-4 border-b border-[var(--line)] pb-4">
          <div>
            <p className="eyebrow">Certificación de obra {c.destinatario === "contratista" ? "· contratista" : ""}</p>
            <h1 className="text-2xl">{titulo}</h1>
            <p className="muted">Hasta el {new Date(finDeMes(c.periodo)).toLocaleDateString("es-ES")}</p>
          </div>
          <div className="text-sm text-right">
            <p className="font-semibold">{d.obra.nombre}</p>
            {d.obra.direccion && <p>{d.obra.direccion}</p>}
            {d.obra.cliente && <p>Cliente: {d.obra.cliente}</p>}
          </div>
        </header>

        <table className="tabla !text-[0.8rem]">
          <thead>
            <tr>
              <th>Código</th><th>Resumen</th><th>Ud</th><th className="text-right">Precio</th>
              <th className="text-right">Anterior</th><th className="text-right">Mes</th><th className="text-right">Origen</th>
              <th className="text-right">Importe mes</th><th className="text-right">Importe origen</th>
            </tr>
          </thead>
          <tbody>
            {caps.map((g) => (
              <Capitulo key={g.cap.id} g={g} imp={imp} coef={coef} />
            ))}
          </tbody>
        </table>

        <section className="grid sm:grid-cols-2 gap-6 items-start">
          <div className="text-sm grid gap-10 pt-2">
            <div className="grid grid-cols-2 gap-6">
              <div className="border-t border-[var(--ink-3)] pt-1 muted">La dirección de obra</div>
              <div className="border-t border-[var(--ink-3)] pt-1 muted">Conforme, {c.destinatario === "cliente" ? "la propiedad" : "el contratista"}</div>
            </div>
          </div>
          <table className="tabla">
            <tbody>
              <tr><td>Ejecución material a origen</td><td className="num">{eur(t.pem_origen)}</td></tr>
              <tr><td>A deducir certificado anterior</td><td className="num">− {eur(t.pem_anterior)}</td></tr>
              <tr className="cap"><td>Ejecución material del mes</td><td className="num">{eur(t.pem_periodo)}</td></tr>
              {a.aplicar.gg && <tr><td>Gastos generales {num(a.gg * 100, 0)} %</td><td className="num">{eur(t.gg)}</td></tr>}
              {a.aplicar.bi && <tr><td>Beneficio industrial {num(a.bi * 100, 0)} %</td><td className="num">{eur(t.bi)}</td></tr>}
              {(a.aplicar.gg || a.aplicar.bi) && <tr className="cap"><td>Base</td><td className="num">{eur(t.base)}</td></tr>}
              {a.aplicar.iva && <tr><td>IVA {num(a.iva * 100, 0)} %</td><td className="num">{eur(t.iva)}</td></tr>}
              {a.aplicar.retencion && <tr><td>Retención {num(a.retencion * 100, 0)} %</td><td className="num">− {eur(t.retencion)}</td></tr>}
            </tbody>
            <tfoot><tr><td>TOTAL</td><td className="num text-base">{eur(t.total)}</td></tr></tfoot>
          </table>
        </section>
        <p className="muted text-xs">Cerrada el {new Date(c.created_at).toLocaleString("es-ES")}{coef !== 1 ? ` · coeficiente ${num(coef, 3)}` : ""}.</p>
      </article>
    </main>
  );
}

function Capitulo({ g, imp, coef }: {
  g: { cap: { codigo: string; nombre: string }; lineas: Certificacion["lineas"] }; imp: (q: number, p: number) => number; coef: number;
}) {
  const mes = g.lineas.reduce((s, l) => s + imp(l.origen - l.anterior, l.precio), 0);
  const origen = g.lineas.reduce((s, l) => s + imp(l.origen, l.precio), 0);
  return (
    <>
      <tr className="cap"><td>{g.cap.codigo}</td><td colSpan={6}>{g.cap.nombre}</td><td className="num">{eur(mes)}</td><td className="num">{eur(origen)}</td></tr>
      {g.lineas.map((l) => (
        <tr key={l.partida_id}>
          <td className="mono">{l.codigo}</td><td>{l.resumen}</td><td>{l.unidad}</td>
          <td className="num">{num(l.precio * coef)}</td><td className="num">{num(l.anterior)}</td>
          <td className="num font-semibold">{num(l.origen - l.anterior)}</td><td className="num">{num(l.origen)}</td>
          <td className="num">{eur(imp(l.origen - l.anterior, l.precio))}</td><td className="num">{eur(imp(l.origen, l.precio))}</td>
        </tr>
      ))}
    </>
  );
}
