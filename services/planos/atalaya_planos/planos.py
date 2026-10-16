"""Interpretación de planos vectoriales en PDF exportados desde CAD.

Salida en metros, en el sistema de la hoja tal como se ve (girada), con el origen abajo a la izquierda
(eje Y hacia arriba), que es el que usa el visor (OpenLayers).
"""
from __future__ import annotations

import collections
import math
import re
from pathlib import Path

import pymupdf
from shapely.geometry import LineString, Point, Polygon, mapping
from shapely.ops import polygonize, unary_union

PT_M = 25.4 / 72 / 1000  # metros de papel por punto PDF

DISCIPLINAS = [
    ("tabiqueria", ("tabiquer", "falsos techos")),
    ("superficies", ("cotas y superficies", "superficies")),
    ("distribucion", ("distribuci",)),
    ("electricidad", ("electric",)),
    ("fontaneria", ("fontaner",)),
    ("saneamiento", ("saneamiento",)),
    ("ventilacion", ("ventilaci",)),
    ("climatizacion", ("climatiz",)),
    ("estructura", ("estructura", "cimentaci", "forjado")),
    ("acabados", ("acabados", "pavimentos")),
    ("alzados", ("alzado",)),
    ("secciones", ("seccion", "sección")),
    ("estado_actual", ("estado actual",)),
    ("normativa", ("cumplimiento", "dbsi", "accesib")),
    ("situacion", ("situaci", "emplazamiento")),
]
SECUNDARIAS = {"situacion", "alzados", "secciones", "estado_actual", "normativa"}
HUMEDAS = ("BAÑO", "BANO", "ASEO", "LAVADERO", "TENDEDERO", "TENDIDO")
# uso de una estancia según su nombre, por orden de prioridad (un «salón-cocina» cuenta como cocina)
USOS = [
    ("bano", ("BAÑO", "BANO", "ASEO")),
    ("cocina", ("COCINA",)),
    ("lavadero", ("LAVADERO", "TENDEDERO", "TENDIDO")),
    ("dormitorio", ("DORMITORIO", "DORM", "HABITAC")),
    ("salon", ("SALON", "SALÓN", "ESTAR", "COMEDOR")),
    ("paso", ("PASO", "PASILLO", "VESTIBULO", "VESTÍBULO", "RECIBIDOR", "DISTRIBUIDOR", "HALL")),
]
ANCHOS_PUERTA = (0.625, 0.725, 0.825)  # hojas habituales; el arco suele dibujarse algo mayor que la hoja


def uso_estancia(nombre: str, vivienda: str | None = None) -> str | None:
    if vivienda == "COMUN":
        return "comun"
    n = nombre.upper()
    for uso, claves in USOS:
        if any(k in n for k in claves):
            return uso
    return None


# ───────────────────────── utilidades ─────────────────────────
def _parecido(a, b, tol=0.03):
    return a is not None and b is not None and all(abs(x - y) <= tol for x, y in zip(a, b))


def _saturado(c):
    return c is not None and (max(c) - min(c)) > 0.45


def _hex(c):
    return "#" + "".join(f"{round(v * 255):02x}" for v in c)


class Hoja:
    """Una página del PDF con su escala y su transformación a metros."""

    def __init__(self, page: pymupdf.Page, indice: int):
        self.page = page
        self.indice = indice
        self.texto = page.get_text()
        self.palabras = page.get_text("words")  # coordenadas sin rotar
        self.titulo = self._titulo()
        self.disciplina = self._disciplina()
        self.escala = self._escala()
        self.m = PT_M * self.escala if self.escala else None
        self.rot = page.rotation_matrix
        self.ancho_pt, self.alto_pt = page.rect.width, page.rect.height  # ya girada

    # metros, origen abajo-izquierda
    def a_metros(self, x, y):
        p = pymupdf.Point(x, y) * self.rot
        return (p.x * self.m, (self.alto_pt - p.y) * self.m)

    def _titulo(self):
        lineas = [l.strip() for l in self.texto.split("\n") if l.strip()]
        for i, l in enumerate(lineas):
            if l.lower().startswith("escala") and i > 0 and len(lineas[i - 1]) < 60:
                cand = lineas[i - 1]
                if not re.fullmatch(r"[A-Z]{1,3}|\d+([.,]\d+)?", cand):
                    return cand.replace("_", " ")
        for l in lineas:
            if l.lower().startswith("instalaciones"):
                return l.replace("_", " ")
        return f"Hoja {self.indice + 1}"

    def _disciplina(self):
        t = (self.titulo + " " + " ".join(self.texto.split()[:80])).lower()
        tit = self.titulo.lower()
        for clave, pals in DISCIPLINAS:
            if any(p in tit for p in pals):
                return clave
        for clave, pals in DISCIPLINAS:
            if any(p in t for p in pals):
                return clave
        return "otros"

    def _escala(self):
        cands = re.findall(r"\b1\s*[:/]\s*(\d{2,4})\b", self.texto)
        if not cands:
            return None
        return int(collections.Counter(cands).most_common(1)[0][0])


