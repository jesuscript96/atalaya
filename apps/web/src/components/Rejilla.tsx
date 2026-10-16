"use client";
// Rejilla tipo hoja de cálculo (AG Grid) con el aspecto de la app.
import { AllCommunityModule, ModuleRegistry, themeQuartz } from "ag-grid-community";
import { AgGridReact, type AgGridReactProps } from "ag-grid-react";

ModuleRegistry.registerModules([AllCommunityModule]);

export const tema = themeQuartz.withParams({
  fontFamily: "var(--f-body)",
  fontSize: 13,
  headerFontWeight: 600,
  headerBackgroundColor: "#e3e7e5",
  foregroundColor: "#15212a",
  borderColor: "#d0d6d3",
  accentColor: "#1c5f8f",
  rowHeight: 38,
  headerHeight: 40,
  spacing: 6,
  wrapperBorderRadius: 6,
});

export function Rejilla<T>(props: AgGridReactProps<T>) {
  return <AgGridReact<T> theme={tema} localeText={LOCALE} containerStyle={{ position: "absolute", inset: 0 }} {...props} />;
}

const LOCALE = {
  noRowsToShow: "Sin filas",
  loadingOoo: "Cargando…",
  filterOoo: "Filtrar…",
  contains: "Contiene",
  equals: "Igual a",
  notEqual: "Distinto de",
  startsWith: "Empieza por",
  endsWith: "Acaba en",
  lessThan: "Menor que",
  greaterThan: "Mayor que",
  andCondition: "Y",
  orCondition: "O",
  pinColumn: "Fijar columna",
  autosizeThisColumn: "Ajustar esta columna",
  resetColumns: "Restablecer columnas",
};
