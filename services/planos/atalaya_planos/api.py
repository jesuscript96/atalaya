"""API del servicio de planos: la app web pide el procesado de un documento ya subido."""
from __future__ import annotations

import os

from fastapi import BackgroundTasks, FastAPI, Header, HTTPException
from pydantic import BaseModel

from . import importar

app = FastAPI(title="Atalaya · servicio de planos")
TOKEN = os.environ.get("SERVICIO_TOKEN", "")


class Peticion(BaseModel):
    documento_id: str


def _autorizar(authorization: str | None):
    if TOKEN and authorization != f"Bearer {TOKEN}":
        raise HTTPException(401, "No autorizado")


@app.get("/salud")
def salud():
    return {"ok": True}


@app.post("/procesar", status_code=202)
def procesar(p: Peticion, tareas: BackgroundTasks, authorization: str | None = Header(None)):
    """Marca el documento como «procesando» y lo importa en segundo plano; la app consulta su estado."""
    _autorizar(authorization)
    tareas.add_task(_procesar, p.documento_id)
    return {"documento_id": p.documento_id, "estado": "procesando"}


@app.post("/vincular/{obra_id}")
def vincular(obra_id: str, authorization: str | None = Header(None)):
    _autorizar(authorization)
    import psycopg
    with psycopg.connect(importar.DATABASE_URL) as cx:
        r = importar.vincular(cx, obra_id)
        cx.commit()
    return r


def _procesar(documento_id: str):
    try:
        importar.procesar_documento(documento_id)
    except Exception:  # el error queda guardado en el documento
        pass
