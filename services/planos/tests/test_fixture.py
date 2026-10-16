"""Pruebas con un proyecto real de muestra.

Los documentos y los valores esperados están en fixtures/private (fuera del repositorio, son datos de clientes):
fixtures/private/esperado.json indica los archivos y las cifras que debe dar la lectura.
"""
import json
from pathlib import Path

import pytest

from atalaya_planos import planos, presupuesto

F = Path(__file__).resolve().parents[3] / "fixtures" / "private"
ESPERADO = json.loads((F / "esperado.json").read_text()) if (F / "esperado.json").exists() else None
pytestmark = pytest.mark.skipif(ESPERADO is None, reason="sin documentos de muestra")


def test_presupuesto():
    r = presupuesto.leer(F / ESPERADO["presupuesto"])
    assert len(r["capitulos"]) == ESPERADO["capitulos"]
    assert sum(len(c["partidas"]) for c in r["capitulos"]) == ESPERADO["partidas"]
    assert r["total"] == pytest.approx(ESPERADO["total"], abs=0.01)
    assert r["suma_partidas"] == pytest.approx(r["total"], abs=0.01)


def test_planos(tmp_path):
    r = planos.analizar(F / ESPERADO["planos"], tmp_path, dpi=60)
    assert len(r["hojas"]) == ESPERADO["hojas"]
    assert {t["clave"] for t in r["tipos"]} == set(ESPERADO["tipos"])
    sup: dict[str, float] = {}
    for e in r["elementos"]:
        sup[e["tipo"]] = sup.get(e["tipo"], 0) + e["longitud"] * e["altura"]
    for clave, valor in ESPERADO["superficie_pared"].items():
        assert sup[clave] == pytest.approx(valor, rel=0.06)
    assert len(r["viviendas"]) >= ESPERADO["viviendas_min"]
