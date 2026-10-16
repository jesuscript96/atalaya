"use client";
import { useMemo } from "react";
import { Grafico } from "./Grafico";
import type { PuntoCurva } from "@/lib/calculo";

const mes = (p: string) => new Date(`${p}-15T00:00:00Z`).toLocaleDateString("es-ES", { month: "short", year: "2-digit", timeZone: "UTC" });

export function CurvaAvance({ puntos, alto = 300 }: { puntos: PuntoCurva[]; alto?: number }) {
  const opcion = useMemo(() => ({
    grid: { left: 44, right: 16, top: 30, bottom: 30 },
    legend: { top: 0, right: 0, data: ["Previsto", "Real"] },
    tooltip: { trigger: "axis" as const, valueFormatter: (v: unknown) => (v == null ? "—" : `${(Number(v) * 100).toFixed(1)} %`) },
    xAxis: { type: "category" as const, data: puntos.map((p) => mes(p.periodo)), boundaryGap: false, axisLine: { lineStyle: { color: "#a3adb3" } } },
    yAxis: { type: "value" as const, min: 0, max: 1, axisLabel: { formatter: (v: number) => `${Math.round(v * 100)}%` }, splitLine: { lineStyle: { color: "#e3e7e5" } } },
    series: [
      { name: "Previsto", type: "line" as const, data: puntos.map((p) => p.previsto), symbol: "none", lineStyle: { type: "dashed" as const, color: "#7a868d", width: 2 }, itemStyle: { color: "#7a868d" } },
      { name: "Real", type: "line" as const, data: puntos.map((p) => p.real), symbolSize: 7, lineStyle: { color: "#1c5f8f", width: 3 }, itemStyle: { color: "#1c5f8f" }, areaStyle: { color: "rgba(28,95,143,.08)" } },
    ],
  }), [puntos]);
  if (!puntos.length) return <p className="muted text-sm py-10 text-center">Indica las fechas de la obra en Configuración para ver la curva.</p>;
  return <Grafico opcion={opcion} alto={alto} />;
}
