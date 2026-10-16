from atalaya_planos.vinculos import es_variante_humeda, proponer, proponer_con_avisos

PARTIDAS = [
    ("01.06", "Demolición de falso techo registrable"),
    ("02.05", "Tabique sencillo con lana de roca"),
    ("02.06", "Tabique sencillo con lana de roca H"),
    ("02.07", "Trasdosado autoportante con lana de roca medianeras y fachada"),
    ("02.08", "Trasdosado autoportante H con lana de roca medianeras y fachada"),
    ("02.09", "Tabique pladur medianera entre viviendas con lana de roca"),
    ("02.10", "Tabique pladur medianera entre viviendas con lana de roca H"),
    ("02.11", "Falso techo continuo de placas de yeso laminado con lana de roca"),
    ("02.12", "Falso techo H continuo de placas de yeso laminado con lana de roca"),
    ("03.01", "Mortero autonivelante"),
    ("03.02", "Pavimento interior de piezas de gres porcelánico"),
    ("03.03", "Rodapié PVC 7cm"),
    ("03.04", "Revestimiento interior paredes alicatado baños 30*90"),
    ("03.05", "Pintura blanca paredes paredes y techos interior"),
    ("03.07", "Pintura blanca paredes paredes y exterior"),
    ("04.01", "Instalación eléctrica según plano"),
    ("06.04", "Plato ducha 180x80"),
    ("06.06", "Inodoro tanque bajo"),
    ("07.06", "Horno"),
    ("09.01", "Puerta abatible blanca 72,5x2030"),
    ("09.02", "Puerta abatible blanca 82,5x2030"),
    ("08.01", "Carpintería PVC blanca con persianas medidas según plano."),
    ("01.08", "Levantado de carpintería acristalada de aluminio."),
]


def test_variante_humeda():
    assert es_variante_humeda("Tabique sencillo con lana de roca H")
    assert es_variante_humeda("Falso techo H continuo")
    assert not es_variante_humeda("Hoja exterior ladrillo hueco")


def test_proponer_presupuesto_tipo():
    ps = [{"id": c, "resumen": r} for c, r in PARTIDAS]
    t = proponer(ps, {"TB", "MD", "TS", "EST"})
    pares = {(x["tipo"], x["partida_id"], x["partida_humeda_id"]) for x in t}
    assert ("TB", "02.05", "02.06") in pares
    assert ("TS", "02.07", "02.08") in pares
    assert ("MD", "02.09", "02.10") in pares
    assert ("EST", "02.11", "02.12") in pares
    assert ("EST", "03.03", None) in pares
    usadas = {x["partida_id"] for x in t}
    assert "01.06" not in usadas and "03.07" not in usadas
    pintura = {x["tipo"]: x["factor"] for x in t if x["partida_id"] == "03.05"}
    assert pintura == {"TB": 2, "MD": 2, "TS": 1, "EST": 1}
    for x in t:
        assert abs(sum(f["peso"] for f in x["fases"]) - 1) < 1e-9
    alic = next(x for x in t if x["partida_id"] == "03.04")
    assert alic["ambito"] == "banos"


def test_unidades_por_vivienda_y_estancia():
    ps = [{"id": c, "resumen": r, "medicion": m} for c, r, m in [
        ("04.01", "Instalación eléctrica según plano", 5), ("06.06", "Inodoro tanque bajo", 5), ("07.06", "Horno", 5),
        ("09.01", "Puerta abatible blanca 72,5x2030", 4), ("09.02", "Puerta abatible blanca 82,5x2030", 6),
        ("08.01", "Carpintería PVC blanca con persianas", 12), ("01.08", "Levantado de carpintería acristalada", 1),
    ]]
    conteo = {"VIV": 6, "VIV:viviendas": 5, "VIV:comunes": 1, "EST": 20, "EST:banos": 5, "EST:cocinas": 5, "PI": 7}
    t, avisos = proponer_con_avisos(ps, {"VIV", "EST", "PI"}, conteo)
    por = {x["partida_id"]: x for x in t}
    assert por["04.01"]["tipo"] == "VIV" and por["04.01"]["ambito"] == "viviendas" and por["04.01"]["factor"] == 1
    assert por["06.06"]["tipo"] == "EST" and por["06.06"]["ambito"] == "banos" and por["06.06"]["factor"] == 1
    assert por["07.06"]["ambito"] == "cocinas"
    assert por["09.01"]["tipo"] == "PI" and por["09.01"]["filtro"] == "72"
    assert por["09.02"]["filtro"] == "82"
    assert por["08.01"]["tipo"] == "VIV"  # no hay ventanas en el plano: por vivienda
    assert "01.08" not in por
    # sin puertas en el plano, las puertas van por vivienda
    t2 = proponer(ps, {"VIV", "EST"}, conteo)
    assert next(x for x in t2 if x["partida_id"] == "09.01")["tipo"] == "VIV"
