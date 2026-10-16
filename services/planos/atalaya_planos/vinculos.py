"""Vinculación automática entre partidas del presupuesto y elementos del plano.

Cada regla reconoce una partida por su texto y crea un «trabajo» sobre un tipo de elemento, con su forma de medir,
su ámbito (todas las estancias, solo baños, solo cocinas, por vivienda, zonas comunes) y sus fases.
Lo que no encaja en ninguna regla queda como partida de avance manual.

Tipos de elemento: TB/MD/TS… tabiques (línea), EST estancia (polígono), VIV vivienda (polígono),
PI/PE puerta interior/exterior y VE ventana (punto).
"""
from __future__ import annotations

import re
import unicodedata

FASES = {
    "tabique": [("Perfilería", 0.20), ("Primera placa", 0.20), ("Instalaciones", 0.0), ("Aislamiento", 0.10),
                ("Cierre de placas", 0.30), ("Encintado y juntas", 0.20)],
    "trasdosado": [("Perfilería", 0.25), ("Aislamiento", 0.15), ("Placas", 0.40), ("Encintado y juntas", 0.20)],
    "falso_techo": [("Perfilería", 0.35), ("Placas", 0.45), ("Encintado y juntas", 0.20)],
    "nivelante": [("Nivelante", 1.0)],
    "solado": [("Solado", 1.0)],
    "alicatado": [("Alicatado", 1.0)],
    "pintura": [("Pintura", 1.0)],
    "rodapie": [("Rodapié", 1.0)],
    "electricidad": [("Tubos y cajas", 0.40), ("Cableado", 0.30), ("Mecanismos", 0.30)],
    "fontaneria": [("Tuberías", 0.60), ("Aparatos y pruebas", 0.40)],
    "saneamiento": [("Colectores", 0.60), ("Pruebas", 0.40)],
    "clima": [("Preinstalación", 0.70), ("Equipos", 0.30)],
    "carpinteria_ext": [("Premarco", 0.30), ("Hoja", 0.50), ("Persiana y remates", 0.20)],
    "puerta": [("Premarco", 0.30), ("Hoja y herrajes", 0.70)],
    "unidad": [("Instalado", 1.0)],
}

# Partidas que nunca se miden sobre el plano de proyecto (lo demolido no está dibujado, ni lo exterior)
EXCLUIR = r"demolici|desmontaje|retirada|levantado|exterior|fachada|patio|residuo|limpieza|gestion|transporte"
DEMOLICION = r"demolici|desmontaje|retirada|levantado"   # para las reglas que sí admiten «exterior»


def _R(patron, claves, nombre, plantilla, magnitud="unidad", factores=None, ambito="todas", orden=100, filtro=None, excluir=None):
    return {"patron": patron, "claves": claves, "nombre": nombre, "plantilla": plantilla, "magnitud": magnitud,
            "factores": factores or {}, "ambito": ambito, "orden": orden, "filtro": filtro, "excluir": excluir}


