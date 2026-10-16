"""Lectura de presupuestos: PDF (formato proforma por columnas), BC3 (FIEBDC-3) y Excel.

Todas las funciones devuelven la misma estructura:
    {"capitulos": [{"codigo", "nombre", "partidas": [{"codigo", "resumen", "descripcion",
                                                     "unidad", "medicion", "precio", "importe"}]}],
     "total": float, "avisos": [str]}
"""
from __future__ import annotations

import re
from pathlib import Path

import pymupdf

UNIDADES = r"(m2|m²|m3|m³|ml|m|ud|u|pa|kg|t|h|l)"
RE_CANT = re.compile(r"^\d{1,3}(\.\d{3})*(,\d+)?$|^\d+(,\d+)?$")


def num_es(txt: str) -> float:
    """'4.440,00' -> 4440.0 ; '5' -> 5.0"""
    t = txt.replace("€", "").strip()
    if "," in t:
        t = t.replace(".", "").replace(",", ".")
    return float(t)


# ───────────────────────── PDF ─────────────────────────
def _lineas(page: pymupdf.Page, tol: float = 2.2):
    palabras = sorted(page.get_text("words"), key=lambda w: (round(w[1], 1), w[0]))
    lineas: list[list] = []
    for w in palabras:
        y = (w[1] + w[3]) / 2
        if lineas and abs(lineas[-1][0] - y) <= tol:
            lineas[-1][1].append(w)
        else:
            lineas.append([y, [w]])
    for ln in lineas:
        ln[1].sort(key=lambda w: w[0])
    return lineas


def _columnas(page: pymupdf.Page):
    """Localiza las columnas a partir de la cabecera (Unid/Med … Precio/Subtotal … Total)."""
    ancho = page.rect.width
    x_desc, x_precio, x_total = ancho * 0.13, ancho * 0.78, ancho * 0.88
    for w in page.get_text("words"):
        if w[4] in ("Precio", "Subtotal", "unitario"):
            x_precio = min(x_precio, w[0] - 8)
        if w[4] == "Total":
            x_total = min(x_total, w[0] - 14)
    return x_desc, x_precio, x_total


def leer_pdf(ruta: str | Path) -> dict:
    doc = pymupdf.open(str(ruta))
    capitulos: list[dict] = []
    avisos: list[str] = []
    total_doc = None
    actual = None
    bloque: list[tuple[str, list]] = []

    def cerrar_partida(cant, unidad, precio_linea):
        nonlocal bloque
        textos = [t for t, _ in bloque if t]
        euros_precio = [v for _, vals in bloque for (col, v) in vals if col == "precio"]
        euros_total = [v for _, vals in bloque for (col, v) in vals if col == "total"]
        if precio_linea is not None:
            euros_precio.append(precio_linea)
        precio = euros_precio[-1] if euros_precio else None
        importe = max(euros_total) if euros_total else None
        if precio is None and importe is not None and cant:
            precio = round(importe / cant, 4)
        if importe is None and precio is not None:
            importe = round(precio * cant, 2)
        resumen = textos[0] if textos else "(sin título)"
        partida = {
            "codigo": None,
            "resumen": resumen,
            "descripcion": " ".join(textos[1:]).strip(),
            "unidad": unidad,
            "medicion": cant,
            "precio": precio,
            "importe": importe,
        }
        if precio is not None and importe is not None and abs(precio * cant - importe) > max(1.0, importe * 0.01):
            avisos.append(f"«{resumen}»: {cant} × {precio} no da {importe} (se mantiene el importe del documento)")
        nonlocal actual
        if actual is None:
            actual = {"codigo": None, "nombre": "Sin capítulo", "partidas": []}
            capitulos.append(actual)
        actual["partidas"].append(partida)
        bloque = []

    for page in doc:
        x_desc, x_precio, x_total = _columnas(page)
        for _, ws in _lineas(page):
            textos = [w[4] for w in ws]
            linea = " ".join(textos)
            if "COSTE TOTAL" in linea.upper():
                importes = [num_es(w[4]) for w in ws if RE_CANT.match(w[4].replace("€", "")) and w[0] >= x_precio]
                if importes:
                    total_doc = importes[-1]
                continue
            # cabecera de capítulo: "Unid Med NOMBRE … Total"
            if ("Unid" in textos or "Unidades" in textos) and "Med" in textos:
                nombre = " ".join(w[4] for w in ws if x_desc + 60 < w[0] < x_precio - 20 and w[4] not in ("Precio", "Subtotal"))
                actual = {"codigo": f"{len(capitulos) + 1:02d}", "nombre": nombre.strip(), "partidas": []}
                capitulos.append(actual)
                bloque = []
                continue
            if linea.strip() in ("Precio", "unitario"):
                continue
            izq = [w for w in ws if w[0] < x_desc - 2]
            desc = [w for w in ws if x_desc - 2 <= w[0] < x_precio and w[4] != "€"]
            vals = []
            for w in ws:
                if w[0] >= x_precio and RE_CANT.match(w[4]):
                    vals.append(("total" if w[0] >= x_total else "precio", num_es(w[4])))
            # medición + unidad en la columna izquierda: cierra la partida
            cant = unidad = None
            if izq:
                tk = [w[4] for w in izq]
                if RE_CANT.match(tk[0]):
                    cant = num_es(tk[0])
                    if len(tk) > 1 and re.fullmatch(UNIDADES, tk[1].lower()):
                        unidad = tk[1].lower().replace("²", "2").replace("³", "3")
            texto_desc = " ".join(w[4] for w in desc).strip()
            if cant is not None:
                # un número en la columna izquierda sin unidad puede ser parte de una cota del texto
                if unidad is None and len(izq) > 1:
                    unidad = izq[1][4].lower()
                bloque.append((texto_desc, [v for v in vals if v[0] == "total"]))
                precio_linea = next((v for c, v in vals if c == "precio"), None)
                cerrar_partida(cant, unidad or "ud", precio_linea)
                continue
            if not texto_desc and vals and not bloque:
                continue  # subtotal de capítulo
            if not texto_desc and vals and all(c == "total" for c, _ in vals) and len(bloque) == 0:
                continue
            bloque.append((texto_desc, vals))

    for c in capitulos:
        for i, p in enumerate(c["partidas"], 1):
            p["codigo"] = f"{c['codigo'] or '00'}.{i:02d}"
    capitulos = [c for c in capitulos if c["partidas"]]
    suma = round(sum(p["importe"] or 0 for c in capitulos for p in c["partidas"]), 2)
    if total_doc is not None and abs(suma - total_doc) > 1:
        avisos.append(f"La suma de partidas ({suma:,.2f} €) no coincide con el total del documento ({total_doc:,.2f} €)")
    return {"capitulos": capitulos, "total": total_doc or suma, "suma_partidas": suma, "avisos": avisos}


