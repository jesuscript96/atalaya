"use client";
import { useTransition } from "react";
import { borrarCertificacion } from "../acciones";

export function BorrarCertificacion({ obraId, id }: { obraId: string; id: string }) {
  const [pendiente, start] = useTransition();
  return (
    <button className="btn btn-danger" disabled={pendiente}
            onClick={() => confirm("¿Borrar esta certificación? Se podrá volver a cerrar el mes.") && start(() => borrarCertificacion(obraId, id))}>
      Borrar
    </button>
  );
}
