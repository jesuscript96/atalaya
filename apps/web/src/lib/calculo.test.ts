// Ejecutar con: node --test src/lib/calculo.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { cantidad, enAmbito, lineasCertificacion, matriz, resumenPartidas, totalesCertificacion } from "./calculo.ts";
import type { DatosObra } from "./tipos.ts";

const ajustes = { gg: 0.13, bi: 0.06, iva: 0.1, retencion: 0.05, aplicar: { gg: true, bi: true, iva: true, retencion: true } };
const linea = (coords: number[][]) => ({ type: "LineString", coordinates: coords }) as GeoJSON.Geometry;
const av = (id: number, el: string, fase: string, p: number, fecha: string) =>
  ({ id, elemento_id: el, fase_id: fase, porcentaje: p, fecha, created_at: `${fecha}T10:00:0${id}Z`, nota: null });

function datos(): DatosObra {
  return {
    obra: { id: "o", nombre: "Prueba", direccion: null, cliente: null, fecha_inicio: "2026-01-01", fecha_fin: "2026-12-31", ajustes, created_at: "" },
    capitulos: [{ id: "c1", codigo: "02", nombre: "Tabiquería", orden: 0 }],
    partidas: [
      { id: "p1", capitulo_id: "c1", codigo: "02.05", resumen: "Tabique", descripcion: null, unidad: "m2", medicion: 30, precio: 40, orden: 0 },
      { id: "p2", capitulo_id: "c1", codigo: "02.06", resumen: "Tabique H", descripcion: null, unidad: "m2", medicion: 10, precio: 50, orden: 1 },
      { id: "p3", capitulo_id: "c1", codigo: "02.01", resumen: "Ayudas", descripcion: null, unidad: "pa", medicion: 1, precio: 1000, orden: 2 },
    ],
    tipos: [{ id: "tb", clave: "TB", nombre: "Tabique", categoria: "tabiqueria", geometria: "linea", color: "#f00", orden: 0 }],
    trabajos: [{ id: "t1", tipo_id: "tb", partida_id: "p1", partida_humeda_id: "p2", nombre: "Tabique", magnitud: "superficie_pared", factor: 1, ambito: "todas", filtro: null, orden: 0 }],
    fases: [
      { id: "f1", trabajo_id: "t1", nombre: "Perfilería", peso: 0.2, orden: 0 },
      { id: "f2", trabajo_id: "t1", nombre: "Primera placa", peso: 0.2, orden: 1 },
      { id: "f3", trabajo_id: "t1", nombre: "Resto", peso: 0.6, orden: 2 },
    ],
    elementos: [
      { id: "e1", tipo_id: "tb", hoja_id: null, vivienda: "A01", etiqueta: null, uso: null, geojson: linea([[0, 0], [10, 0]]), longitud: 10, superficie: null, altura: 2.5, humedo: false, origen: "plano", datos: {} },
      { id: "e2", tipo_id: "tb", hoja_id: null, vivienda: "A02", etiqueta: null, uso: null, geojson: linea([[0, 0], [4, 0]]), longitud: 4, superficie: null, altura: 2.5, humedo: true, origen: "plano", datos: {} },
    ],
    avances: [av(1, "e1", "f1", 100, "2026-02-10"), av(2, "e1", "f2", 50, "2026-03-05"), av(3, "e2", "f1", 100, "2026-03-20"), av(4, "e1", "f2", 100, "2026-03-25")],
    manuales: [{ id: 1, partida_id: "p3", cantidad: 0.5, fecha: "2026-02-01", created_at: "2026-02-01T00:00:00Z", nota: null }],
    planificacion: [],
    viviendas: [],
  };
}

test("cantidad de pared: longitud × altura sin descontar huecos", () => {
  const d = datos();
  assert.equal(cantidad(d.elementos[0], d.trabajos[0]), 25);
});

test("% por partida aplicado a la medición del presupuesto, con variante húmeda", () => {
  const d = datos();
  const feb = resumenPartidas(d, "2026-02-28");
  assert.equal(feb.get("p1")!.medicionPlano, 25);
  assert.ok(Math.abs(feb.get("p1")!.porcentaje - 0.2) < 1e-9);
  assert.ok(Math.abs(feb.get("p1")!.cantidad - 6) < 1e-9); // 20 % de 30 m²
  assert.equal(feb.get("p2")!.cantidad, 0);
  assert.equal(feb.get("p3")!.origen, "manual");
  assert.equal(feb.get("p3")!.cantidad, 0.5);
  const mar = resumenPartidas(d, "2026-03-31");
  assert.ok(Math.abs(mar.get("p1")!.porcentaje - 0.4) < 1e-9); // la última marca (100 %) sustituye a la de 50 %
  assert.ok(Math.abs(mar.get("p2")!.cantidad - 2) < 1e-9);     // 20 % de 10 m²
});

test("criterio de medición: certifica lo medido en plano", () => {
  const d = datos();
  d.obra.ajustes = { ...ajustes, criterio: "medicion" };
  assert.ok(Math.abs(resumenPartidas(d, "2026-02-28").get("p1")!.cantidad - 5) < 1e-9);
});