# ───────────────────────── BC3 (FIEBDC-3) ─────────────────────────
def leer_bc3(ruta: str | Path) -> dict:
    raw = Path(ruta).read_bytes()
    texto = raw.decode("cp850", errors="replace") if b"\r\n~" in raw[:200] and b"ANSI" not in raw[:300] else raw.decode("latin-1", errors="replace")
    conceptos: dict[str, dict] = {}
    descomp: dict[str, list[str]] = {}
    mediciones: dict[tuple[str, str], float] = {}
    textos: dict[str, str] = {}
    for reg in texto.split("~")[1:]:
        tipo, _, resto = reg.partition("|")
        campos = resto.split("|")
        if tipo == "C":
            codigo = campos[0].strip()
            limpio = codigo.rstrip("#")
            conceptos[limpio] = {
                "codigo": limpio,
                "unidad": campos[1].strip() if len(campos) > 1 else "",
                "resumen": campos[2].strip() if len(campos) > 2 else "",
                "precio": _f(campos[3].split("\\")[0]) if len(campos) > 3 else 0.0,
                "capitulo": codigo.endswith("#"),
                "raiz": codigo.endswith("##"),
            }
        elif tipo == "D":
            padre = campos[0].strip().rstrip("#")
            hijos = campos[1].split("\\") if len(campos) > 1 else []
            descomp[padre] = [hijos[i].strip().rstrip("#") for i in range(0, len(hijos) - 2, 3) if hijos[i].strip()]
        elif tipo == "M":
            rel = campos[0].split("\\")
            if len(rel) >= 2:
                mediciones[(rel[0].rstrip("#"), rel[1].rstrip("#"))] = _f(campos[2]) if len(campos) > 2 else 0.0
        elif tipo == "T":
            textos[campos[0].strip().rstrip("#")] = campos[1].strip() if len(campos) > 1 else ""

    raiz = next((c for c in conceptos.values() if c["raiz"]), None)
    caps_codigos = descomp.get(raiz["codigo"], []) if raiz else [c["codigo"] for c in conceptos.values() if c["capitulo"] and not c["raiz"]]
    capitulos = []
    avisos = []

    def recoger(cap_codigo: str, destino: list):
        for h in descomp.get(cap_codigo, []):
            c = conceptos.get(h)
            if not c:
                continue
            if c["capitulo"] or (h in descomp and all(conceptos.get(x, {}).get("capitulo") for x in descomp[h])):
                recoger(h, destino)  # subcapítulo: se aplana dentro del capítulo
                continue
            med = mediciones.get((cap_codigo, h), 0.0)
            destino.append({
                "codigo": h, "resumen": c["resumen"], "descripcion": textos.get(h, ""), "unidad": c["unidad"],
                "medicion": med, "precio": c["precio"], "importe": round(med * c["precio"], 2),
            })

    for cc in caps_codigos:
        c = conceptos.get(cc)
        if not c:
            continue
        partidas: list = []
        recoger(cc, partidas)
        capitulos.append({"codigo": cc, "nombre": c["resumen"], "partidas": partidas})
    total = round(sum(p["importe"] for c in capitulos for p in c["partidas"]), 2)
    if not capitulos:
        avisos.append("No se han encontrado capítulos en el BC3")
    return {"capitulos": capitulos, "total": total, "suma_partidas": total, "avisos": avisos}


