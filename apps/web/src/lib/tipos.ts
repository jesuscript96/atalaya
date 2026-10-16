export type Ajustes = {
  gg: number;
  bi: number;
  iva: number;
  retencion: number;
  aplicar: { gg: boolean; bi: boolean; iva: boolean; retencion: boolean };
  criterio?: "porcentaje" | "medicion";
  coeficiente_contratista?: number;
  coeficiente?: number; // aplicado en una certificación cerrada
};

export type Obra = {
  id: string;
  nombre: string;
  direccion: string | null;
  cliente: string | null;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  ajustes: Ajustes;
  created_at: string;
};

export type Documento = {
  id: string;
  obra_id: string;
  tipo: "planos" | "presupuesto" | "memoria" | "planificacion" | "otro";
  nombre: string;
  ruta: string;
  tamano: number | null;
  estado: "pendiente" | "procesando" | "listo" | "error";
  mensaje: string | null;
  resumen: Record<string, unknown> | null;
  created_at: string;
};

export type Hoja = {
  id: string;
  pagina: number;
  titulo: string;
  disciplina: string;
  escala: number | null;
  ancho_m: number;
  alto_m: number;
  imagen: string | null;
  principal: boolean;
  orden: number;
  encuadre: "planta" | "propio"; // planta: comparte encuadre con las demás plantas; propio: alzados, secciones…
};

export type Vivienda = {
  id: string;
  codigo: string;
  superficie_util: number | null;
  superficie_detectada: number | null;
  geojson: GeoJSON.Geometry | null;
};

export type Capitulo = { id: string; codigo: string; nombre: string; orden: number };

export type Partida = {
  id: string;
  capitulo_id: string;
  codigo: string;
  resumen: string;
  descripcion: string | null;
  unidad: string;
  medicion: number;
  precio: number;
  orden: number;
};

export type TipoElemento = {
  id: string;
  clave: string;
  nombre: string;
  categoria: string;
  geometria: "linea" | "poligono" | "punto";
  color: string;
  orden: number;
};

export type Magnitud = "longitud" | "superficie_pared" | "superficie" | "perimetro" | "perimetro_altura" | "unidad";
/** A qué elementos del tipo aplica el trabajo. */
export type Ambito = "todas" | "humedas" | "banos" | "cocinas" | "viviendas" | "comunes";
/** Uso de una estancia (o del elemento según la estancia en la que está). */
export type Uso = "bano" | "cocina" | "lavadero" | "dormitorio" | "salon" | "paso" | "comun";

export type Trabajo = {
  id: string;
  tipo_id: string;
  partida_id: string | null;
  partida_humeda_id: string | null;
  nombre: string;
  magnitud: Magnitud;
  factor: number;
  ambito: Ambito;
  filtro: string | null; // texto que debe contener la etiqueta del elemento (p. ej. «72» para puertas de 72)
  orden: number;
};

export type Fase = { id: string; trabajo_id: string; nombre: string; peso: number; orden: number };

export type Elemento = {
  id: string;
  tipo_id: string;
  hoja_id: string | null; // null: hojas de planta; una hoja concreta: solo se ve en ella (alzados…)
  vivienda: string | null;
  etiqueta: string | null;
  uso: Uso | null;
  geojson: GeoJSON.Geometry;
  longitud: number | null;
  superficie: number | null;
  altura: number | null;
  humedo: boolean;
  origen: "plano" | "manual";
  datos: Record<string, unknown>;
};

export type Avance = {
  id: number;
  elemento_id: string;
  fase_id: string;
  porcentaje: number;
  fecha: string;
  created_at: string;
  nota: string | null;
};

export type AvanceManual = {
  id: number;
  partida_id: string;
  cantidad: number;
  fecha: string;
  created_at: string;
  nota: string | null;
};

export type Planificacion = { id: string; capitulo_id: string; inicio: string; fin: string };

export type LineaCertificacion = {
  partida_id: string;
  capitulo_id: string;
  codigo: string;
  resumen: string;
  unidad: string;
  precio: number;
  medicion: number;
  anterior: number;
  origen: number;
};

export type TotalesCertificacion = {
  pem_origen: number;
  pem_anterior: number;
  pem_periodo: number;
  gg: number;
  bi: number;
  base: number;
  iva: number;
  retencion: number;
  total: number;
};

export type Certificacion = {
  id: string;
  destinatario: "cliente" | "contratista";
  numero: number;
  periodo: string;
  fecha_cierre: string;
  ajustes: Ajustes;
  lineas: LineaCertificacion[];
  totales: TotalesCertificacion;
  created_at: string;
};

/** Todo lo que hace falta para calcular el avance de una obra. */
export type DatosObra = {
  obra: Obra;
  capitulos: Capitulo[];
  partidas: Partida[];
  tipos: TipoElemento[];
  trabajos: Trabajo[];
  fases: Fase[];
  elementos: Elemento[];
  avances: Avance[];
  manuales: AvanceManual[];
  planificacion: Planificacion[];
  viviendas: Vivienda[];
};

export type Diario = {
  id: string;
  obra_id: string;
  fecha: string;
  texto: string;
  texto_original: string | null;
  meteo: string | null;
  personal: number | null;
  created_at: string;
  updated_at: string;
};

export type Foto = {
  id: string;
  obra_id: string;
  ruta: string;
  miniatura: string | null;
  fecha: string;
  vivienda: string | null;
  estancia: string | null;
  nota: string | null;
  ancho: number | null;
  alto: number | null;
  created_at: string;
};
