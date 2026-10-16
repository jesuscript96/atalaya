FROM python:3.13-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY atalaya_planos ./atalaya_planos
ENV PORT=8000
CMD ["sh", "-c", "uvicorn atalaya_planos.api:app --host 0.0.0.0 --port ${PORT}"]