def _transformar(g, f):
    from shapely import transform as shp_transform
    import numpy as np
    return shp_transform(g, lambda arr: np.array([f(x, y) for x, y in arr]))


def _puntos(drawing):
    pts = []
    for it in drawing["items"]:
        if it[0] == "l":
            cand = [it[1], it[2]]
        elif it[0] == "re":
            r = it[1]
            cand = [pymupdf.Point(r.x0, r.y0), pymupdf.Point(r.x1, r.y0), pymupdf.Point(r.x1, r.y1), pymupdf.Point(r.x0, r.y1)]
        elif it[0] == "qu":
            q = it[1]
            cand = [q.ul, q.ur, q.lr, q.ll]
        elif it[0] == "c":
            cand = [it[1], it[4]]
        else:
            cand = []
        for q in cand:
            if not any(abs(q.x - a) < 0.05 and abs(q.y - b) < 0.05 for a, b in pts):
                pts.append((q.x, q.y))
    return pts


def _segmentos(drawing):
    out = []
    for it in drawing["items"]:
        if it[0] == "l":
            out.append(((it[1].x, it[1].y), (it[2].x, it[2].y)))
        elif it[0] in ("re", "qu"):
            if it[0] == "re":
                r = it[1]
                c = [(r.x0, r.y0), (r.x1, r.y0), (r.x1, r.y1), (r.x0, r.y1)]
            else:
                q = it[1]
                c = [(q.ul.x, q.ul.y), (q.ur.x, q.ur.y), (q.lr.x, q.lr.y), (q.ll.x, q.ll.y)]
            out += [(c[i], c[(i + 1) % 4]) for i in range(4)]
    return out


# ───────────────────────── trazos por color (tabiquería) ─────────────────────────
def _trazos_color(page, color):
    """Ejes de los trazos de un color: guiones dibujados como rectángulos rellenos o líneas."""
    out = []
    dibujos = page.get_drawings()
    rellenos = sum(1 for d in dibujos if d["type"] in ("f", "fs") and _parecido(d.get("fill"), color))
    for d in dibujos:
        if rellenos > 10 and d["type"] == "s":
            continue  # el mismo trazo suele venir también como contorno: se usa solo el relleno
        c = d.get("fill") if d["type"] in ("f", "fs") else d.get("color")
        if not _parecido(c, color):
            continue
        pts = _puntos(d)
        if len(pts) == 2:
            (ax, ay), (bx, by) = pts
            ang = math.atan2(by - ay, bx - ax) % math.pi
            ux, uy = math.cos(ang), math.sin(ang)
            ts = [ax * ux + ay * uy, bx * ux + by * uy]
            out.append((ang, (ax + bx) / 2, (ay + by) / 2, min(ts), max(ts)))
            continue
        if len(pts) < 3:
            continue
        cx = sum(a for a, _ in pts) / len(pts)
        cy = sum(b for _, b in pts) / len(pts)
        pts.sort(key=lambda q: math.atan2(q[1] - cy, q[0] - cx))
        aristas = [(pts[i], pts[(i + 1) % len(pts)]) for i in range(len(pts))]
        largo = [math.dist(a, b) for a, b in aristas]
        i = max(range(len(largo)), key=lambda k: largo[k])
        (ax, ay), (bx, by) = aristas[i]
        ang = math.atan2(by - ay, bx - ax) % math.pi
        ux, uy = math.cos(ang), math.sin(ang)
        ts = [q[0] * ux + q[1] * uy for q in pts]
        out.append((ang, cx, cy, min(ts), max(ts)))
    return out