# El orden importa: la primera regla que reconoce una partida se la queda.
REGLAS = [
    # ── Albañilería (sobre el plano) ──
    _R(r"trasdosado", ["TS"], "Trasdosado", "trasdosado", "superficie_pared", orden=10, excluir=DEMOLICION),
    _R(r"tabique sencillo", ["TB"], "Tabique", "tabique", "superficie_pared", orden=10),
    _R(r"tabique.*medianer|medianera entre", ["MD"], "Tabique medianero", "tabique", "superficie_pared", orden=10),
    _R(r"falso techo", ["EST"], "Falso techo", "falso_techo", "superficie", orden=30),
    # ── Pavimentos y revestimientos ──
    _R(r"autonivelante|nivelante|recrecido", ["EST"], "Nivelante", "nivelante", "superficie", orden=20),
    _R(r"pavimento|solado|gres|tarima|laminado", ["EST"], "Solado", "solado", "superficie", orden=25),
    _R(r"rodapie", ["EST"], "Rodapié", "rodapie", "perimetro", orden=50),
    _R(r"alicatado", ["EST"], "Alicatado", "alicatado", "perimetro_altura", ambito="banos", orden=40),
    _R(r"pintura.*(interior|paredes y techos)", ["TB", "MD", "TS", "EST"], "Pintura", "pintura", None,
       {"TB": ("superficie_pared", 2), "MD": ("superficie_pared", 2), "TS": ("superficie_pared", 1), "EST": ("superficie", 1)}, orden=90),
    # ── Carpinterías (puntos; si no hay puertas en el plano, por vivienda) ──
    _R(r"puerta.*(72|725)", ["PI", "VIV"], "Puerta interior 72", "puerta", orden=60, filtro="72"),
    _R(r"puerta.*(82|825)", ["PI", "VIV"], "Puerta interior 82", "puerta", orden=60, filtro="82"),
    _R(r"puerta.*(62|625)", ["PI", "VIV"], "Puerta interior 62", "puerta", orden=60, filtro="62"),
    _R(r"puerta.*(interior|paso|abatible|corredera)", ["PI", "VIV"], "Puertas interiores", "puerta", orden=60),
    _R(r"puerta.*(entrada|acorazada|blindada|exterior)", ["PE", "VIV"], "Puerta de entrada", "puerta", orden=61, excluir=DEMOLICION),
    _R(r"carpinteria.*(pvc|aluminio|exterior)|ventana|balconera", ["VE", "VIV"], "Carpintería exterior", "carpinteria_ext", orden=62, excluir=DEMOLICION),
    # ── Instalaciones por vivienda ──
    _R(r"instalacion electrica|electricidad.*vivienda", ["VIV"], "Instalación eléctrica", "electricidad", ambito="viviendas", orden=70),
    _R(r"preinstalacion.*clima|climatizacion|aire acondicionado|aerotermia|bomba de calor", ["VIV"], "Climatización", "clima", ambito="viviendas", orden=71),
    _R(r"portero|videoportero", ["VIV"], "Portero automático", "unidad", ambito="viviendas", orden=72),
    _R(r"boletin", ["VIV"], "Boletín eléctrico", "unidad", ambito="viviendas", orden=73),
    _R(r"cuadro general|cuarto.*contadores|acometida|hornacina|contadores", ["VIV"], "Acometidas y contadores", "unidad", ambito="comunes", orden=74),
    _R(r"saneamiento.*vivienda|red de saneamiento", ["VIV"], "Saneamiento de vivienda", "saneamiento", ambito="viviendas", orden=75),
    _R(r"patinillo|zonas? comunes|escalera|portal", ["VIV"], "Trabajos en zonas comunes", "unidad", ambito="comunes", orden=74),
    _R(r"ventilacion|turbina|extraccion|conductos", ["VIV"], "Ventilación", "unidad", ambito="viviendas", orden=76),
    _R(r"muebles? aerotermo", ["EST"], "Mueble del aerotermo", "unidad", ambito="cocinas", orden=101),
    _R(r"aerotermo|termo electrico|calentador|caldera", ["VIV"], "Producción de agua caliente", "unidad", ambito="viviendas", orden=77),
    _R(r"rejilla", ["VIV"], "Rejillas", "unidad", ambito="viviendas", orden=78),
    # ── Fontanería y equipamiento de baño (sobre la estancia) ──
    _R(r"instalacion interior.*(bano|aseo)|fontaneria.*bano", ["EST"], "Fontanería de baño", "fontaneria", ambito="banos", orden=80),
    _R(r"instalacion interior.*cocina|fontaneria.*cocina", ["EST"], "Fontanería de cocina", "fontaneria", ambito="cocinas", orden=81),
    _R(r"plato de ducha|plato ducha|banera", ["EST"], "Plato de ducha", "unidad", ambito="banos", orden=82),
    _R(r"mampara", ["EST"], "Mampara", "unidad", ambito="banos", orden=83),
    _R(r"inodoro", ["EST"], "Inodoro", "unidad", ambito="banos", orden=84),
    _R(r"griferia.*ducha|griferia.*bano", ["EST"], "Grifería de ducha", "unidad", ambito="banos", orden=86),
    _R(r"griferia.*lavabo", ["EST"], "Grifería de lavabo", "unidad", ambito="banos", orden=87),
    _R(r"lavabo|mueble de bano|espejo", ["EST"], "Lavabo y mueble", "unidad", ambito="banos", orden=85),
    _R(r"complementos.*bano|accesorios.*bano", ["EST"], "Complementos de baño", "unidad", ambito="banos", orden=88),
    # ── Cocina (sobre la estancia) ──
    _R(r"amueblamiento.*cocina|muebles.*cocina|mobiliario.*cocina", ["EST"], "Muebles de cocina", "unidad", ambito="cocinas", orden=100),
    _R(r"encimera", ["EST"], "Encimera", "unidad", ambito="cocinas", orden=102),
    _R(r"nevera|frigorifico", ["EST"], "Nevera", "unidad", ambito="cocinas", orden=103),
    _R(r"lavadora|lavavajillas", ["EST"], "Lavadora", "unidad", ambito="cocinas", orden=104),
    _R(r"horno", ["EST"], "Horno", "unidad", ambito="cocinas", orden=105),
    _R(r"placa.*(vitro|induccion)|vitroceramica", ["EST"], "Placa de cocción", "unidad", ambito="cocinas", orden=106),
    _R(r"campana", ["EST"], "Campana extractora", "unidad", ambito="cocinas", orden=107),
    _R(r"fregadero", ["EST"], "Fregadero", "unidad", ambito="cocinas", orden=108),
    _R(r"grifo|griferia", ["EST"], "Grifo de cocina", "unidad", ambito="cocinas", orden=109),
]