def _f(t: str) -> float:
    try:
        return float(t.strip() or 0)
    except ValueError:
        return 0.0


# ───────────────────────── Excel ─────────────────────────
def leer_excel(ruta: str | Path) -> dict:
    """Excel con columnas reconocibles (código, descripción/resumen, unidad, medición, precio, importe).
    Las filas sin unidad ni medición con código corto se toman como capítulos."""
    import openpyxl

    wb = openpyxl.load_workbook(str(ruta), data_only=True, read_only=True)
    ws = wb.worksheets[0]
    filas = [list(r) for r in ws.iter_rows(values_only=True)]
    claves = {
        "codigo": ("código", "codigo", "cód", "cod", "nº", "n."),
        "resumen": ("resumen", "descripción", "descripcion", "concepto", "partida"),
        "unidad": ("ud", "unidad", "ud.", "uds"),
        "medicion": ("medición", "medicion", "cantidad", "med", "med."),
        "precio": ("precio", "pu", "p.u.", "precio unitario"),
        "importe": ("importe", "total", "subtotal"),
    }
    cab, idx = None, {}
    for i, f in enumerate(filas[:30]):
        norm = [str(v).strip().lower() if v is not None else "" for v in f]
        m = {k: next((j for j, v in enumerate(norm) if v in opts or any(v.startswith(o) for o in opts if len(o) > 3)), None) for k, opts in claves.items()}
        if m["resumen"] is not None and (m["medicion"] is not None or m["importe"] is not None):
            cab, idx = i, m
            break
    if cab is None:
        return {"capitulos": [], "total": 0, "suma_partidas": 0, "avisos": ["No se ha encontrado la fila de cabecera del Excel"]}
    capitulos: list[dict] = []
    actual = None
    g = lambda f, k: f[idx[k]] if idx.get(k) is not None and idx[k] < len(f) else None
    for f in filas[cab + 1:]:
        resumen = g(f, "resumen")
        if resumen is None or str(resumen).strip() == "":
            continue
        med, precio, imp, ud = g(f, "medicion"), g(f, "precio"), g(f, "importe"), g(f, "unidad")
        es_num = lambda v: isinstance(v, (int, float))
        if not es_num(med) and not es_num(precio) and not ud:
            actual = {"codigo": str(g(f, "codigo") or f"{len(capitulos) + 1:02d}"), "nombre": str(resumen).strip(), "partidas": []}
            capitulos.append(actual)
            continue
        if actual is None:
            actual = {"codigo": "01", "nombre": "Sin capítulo", "partidas": []}
            capitulos.append(actual)
        med = float(med) if es_num(med) else 0.0
        precio = float(precio) if es_num(precio) else (float(imp) / med if es_num(imp) and med else 0.0)
        actual["partidas"].append({
            "codigo": str(g(f, "codigo") or f"{actual['codigo']}.{len(actual['partidas']) + 1:02d}"),
            "resumen": str(resumen).strip(), "descripcion": "", "unidad": str(ud or "ud").strip(),
            "medicion": med, "precio": precio, "importe": float(imp) if es_num(imp) else round(med * precio, 2),
        })
    capitulos = [c for c in capitulos if c["partidas"]]
    total = round(sum(p["importe"] for c in capitulos for p in c["partidas"]), 2)
    return {"capitulos": capitulos, "total": total, "suma_partidas": total, "avisos": []}


def leer(ruta: str | Path) -> dict:
    ext = Path(ruta).suffix.lower()
    if ext == ".bc3":
        return leer_bc3(ruta)
    if ext in (".xlsx", ".xlsm"):
        return leer_excel(ruta)
    return leer_pdf(ruta)


if __name__ == "__main__":
    import json, sys
    r = leer(sys.argv[1])
    for c in r["capitulos"]:
        print(f"\n{c['codigo']} {c['nombre']}  ({len(c['partidas'])} partidas, {sum(p['importe'] or 0 for p in c['partidas']):,.2f} €)")
        for p in c["partidas"]:
            print(f"   {p['codigo']} {p['resumen'][:60]:60} {p['medicion']:>9} {p['unidad']:>3} × {p['precio']} = {p['importe']}")
    print("\nTotal documento", r["total"], "· suma partidas", r["suma_partidas"])
    for a in r["avisos"]:
        print("AVISO:", a)
    if len(sys.argv) > 2:
        json.dump(r, open(sys.argv[2], "w"), ensure_ascii=False, indent=1)