def _unir(trazos, hueco=8.0):
    grupos = collections.defaultdict(list)
    for ang, cx, cy, t0, t1 in trazos:
        a = round(ang / 0.02) * 0.02 % math.pi
        nx, ny = -math.sin(ang), math.cos(ang)
        off = cx * nx + cy * ny
        grupos[(round(a, 2), round(off / 1.2))].append((t0, t1, ang, off))
    tramos = []
    for iv in grupos.values():
        iv.sort()
        s, e, ang, off = iv[0]
        for t0, t1, _, _ in iv[1:]:
            if t0 <= e + hueco:
                e = max(e, t1)
            else:
                tramos.append((ang, off, s, e))
                s, e = t0, t1
        tramos.append((ang, off, s, e))
    out = []
    for ang, off, s, e in tramos:
        ux, uy = math.cos(ang), math.sin(ang)
        nx, ny = -uy, ux
        out.append(LineString([(s * ux + off * nx, s * uy + off * ny), (e * ux + off * nx, e * uy + off * ny)]))
    return _encadenar(out, hueco)


def _encadenar(lineas, hueco):
    """Une tramos casi colineales cuyos extremos están cerca (p. ej. tramos oblicuos con ángulo ligeramente distinto)."""
    lineas = list(lineas)
    cambiado = True
    while cambiado:
        cambiado = False
        for i in range(len(lineas)):
            a = lineas[i]
            (ax, ay), (bx, by) = a.coords[0], a.coords[-1]
            ang_a = math.atan2(by - ay, bx - ax) % math.pi
            for j in range(i + 1, len(lineas)):
                b = lineas[j]
                (cx, cy), (dx, dy) = b.coords[0], b.coords[-1]
                ang_b = math.atan2(dy - cy, dx - cx) % math.pi
                dang = min(abs(ang_a - ang_b), math.pi - abs(ang_a - ang_b))
                if dang > 0.06:
                    continue
                if a.distance(b) > hueco:
                    continue
                # desplazamiento lateral pequeño
                if max(b.distance(Point(a.coords[0])), b.distance(Point(a.coords[-1]))) > a.length + b.length:
                    continue
                pts = [a.coords[0], a.coords[-1], b.coords[0], b.coords[-1]]
                ux, uy = math.cos(ang_a), math.sin(ang_a)
                nx, ny = -uy, ux
                lat = [p[0] * nx + p[1] * ny for p in pts]
                if max(lat) - min(lat) > 2.0:
                    continue
                t = sorted(pts, key=lambda p: p[0] * ux + p[1] * uy)
                lineas[i] = LineString([t[0], t[-1]])
                lineas.pop(j)
                cambiado = True
                break
            if cambiado:
                break
    return lineas


def leer_leyenda(hoja: Hoja, palabra_clave=("TABIQUER", "TABIQUES")):
    """Filas de leyenda (código + descripción) y el color de la muestra más cercana."""
    ws = hoja.palabras
    cab = next((w for w in ws if w[4].upper().startswith("LEYENDA") and any(
        v[4].upper().startswith(k) for v in ws for k in palabra_clave if abs(v[1] - w[1]) < 3 or abs(v[0] - w[0]) < 3)), None)
    if not cab:
        return [], None
    # filas: líneas de texto cuyo primer token es un código corto en mayúsculas cerca de la cabecera
    lineas = collections.defaultdict(list)
    for w in ws:
        lineas[(w[5], w[6])].append(w)
    filas = []
    for ln in lineas.values():
        ln.sort(key=lambda w: (w[1], w[0]))
        primero = ln[0]
        if re.fullmatch(r"[A-Z]{2,4}", primero[4]) and math.dist((primero[0], primero[1]), (cab[0], cab[1])) < 140 and primero is not cab:
            filas.append((primero[4], " ".join(w[4] for w in ln), pymupdf.Rect(primero[:4])))
    muestras = []
    for d in hoja.page.get_drawings():
        c = d.get("fill") if d["type"] in ("f", "fs") else d.get("color")
        if _saturado(c) and math.dist((d["rect"].x0, d["rect"].y0), (cab[0], cab[1])) < 200:
            muestras.append((tuple(round(v, 2) for v in c), d["rect"]))
    resultado = []
    usados = set()
    for codigo, texto, r in filas:
        mejor = None
        for col, rr in muestras:
            if col in usados:
                continue
            # misma fila: la muestra está alineada con el texto en una de las dos direcciones
            dy = abs((rr.y0 + rr.y1) / 2 - (r.y0 + r.y1) / 2)
            dx = abs((rr.x0 + rr.x1) / 2 - (r.x0 + r.x1) / 2)
            d = min(dx, dy)
            if d < 6 and (mejor is None or d < mejor[0]):
                mejor = (d, col)
        if mejor:
            usados.add(mejor[1])
            resultado.append({"codigo": codigo, "descripcion": texto, "color": mejor[1]})
    zona = pymupdf.Rect(cab[:4])
    for _, rr in muestras:
        zona |= rr
    for _, _, r in filas:
        zona |= r
    return resultado, zona


