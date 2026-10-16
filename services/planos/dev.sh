#!/bin/sh
# Arranca el servicio en local con las variables de .env
cd "$(dirname "$0")"
set -a; . ./.env; set +a
exec .venv/bin/uvicorn atalaya_planos.api:app --host 127.0.0.1 --port "${PORT:-8000}" --reload
