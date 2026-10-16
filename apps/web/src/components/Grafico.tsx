"use client";
import { useEffect, useRef } from "react";
import type { EChartsOption } from "echarts";

/** Gráfico ECharts que se adapta al tamaño de su contenedor. */
export function Grafico({ opcion, alto = 320, className }: { opcion: EChartsOption; alto?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let vivo = true;
    let grafico: import("echarts").ECharts | null = null;
    let obs: ResizeObserver | null = null;
    import("echarts").then((ec) => {
      if (!vivo || !ref.current) return;
      grafico = ec.init(ref.current, null, { renderer: "svg" });
      grafico.setOption({ textStyle: { fontFamily: "IBM Plex Sans, sans-serif" }, animation: false, ...opcion });
      obs = new ResizeObserver(() => grafico?.resize());
      obs.observe(ref.current);
    });
    return () => {
      vivo = false;
      obs?.disconnect();
      grafico?.dispose();
    };
  }, [opcion]);
  return <div ref={ref} className={className} style={{ height: alto, width: "100%" }} />;
}