NOMBRES_TABIQUE = {
    "TB": "Tabique de placa de yeso",
    "TS": "Trasdosado",
    "MD": "Medianera entre viviendas",
}


def extraer_tabiques(hoja: Hoja):
    leyenda, zona = leer_leyenda(hoja)
    tipos, elementos = [], []
    for fila in leyenda:
        clave = fila["codigo"]
        tramos = _unir(_trazos_color(hoja.page, fila["color"]))
        tramos = [t for t in tramos if t.length * hoja.m > 0.05 and not (zona and zona.contains(pymupdf.Point(t.centroid.x, t.centroid.y)))]
        tipos.append({
            "clave": clave,
            "nombre": f"{NOMBRES_TABIQUE.get(clave, clave)} ({fila['descripcion'].split(' ', 1)[1] if ' ' in fila['descripcion'] else clave})",
            "categoria": "tabiqueria",
            "geometria": "linea",
            "color": _hex(fila["color"]),
        })
        for t in tramos:
            elementos.append({"tipo": clave, "geom_pt": t})
    return tipos, elementos


# ───────────────────────── estancias y viviendas ─────────────────────────
def _muros(hoja: Hoja, gris=(0.78, 0.78, 0.79)):
    partes = []
    for d in hoja.page.get_drawings():
        if d["type"] in ("f", "fs") and _parecido(d.get("fill"), gris):
            ps = list(polygonize([LineString(s) for s in _segmentos(d)]))
            if ps:
                partes.append(unary_union(ps))
            else:
                pts = _puntos(d)
                if len(pts) >= 3:
                    partes.append(Polygon(pts).buffer(0))
        elif d["type"] == "s" and _parecido(d.get("color"), (0, 0, 0)) and abs((d.get("width") or 0) - 0.51) < 0.06:
            for s in _segmentos(d):
                partes.append(LineString(s).buffer(0.04 / hoja.m))
    return unary_union(partes) if partes else None


def leer_rotulos(hoja: Hoja):
    """Rótulos de superficie («Sup: 5,04 m²») con el nombre de la estancia más cercano."""
    ws = hoja.palabras
    out = []
    for w in ws:
        m = re.match(r"^(\d+[.,]\d+)\s*m", w[4])
        if not m:
            continue
        val = float(m.group(1).replace(",", "."))
        cx, cy = (w[0] + w[2]) / 2, (w[1] + w[3]) / 2
        cerca = [v for v in ws if re.fullmatch(r"[A-ZÁÉÍÓÚÑ\-]{3,}", v[4]) and v[4] not in ("SUP",) and math.hypot((v[0] + v[2]) / 2 - cx, (v[1] + v[3]) / 2 - cy) < 45]
        nombre = min(cerca, key=lambda v: math.hypot((v[0] + v[2]) / 2 - cx, (v[1] + v[3]) / 2 - cy))[4] if cerca else "ESTANCIA"
        out.append({"nombre": nombre.replace("TENDIDO", "TENDEDERO"), "superficie": val, "punto_pt": (cx, cy)})
    return out


