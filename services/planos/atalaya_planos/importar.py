"""Importación de documentos de una obra a la base de datos (planos y presupuesto)."""
from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

import httpx
import psycopg
from psycopg.types.json import Jsonb

from . import planos as mod_planos
from . import presupuesto as mod_presupuesto
from . import vinculos

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "http://127.0.0.1:54321").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_SECRET_KEY", "")
BUCKET = "obras"


class ErrorImportacion(Exception):
    pass


def _cabeceras():
    return {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}


def descargar(ruta: str, destino: Path):
    r = httpx.get(f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{ruta}", headers=_cabeceras(), timeout=120)
    if r.status_code != 200:
        raise ErrorImportacion(f"No se pudo descargar {ruta}: {r.status_code} {r.text[:200]}")
    destino.write_bytes(r.content)


def subir(ruta: str, datos: bytes, tipo: str):
    r = httpx.post(f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{ruta}", content=datos,
                   headers={**_cabeceras(), "Content-Type": tipo, "x-upsert": "true"}, timeout=120)
    if r.status_code not in (200, 201):
        raise ErrorImportacion(f"No se pudo subir {ruta}: {r.status_code} {r.text[:200]}")


def procesar_documento(documento_id: str) -> dict:
    with psycopg.connect(DATABASE_URL, autocommit=False) as cx:
        doc = cx.execute("select id, obra_id, tipo, ruta, nombre from documentos where id = %s", (documento_id,)).fetchone()
        if not doc:
            raise ErrorImportacion("Documento no encontrado")
        _, obra_id, tipo, ruta, nombre = doc
        cx.execute("update documentos set estado = 'procesando', mensaje = null where id = %s", (documento_id,))
        cx.commit()
        try:
            # un documento de cada obra a la vez: planos y presupuesto subidos juntos no deben vincular en paralelo
            cx.execute("select pg_advisory_xact_lock(hashtext(%s::text))", (obra_id,))
            with tempfile.TemporaryDirectory() as tmp:
                local = Path(tmp) / Path(nombre).name
                descargar(ruta, local)
                if tipo == "planos":
                    resumen = _importar_planos(cx, obra_id, documento_id, local, Path(tmp) / "img")
                elif tipo == "presupuesto":
                    resumen = _importar_presupuesto(cx, obra_id, local)
                else:
                    resumen = {"mensaje": "Documento guardado; no requiere procesado"}
                vinc = vincular(cx, obra_id)
                resumen["vinculacion"] = vinc
                resumen["avisos"] = list(resumen.get("avisos") or []) + list(vinc.get("avisos") or [])
            cx.execute("update documentos set estado = 'listo', resumen = %s, mensaje = null where id = %s", (Jsonb(resumen), documento_id))
            cx.commit()
            return resumen
        except Exception as e:  # noqa: BLE001 — se informa al usuario del error
            cx.rollback()
            cx.execute("update documentos set estado = 'error', mensaje = %s where id = %s", (str(e)[:500], documento_id))
            cx.commit()
            raise


def _hay_avances(cx, obra_id) -> bool:
    return bool(cx.execute("select 1 from avances where obra_id = %s limit 1", (obra_id,)).fetchone())


def _importar_planos(cx, obra_id, documento_id, pdf: Path, carpeta_img: Path) -> dict:
    if _hay_avances(cx, obra_id):
        raise ErrorImportacion("La obra ya tiene avances registrados sobre los planos. Para sustituirlos hay que crear una obra nueva (las versiones de planos llegarán más adelante).")
    r = mod_planos.analizar(pdf, carpeta_img)
    cx.execute("delete from hojas where obra_id = %s", (obra_id,))
    cx.execute("delete from elementos where obra_id = %s and origen = 'plano'", (obra_id,))
    cx.execute("delete from viviendas where obra_id = %s", (obra_id,))
    for i, h in enumerate(r["hojas"]):
        ruta_img = None
        if h["imagen"]:
            ruta_img = f"{obra_id}/hojas/{documento_id}/{h['imagen']}"
            subir(ruta_img, (carpeta_img / h["imagen"]).read_bytes(), "image/png")
        cx.execute(
            """insert into hojas (obra_id, documento_id, pagina, titulo, disciplina, escala, ancho_m, alto_m, imagen, principal, orden, encuadre)
               values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            (obra_id, documento_id, h["pagina"], h["titulo"], h["disciplina"], h["escala"], h["ancho_m"], h["alto_m"], ruta_img, h["principal"], i, h["encuadre"]),
        )
    # tipos de elemento
    tipos = {t["clave"]: t for t in r["tipos"]}
    tipos["EST"] = {"clave": "EST", "nombre": "Estancia (suelo y techo)", "categoria": "suelos", "geometria": "poligono", "color": "#2f6fb3"}
    tipos["PI"] = {"clave": "PI", "nombre": "Puerta interior", "categoria": "carpinterias", "geometria": "punto", "color": "#8a5a00"}
    tipos["PE"] = {"clave": "PE", "nombre": "Puerta exterior", "categoria": "carpinterias", "geometria": "punto", "color": "#5a3a00"}
    tipos["VE"] = {"clave": "VE", "nombre": "Ventana / balconera", "categoria": "carpinterias", "geometria": "punto", "color": "#0e7c86"}
    tipos["VIV"] = {"clave": "VIV", "nombre": "Vivienda (unidades por vivienda)", "categoria": "vivienda", "geometria": "poligono", "color": "#1c5f8f"}
    ids = {}
    for orden, (clave, t) in enumerate(tipos.items()):
        fila = cx.execute(
            """insert into tipos_elemento (obra_id, clave, nombre, categoria, geometria, color, orden)
               values (%s,%s,%s,%s,%s,%s,%s)
               on conflict (obra_id, clave) do update set nombre = excluded.nombre, color = excluded.color, geometria = excluded.geometria
               returning id""",
            (obra_id, clave, t["nombre"], t["categoria"], t["geometria"], t["color"], orden),
        ).fetchone()
        ids[clave] = fila[0]
    n = 0
    for e in r["elementos"]:
        cx.execute(
            """insert into elementos (obra_id, tipo_id, vivienda, etiqueta, geojson, longitud, altura, humedo, datos)
               values (%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            (obra_id, ids[e["tipo"]], e["vivienda"], None, Jsonb(e["geom"]), e["longitud"], e["altura"], e["humedo"],
             Jsonb({"estancias": e["estancias"]})),
        )
        n += 1
    for est in r["estancias"]:
        geom = est["geom"] or {"type": "Point", "coordinates": est["punto"]}
        cx.execute(
            """insert into elementos (obra_id, tipo_id, vivienda, etiqueta, geojson, superficie, altura, humedo, uso, datos)
               values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            (obra_id, ids["EST"], est["vivienda"], est["nombre"], Jsonb(geom), est["superficie"], est["altura_techo"], est["humeda"], est["uso"],
             Jsonb({"punto": est["punto"], "superficie_detectada": est["superficie_detectada"], "poligono_detectado": est["geom"] is not None})),
        )
    for v in r["viviendas"]:
        cx.execute(
            "insert into viviendas (obra_id, codigo, superficie_util, superficie_detectada, geojson) values (%s,%s,%s,%s,%s)",
            (obra_id, v["codigo"], v["superficie_util"], v["superficie_detectada"], Jsonb(v["geom"])),
        )
        # la vivienda también es un elemento: sobre él se marcan las partidas por unidad (instalaciones, equipos…)
        cx.execute(
            """insert into elementos (obra_id, tipo_id, vivienda, etiqueta, geojson, superficie, humedo, uso, datos)
               values (%s,%s,%s,%s,%s,%s,false,%s,'{}')""",
            (obra_id, ids["VIV"], v["codigo"], v["codigo"], Jsonb(v["geom"]), v["superficie_util"] or v["superficie_detectada"],
             "comun" if v["codigo"] == "COMUN" else None),
        )
    for pu in r["puertas"]:
        cx.execute(
            """insert into elementos (obra_id, tipo_id, vivienda, etiqueta, geojson, humedo, uso, datos)
               values (%s,%s,%s,%s,%s,%s,%s,%s)""",
            (obra_id, ids["PI"], pu["vivienda"], f"Puerta {int(pu['ancho'] * 100)}", Jsonb(pu["geom"]), pu["humedo"], pu["uso"],
             Jsonb({"ancho": pu["ancho"], "radio": pu["radio"], "estancia": pu["estancia"]})),
        )
    return {
        "hojas": len(r["hojas"]), "elementos_lineales": n, "estancias": len(r["estancias"]),
        "viviendas": len(r["viviendas"]), "puertas": len(r["puertas"]), "tipos": list(tipos), "avisos": r["avisos"],
    }


def _importar_presupuesto(cx, obra_id, archivo: Path) -> dict:
    hay = cx.execute(
        "select (select count(*) from avances_manuales where obra_id = %s) + (select count(*) from certificaciones where obra_id = %s)",
        (obra_id, obra_id),
    ).fetchone()[0]
    if hay:
        raise ErrorImportacion("La obra ya tiene avances manuales o certificaciones: no se puede sustituir el presupuesto.")
    r = mod_presupuesto.leer(archivo)
    if not r["capitulos"]:
        raise ErrorImportacion("No se han encontrado partidas en el presupuesto. " + " ".join(r["avisos"]))
    cx.execute("delete from capitulos where obra_id = %s", (obra_id,))
    n = 0
    for i, c in enumerate(r["capitulos"]):
        cap_id = cx.execute(
            "insert into capitulos (obra_id, codigo, nombre, orden) values (%s,%s,%s,%s) returning id",
            (obra_id, c["codigo"] or f"{i + 1:02d}", c["nombre"], i),
        ).fetchone()[0]
        for j, p in enumerate(c["partidas"]):
            cx.execute(
                """insert into partidas (obra_id, capitulo_id, codigo, resumen, descripcion, unidad, medicion, precio, orden)
                   values (%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                (obra_id, cap_id, p["codigo"], p["resumen"], p["descripcion"], p["unidad"], p["medicion"] or 0, p["precio"] or 0, j),
            )
            n += 1
    return {"capitulos": len(r["capitulos"]), "partidas": n, "total": r["total"], "suma_partidas": r["suma_partidas"], "avisos": r["avisos"]}


def vincular(cx, obra_id) -> dict:
    """Crea los trabajos y fases que faltan, según las partidas y los tipos de elemento presentes."""
    tipos = dict(cx.execute("select clave, id from tipos_elemento where obra_id = %s", (obra_id,)).fetchall())
    partidas = [{"id": str(i), "resumen": r, "unidad": u, "medicion": float(m or 0)}
                for i, r, u, m in cx.execute("select id, resumen, unidad, medicion from partidas where obra_id = %s order by orden", (obra_id,)).fetchall()]
    if not tipos or not partidas:
        return {"trabajos": 0, "avisos": []}
    # solo cuentan los tipos con elementos (si no hay puertas detectadas, las puertas van por vivienda)
    conteo: dict[str, int] = {}
    for clave, viv, uso, n in cx.execute(
        """select t.clave, e.vivienda, e.uso, count(*) from elementos e join tipos_elemento t on t.id = e.tipo_id
           where e.obra_id = %s group by 1, 2, 3""", (obra_id,)).fetchall():
        conteo[clave] = conteo.get(clave, 0) + n
        if clave == "VIV":
            k = "VIV:comunes" if viv == "COMUN" else "VIV:viviendas"
            conteo[k] = conteo.get(k, 0) + n
        if clave == "EST" and uso:
            k = {"bano": "EST:banos", "cocina": "EST:cocinas", "comun": "EST:comunes"}.get(uso)
            if k:
                conteo[k] = conteo.get(k, 0) + n
    presentes = {c for c in tipos if conteo.get(c, 0) > 0}
    existentes = {(str(t), str(p)) for t, p in cx.execute("select tipo_id, partida_id from trabajos where obra_id = %s", (obra_id,)).fetchall()}
    vinculadas = {str(p) for (_, p) in existentes}
    creados = 0
    propuestos, avisos = vinculos.proponer_con_avisos(partidas, presentes, conteo)
    for t in propuestos:
        tipo_id = tipos[t["tipo"]]
        if (str(tipo_id), t["partida_id"]) in existentes or t["partida_id"] in vinculadas:
            continue
        tid = cx.execute(
            """insert into trabajos (obra_id, tipo_id, partida_id, partida_humeda_id, nombre, magnitud, factor, ambito, filtro, orden)
               values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) returning id""",
            (obra_id, tipo_id, t["partida_id"], t["partida_humeda_id"], t["nombre"], t["magnitud"], t["factor"], t["ambito"], t["filtro"], t["orden"]),
        ).fetchone()[0]
        for f in t["fases"]:
            cx.execute("insert into fases (obra_id, trabajo_id, nombre, peso, orden) values (%s,%s,%s,%s,%s)",
                       (obra_id, tid, f["nombre"], f["peso"], f["orden"]))
        creados += 1
    return {"trabajos": creados, "avisos": avisos}


if __name__ == "__main__":
    import sys
    print(json.dumps(procesar_documento(sys.argv[1]), ensure_ascii=False, indent=1))