test("certificación: origen − anterior con GG, BI, IVA y retención", () => {
  const d = datos();
  const feb = lineasCertificacion(d, "2026-02-28", null);
  const mar = lineasCertificacion(d, "2026-03-31", feb);
  const l1 = mar.find((l) => l.partida_id === "p1")!;
  assert.equal(l1.anterior, 6);
  assert.equal(l1.origen, 12);
  const t = totalesCertificacion(mar, ajustes);
  // origen 12×40 + 2×50 + 0,5×1000 = 1080; anterior 6×40 + 500 = 740 → periodo 340
  assert.equal(t.pem_periodo, 340);
  assert.equal(t.gg, 44.2);
  assert.equal(t.bi, 20.4);
  assert.equal(t.base, 404.6);
  assert.equal(t.iva, 40.46);
  assert.equal(t.retencion, 20.23);
  assert.equal(t.total, 424.83);
});

test("matriz viviendas × fases", () => {
  const m = matriz(datos(), "2026-03-31");
  assert.deepEqual(m.viviendas, ["A01", "A02"]);
  assert.equal(m.celdas.get("A01|f2")!.porcentaje, 1);
  assert.equal(m.celdas.get("A02|f2")!.porcentaje, 0);
});

test("ámbito y filtro: baños, cocinas, viviendas, comunes y etiqueta", () => {
  const bano = { humedo: true, uso: "bano" as const, vivienda: "A01", etiqueta: "Baño" };
  const cocina = { humedo: false, uso: "cocina" as const, vivienda: "A01", etiqueta: "Salon-cocina" };
  const comun = { humedo: false, uso: "comun" as const, vivienda: "COMUN", etiqueta: "COMUN" };
  const puerta72 = { humedo: false, uso: null, vivienda: "A01", etiqueta: "Puerta 72" };
  assert.equal(enAmbito(bano, { ambito: "banos", filtro: null }), true);
  assert.equal(enAmbito(cocina, { ambito: "banos", filtro: null }), false);
  assert.equal(enAmbito(cocina, { ambito: "cocinas", filtro: null }), true);
  assert.equal(enAmbito(bano, { ambito: "humedas", filtro: null }), true);
  assert.equal(enAmbito(comun, { ambito: "viviendas", filtro: null }), false);
  assert.equal(enAmbito(comun, { ambito: "comunes", filtro: null }), true);
  assert.equal(enAmbito(puerta72, { ambito: "todas", filtro: "72" }), true);
  assert.equal(enAmbito(puerta72, { ambito: "todas", filtro: "82" }), false);
});

test("unidades por vivienda: factor = reparto de la medición", () => {
  const d = datos();
  d.tipos.push({ id: "viv", clave: "VIV", nombre: "Vivienda", categoria: "vivienda", geometria: "poligono", color: "#000", orden: 9 });
  d.partidas.push({ id: "p4", capitulo_id: "c1", codigo: "04.01", resumen: "Instalación eléctrica", descripcion: null, unidad: "ud", medicion: 2, precio: 1000, orden: 3 });
  d.trabajos.push({ id: "t2", tipo_id: "viv", partida_id: "p4", partida_humeda_id: null, nombre: "Instalación eléctrica", magnitud: "unidad", factor: 1, ambito: "viviendas", filtro: null, orden: 70 });
  d.fases.push({ id: "f4", trabajo_id: "t2", nombre: "Tubos", peso: 0.4, orden: 0 }, { id: "f5", trabajo_id: "t2", nombre: "Resto", peso: 0.6, orden: 1 });
  const pol = { type: "Polygon", coordinates: [[[0, 0], [5, 0], [5, 5], [0, 5], [0, 0]]] } as GeoJSON.Geometry;
  d.elementos.push(
    { id: "v1", tipo_id: "viv", hoja_id: null, vivienda: "A01", etiqueta: "A01", uso: null, geojson: pol, longitud: null, superficie: 25, altura: null, humedo: false, origen: "plano", datos: {} },
    { id: "v2", tipo_id: "viv", hoja_id: null, vivienda: "A02", etiqueta: "A02", uso: null, geojson: pol, longitud: null, superficie: 25, altura: null, humedo: false, origen: "plano", datos: {} },
    { id: "vc", tipo_id: "viv", hoja_id: null, vivienda: "COMUN", etiqueta: "COMUN", uso: "comun", geojson: pol, longitud: null, superficie: 25, altura: null, humedo: false, origen: "plano", datos: {} },
  );
  d.avances.push(av(9, "v1", "f4", 100, "2026-04-01"));
  const r = resumenPartidas(d, "2026-04-30").get("p4")!;
  assert.equal(r.medicionPlano, 2); // la vivienda COMUN no cuenta
  assert.ok(Math.abs(r.porcentaje - 0.2) < 1e-9); // 40 % de una de las dos viviendas
  assert.ok(Math.abs(r.cantidad - 0.4) < 1e-9);
});