def leer_cuadro_superficies(hoja: Hoja):
    """Cuadro «A01 S.Util … TOTAL SUPERFICIE UTIL A01 56,30»: viviendas con sus estancias."""
    lineas = [l.strip() for l in hoja.texto.split("\n") if l.strip()]
    viviendas, actual = {}, None
    i = 0
    while i < len(lineas):
        l = lineas[i]
        m = re.fullmatch(r"([A-Z]\d{2})", l)
        if m and i + 1 < len(lineas) and "S.Util" in lineas[i + 1]:
            actual = viviendas.setdefault(m.group(1), {"codigo": m.group(1), "estancias": [], "util": None, "construida": None})
            i += 2
            continue
        m = re.match(r"TOTAL SUPERFICIE (UTIL|CONSTRUIDA) ([A-Z]\d{2})", l)
        if m and i + 1 < len(lineas):
            v = viviendas.setdefault(m.group(2), {"codigo": m.group(2), "estancias": [], "util": None, "construida": None})
            v["util" if m.group(1) == "UTIL" else "construida"] = float(lineas[i + 1].replace(",", "."))
            i += 2
            continue
        if actual is not None and re.fullmatch(r"[A-ZÁÉÍÓÚÑ\- ]{4,}", l) and i + 1 < len(lineas) and re.fullmatch(r"\d+[.,]\d+", lineas[i + 1]):
            actual["estancias"].append((l, float(lineas[i + 1].replace(",", "."))))
            i += 2
            continue
        i += 1
    return list(viviendas.values())


def detectar_viviendas(hoja: Hoja, rotulos, cuadro):
    """Recintos cerrados por muros (con los huecos de fachada cerrados) y su vivienda según el cuadro."""
    W = _muros(hoja)
    if W is None:
        return [], None
    m = hoja.m
    grande = W.buffer(3.0 / m).buffer(-3.0 / m)
    huella = unary_union([Polygon(g.exterior) for g in getattr(grande, "geoms", [grande])])
    cerrado = W.buffer(0.25 / m).buffer(-0.25 / m)
    celdas = huella.difference(cerrado)
    recintos = [g for g in getattr(celdas, "geoms", [celdas]) if g.area * m * m > 1.0]
    viviendas = []
    for g in recintos:
        dentro = [r for r in rotulos if g.contains(Point(r["punto_pt"]))]
        valores = sorted(round(r["superficie"], 2) for r in dentro)
        codigo = None
        mejor = 0
        for v in cuadro:
            ref = [round(x, 2) for _, x in v["estancias"]]
            coincide = sum(1 for x in valores if any(abs(x - y) < 0.06 for y in ref))
            if coincide > mejor:
                mejor, codigo = coincide, v["codigo"]
        viviendas.append({"geom_pt": g, "codigo": codigo, "rotulos": dentro})
    # estancias: recintos más finos (cerrando huecos de puerta); solo se usan si contienen un único rótulo
    finos = huella.difference(W.buffer(0.62 / m).buffer(-0.62 / m))
    for v in viviendas:
        v["recintos"] = []
        for g in getattr(finos, "geoms", [finos]):
            if g.area * m * m > 1.0 and v["geom_pt"].contains(g.representative_point()):
                v["recintos"].append({"geom_pt": g, "rotulos": [r for r in rotulos if g.contains(Point(r["punto_pt"]))]})
    # recintos sin coincidencia (rótulos que no cuadran con el cuadro): a la vivienda más cercana,
    # salvo que sus estancias no aparezcan en ningún cuadro (zonas comunes)
    nombres_cuadro = {n.split("-")[0].strip() for v in cuadro for n, _ in v["estancias"]}
    asignados = [v for v in viviendas if v["codigo"]]
    for v in viviendas:
        if v["codigo"] or not asignados or not v["rotulos"]:
            continue
        nombres = {r["nombre"].split("-")[0] for r in v["rotulos"]}
        if v["rotulos"] and not (nombres & nombres_cuadro):
            v["codigo"] = "COMUN"
            continue
        cerca = min(asignados, key=lambda a: a["geom_pt"].distance(v["geom_pt"]))
        if cerca["geom_pt"].distance(v["geom_pt"]) * m < 1.0:
            v["codigo"] = cerca["codigo"]
    # agrupa recintos de la misma vivienda
    por_codigo = collections.defaultdict(list)
    for v in viviendas:
        por_codigo[v["codigo"]].append(v)
    salida = []
    for codigo, vs in por_codigo.items():
        if codigo is None:
            continue
        g = unary_union([v["geom_pt"] for v in vs])
        ref = next((v for v in cuadro if v["codigo"] == codigo), {"util": None, "construida": None})
        salida.append({"codigo": codigo, "geom_pt": g, "util": ref["util"], "construida": ref["construida"], "recintos": [rc for v in vs for rc in v["recintos"]]})
    return salida, W