def _norm(t: str) -> str:
    t = unicodedata.normalize("NFKD", t.lower())
    return "".join(c for c in t if not unicodedata.combining(c))


def es_variante_humeda(resumen: str) -> bool:
    """«Tabique sencillo con lana de roca H», «Falso techo H continuo…», «Trasdosado autoportante H …»."""
    return bool(re.search(r"(^|\s)h(\s|$)", resumen.lower())) or "hidrofug" in _norm(resumen)


def base_sin_h(resumen: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"(^|\s)h(?=\s|$)", " ", resumen.lower())).strip()


def _elementos_del_ambito(clave: str, ambito: str, conteo: dict[str, int]) -> int:
    """Cuántos elementos de ese tipo entran en el ámbito (para repartir las unidades del presupuesto)."""
    if clave == "VIV":
        return conteo.get("VIV:comunes" if ambito == "comunes" else "VIV:viviendas", 0)
    if clave == "EST":
        return conteo.get("EST", 0) if ambito == "todas" else conteo.get(f"EST:{ambito}", 0)
    return conteo.get(clave, 0)


def proponer(partidas: list[dict], tipos_presentes: set[str], conteo: dict[str, int] | None = None) -> list[dict]:
    return proponer_con_avisos(partidas, tipos_presentes, conteo)[0]


def proponer_con_avisos(partidas: list[dict], tipos_presentes: set[str], conteo: dict[str, int] | None = None) -> tuple[list[dict], list[str]]:
    """partidas: [{id, resumen, unidad?, medicion?}] → (trabajos propuestos con sus fases, avisos).

    conteo: nº de elementos por tipo y ámbito ({"VIV:viviendas": 5, "EST:banos": 5, "PI": 12…}) para repartir las
    partidas por unidad (p. ej. 5 ud de inodoro entre 5 baños → 1 por baño; 10 ud entre 5 → 2 por baño).
    """
    conteo = conteo or {}
    trabajos = []
    usadas = set()
    avisos = []
    for regla in REGLAS:
        excluir = EXCLUIR if regla["excluir"] is None else regla["excluir"]
        cand = [p for p in partidas if re.search(regla["patron"], _norm(p["resumen"])) and p["id"] not in usadas
                and not (excluir and re.search(excluir, _norm(p["resumen"])))]
        if not cand:
            continue
        # tipo sobre el que se crea: el primero presente en el plano (p. ej. PI si hay puertas; si no, VIV)
        claves = [c for c in regla["claves"] if c in tipos_presentes]
        if not claves:
            continue
        if regla["magnitud"] is not None and len(regla["claves"]) > 1 and regla["magnitud"] == "unidad":
            claves = claves[:1]
        # empareja variante normal y húmeda por nombre base
        grupos: dict[str, dict] = {}
        for p in cand:
            g = grupos.setdefault(base_sin_h(p["resumen"]), {"normal": None, "humeda": None})
            g["humeda" if es_variante_humeda(p["resumen"]) else "normal"] = p
        for g in grupos.values():
            principal = g["normal"] or g["humeda"]
            humeda = g["humeda"] if g["normal"] else None
            for clave in claves:
                mag, fac = regla["factores"].get(clave, (regla["magnitud"], 1))
                ambito = regla["ambito"]
                if clave == "VIV" and ambito == "todas":
                    ambito = "viviendas"
                nombre = regla["nombre"]
                filtro = regla["filtro"] if clave in ("PI", "PE", "VE") else None
                if mag == "unidad":
                    # reparto: medición del presupuesto entre los elementos del ámbito
                    n = _elementos_del_ambito(clave, ambito, conteo)
                    med = float(principal.get("medicion") or 0)
                    if n > 0 and med > 0 and clave in ("VIV", "EST"):
                        fac = round(med / n, 3)
                        if abs(fac - round(fac)) > 1e-6:
                            avisos.append(f"{principal['resumen'][:50]}: {med:g} ud repartidas entre {n} → {fac:g} por unidad; revísalo en Configuración")
                    elif n > 0 and med > 0 and clave in ("PI", "PE", "VE") and not filtro and med < n * 0.5:
                        avisos.append(f"{principal['resumen'][:50]}: {med:g} ud en presupuesto y {n} en plano")
                trabajos.append({
                    "tipo": clave, "nombre": nombre, "partida_id": principal["id"],
                    "partida_humeda_id": humeda["id"] if humeda else None,
                    "magnitud": mag, "factor": fac, "ambito": ambito, "filtro": filtro, "orden": regla["orden"],
                    "fases": [{"nombre": n_, "peso": w, "orden": i} for i, (n_, w) in enumerate(FASES[regla["plantilla"]])],
                })
            usadas.add(principal["id"])
            if humeda:
                usadas.add(humeda["id"])
    # la pintura sobre estancias es la del techo
    for t in trabajos:
        if t["tipo"] == "EST" and t["nombre"] == "Pintura":
            t["nombre"] = "Pintura de techo"
    return trabajos, avisos