def alturas_techo(hoja: Hoja):
    """Rótulos «H:2,50m» de falso techo con su posición."""
    out = []
    for w in hoja.palabras:
        m = re.match(r"^H:(\d+[.,]\d+)m", w[4])
        if m:
            out.append((Point((w[0] + w[2]) / 2, (w[1] + w[3]) / 2), float(m.group(1).replace(",", "."))))
    return out


# ───────────────────────── puertas ─────────────────────────
def _ajustar_circulo(pts):
    """Ajuste algebraico (Kåsa) de una circunferencia: centro, radio y error relativo máximo."""
    import numpy as np
    P = np.asarray(pts, dtype=float)
    x, y = P[:, 0], P[:, 1]
    A = np.column_stack([x, y, np.ones(len(P))])
    b = x * x + y * y
    try:
        (cx2, cy2, c), *_ = np.linalg.lstsq(A, b, rcond=None)
    except np.linalg.LinAlgError:
        return None
    cx, cy = cx2 / 2, cy2 / 2
    r2 = c + cx * cx + cy * cy
    if r2 <= 0:
        return None
    r = math.sqrt(r2)
    err = float(np.max(np.abs(np.hypot(x - cx, y - cy) - r))) / r
    return (cx, cy), r, err


def detectar_puertas(hoja: Hoja, muros=None):
    """Batientes de puerta dibujados como arcos a trazos: se agrupan los trazos cortos y se ajusta una circunferencia.

    Devuelve [{punto_pt, ancho, centro_pt}]: el punto está en el hueco (entre la bisagra y la jamba opuesta).
    """
    m = hoja.m
    segs = []
    for d in hoja.page.get_drawings():
        if d["type"] != "s" or (d.get("width") or 0) > 0.6:
            continue
        for it in d["items"]:
            if it[0] == "l":
                a, b = (it[1].x, it[1].y), (it[2].x, it[2].y)
                if 0 < math.dist(a, b) * m < 0.12:
                    segs.append((a, b))
    if not segs:
        return []
    # agrupación por proximidad de extremos (rejilla de 3 pt; vecinos a menos de 2,5 pt)
    celda = 3.0
    rejilla = collections.defaultdict(list)
    for i, (a, b) in enumerate(segs):
        for q in (a, b):
            rejilla[(int(q[0] // celda), int(q[1] // celda))].append((i, q))
    padre = list(range(len(segs)))

    def raiz(i):
        while padre[i] != i:
            padre[i] = padre[padre[i]]
            i = padre[i]
        return i

    for (gx, gy), lista in rejilla.items():
        vecinos = []
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                vecinos += rejilla.get((gx + dx, gy + dy), [])
        for i, q in lista:
            for j, p in vecinos:
                if i != j and math.dist(p, q) <= 2.5:
                    padre[raiz(i)] = raiz(j)
    grupos = collections.defaultdict(list)
    for i in range(len(segs)):
        grupos[raiz(i)].append(i)
    puertas = []
    for ids in grupos.values():
        if len(ids) < 6:
            continue
        pts = []
        for i in ids:
            pts += [segs[i][0], segs[i][1]]
        aj = _ajustar_circulo(pts)
        if not aj:
            continue
        (cx, cy), r, err = aj
        if err > 0.15 or not (0.5 <= r * m <= 1.25):
            continue
        angs = sorted(math.atan2(q[1] - cy, q[0] - cx) for q in pts)
        huecos = [(angs[(k + 1) % len(angs)] - angs[k]) % (2 * math.pi) for k in range(len(angs))]
        k = max(range(len(angs)), key=lambda t: huecos[t])
        abarca = 2 * math.pi - huecos[k]
        if not (math.radians(55) <= abarca <= math.radians(125)):
            continue
        a0, a1 = angs[(k + 1) % len(angs)], angs[k]  # extremos del arco
        extremos = [(cx + r * math.cos(a), cy + r * math.sin(a)) for a in (a0, a1)]
        if muros is not None:
            jamba = min(extremos, key=lambda q: muros.distance(Point(q)))
        else:
            jamba = extremos[0]
        puertas.append({
            "punto_pt": ((cx + jamba[0]) / 2, (cy + jamba[1]) / 2),
            "centro_pt": (cx, cy),
            "ancho": min(ANCHOS_PUERTA, key=lambda w: abs(w - r * m)),
            "radio": round(r * m, 3),
        })
    # dos arcos sobre la misma bisagra (puerta doble o dibujo repetido) → uno
    unicas = []
    for p in puertas:
        if not any(math.dist(p["centro_pt"], q["centro_pt"]) * m < 0.3 for q in unicas):
            unicas.append(p)
    return unicas


# ───────────────────────── proyecto completo ─────────────────────────
def analizar(ruta_pdf: str | Path, carpeta_salida: str | Path | None = None, dpi: int = 200) -> dict:
    doc = pymupdf.open(str(ruta_pdf))
    hojas = [Hoja(p, i) for i, p in enumerate(doc)]
    salida = Path(carpeta_salida) if carpeta_salida else None
    if salida:
        salida.mkdir(parents=True, exist_ok=True)
    res = {"hojas": [], "tipos": [], "elementos": [], "estancias": [], "viviendas": [], "puertas": [], "avisos": []}
    for h in hojas:
        info = {
            "pagina": h.indice + 1, "titulo": h.titulo, "disciplina": h.disciplina, "escala": h.escala,
            "ancho_m": round(h.ancho_pt * h.m, 4) if h.m else None, "alto_m": round(h.alto_pt * h.m, 4) if h.m else None,
            "principal": h.disciplina not in SECUNDARIAS and h.escala is not None and h.escala <= 200,
            "encuadre": "planta" if (h.disciplina not in SECUNDARIAS and h.disciplina != "otros" and h.escala is not None and h.escala <= 200) else "propio",
            "imagen": None,
        }
        if salida and h.m:
            nombre = f"hoja-{h.indice + 1:02d}.png"
            h.page.get_pixmap(dpi=dpi).save(str(salida / nombre))
            info["imagen"] = nombre
        res["hojas"].append(info)

    planta = [h for h in hojas if h.m and h.escala and h.escala <= 200]
    h_tab = next((h for h in planta if h.disciplina == "tabiqueria"), None)
    h_sup = next((h for h in planta if h.disciplina == "superficies"), None)
    techos = alturas_techo(h_tab) if h_tab else []

    # estancias con rótulo de superficie y viviendas
    rotulos, viviendas, muros = [], [], None
    if h_sup:
        rotulos = leer_rotulos(h_sup)
        cuadro = leer_cuadro_superficies(h_sup)
        viviendas, muros = detectar_viviendas(h_sup, rotulos, cuadro)
        for v in viviendas:
            res["viviendas"].append({
                "codigo": v["codigo"], "superficie_util": v["util"], "superficie_construida": v["construida"],
                "superficie_detectada": round(v["geom_pt"].area * h_sup.m ** 2, 2),
                "geom": mapping(_transformar(v["geom_pt"], h_sup.a_metros)),
            })
        for r in rotulos:
            viv = next((v["codigo"] for v in viviendas if v["geom_pt"].buffer(2).contains(Point(r["punto_pt"]))), None)
            recinto = None
            for v in viviendas:
                for rc in v["recintos"]:
                    if len(rc["rotulos"]) == 1 and rc["rotulos"][0] is r:
                        recinto = rc["geom_pt"]
            techo = min(techos, key=lambda t: t[0].distance(Point(r["punto_pt"])))[1] if techos else None
            res["estancias"].append({
                "nombre": r["nombre"].capitalize(), "superficie": r["superficie"], "vivienda": viv,
                "humeda": any(k in r["nombre"].upper() for k in HUMEDAS),
                "uso": uso_estancia(r["nombre"], viv),
                "altura_techo": techo,
                "punto": list(h_sup.a_metros(*r["punto_pt"])),
                "geom": mapping(_transformar(recinto, h_sup.a_metros)) if recinto is not None else None,
                "superficie_detectada": round(recinto.area * h_sup.m ** 2, 2) if recinto is not None else None,
            })

    # tabiquería por leyenda
    if h_tab:
        tipos, elems = extraer_tabiques(h_tab)
        res["tipos"] += tipos
        estancias_pt = [(Point(r["punto_pt"]), r) for r in rotulos]
        for e in elems:
            g = e["geom_pt"]
            L = g.length * h_tab.m
            mid = g.interpolate(0.5, normalized=True)
            (ax, ay), (bx, by) = g.coords[0], g.coords[-1]
            nx, ny = -(by - ay) / g.length, (bx - ax) / g.length
            d = 0.35 / h_tab.m
            lados = [Point(mid.x + nx * d, mid.y + ny * d), Point(mid.x - nx * d, mid.y - ny * d)]
            vecinas = []
            for pnt in lados:
                if estancias_pt:
                    vecinas.append(min(estancias_pt, key=lambda t: t[0].distance(pnt))[1])
            humedo = any(any(k in v["nombre"].upper() for k in HUMEDAS) for v in vecinas)
            hs = [min(techos, key=lambda t: t[0].distance(pnt))[1] for pnt in lados] if techos else []
            altura = max(hs) if hs else 2.6
            viv = next((v["codigo"] for v in viviendas if v["geom_pt"].buffer(0.5 / h_tab.m).contains(mid)), None)
            res["elementos"].append({
                "tipo": e["tipo"], "longitud": round(L, 3), "altura": altura, "humedo": humedo, "vivienda": viv,
                "estancias": sorted({v["nombre"].capitalize() for v in vecinas}),
                "geom": mapping(_transformar(g, h_tab.a_metros)),
            })
    else:
        res["avisos"].append("No se ha encontrado una hoja de tabiquería con leyenda de colores")

    # puertas interiores por el arco del batiente (en la hoja de superficies, que tiene muros y rótulos)
    if h_sup:
        for p in detectar_puertas(h_sup, muros):
            pnt = Point(p["punto_pt"])
            viv = next((v["codigo"] for v in viviendas if v["geom_pt"].buffer(0.5 / h_sup.m).contains(pnt)), None)
            cerca = min(rotulos, key=lambda r: pnt.distance(Point(r["punto_pt"]))) if rotulos else None
            nombre = cerca["nombre"].capitalize() if cerca else None
            res["puertas"].append({
                "ancho": p["ancho"], "radio": p["radio"], "vivienda": viv, "estancia": nombre,
                "uso": uso_estancia(nombre or "", viv), "humedo": bool(nombre and any(k in nombre.upper() for k in HUMEDAS)),
                "geom": {"type": "Point", "coordinates": list(h_sup.a_metros(*p["punto_pt"]))},
            })

    # todas las hojas de planta comparten encuadre: se comprueba con la huella de muros
    res["planta_base"] = (h_tab or h_sup or (planta[0] if planta else hojas[0])).indice + 1
    return res


if __name__ == "__main__":
    import json, sys
    r = analizar(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
    for h in r["hojas"]:
        print(f"Hoja {h['pagina']:2d} · {h['titulo'][:40]:40} · {h['disciplina']:13} · 1:{h['escala']} · {'principal' if h['principal'] else ''}")
    tot = collections.defaultdict(float)
    for e in r["elementos"]:
        tot[e["tipo"]] += e["longitud"]
    print("\nTabiquería:", {k: round(v, 2) for k, v in tot.items()}, "· elementos", len(r["elementos"]))
    print("Húmedos:", collections.Counter((e["tipo"], e["humedo"]) for e in r["elementos"]))
    print("\nViviendas:")
    for v in r["viviendas"]:
        print(f"  {v['codigo']}: útil {v['superficie_util']} · detectada {v['superficie_detectada']}")
    print("\nPuertas:", len(r["puertas"]), collections.Counter((p["vivienda"], p["ancho"]) for p in r["puertas"]))
    print("\nEstancias:", len(r["estancias"]), "con polígono:", sum(1 for e in r["estancias"] if e["geom"]))
    for e in r["estancias"]:
        print(f"  {e['vivienda']} {e['nombre']:32} {e['superficie']:6.2f} m² · techo {e['altura_techo']} · {'húmeda' if e['humeda'] else ''}")
    for a in r["avisos"]:
        print("AVISO", a)
    if len(sys.argv) > 3:
        json.dump(r, open(sys.argv[3], "w"), ensure_ascii=False)
