# Cloud Run runs whatever container you push and injects PORT (default 8080).
# Python 3.12 is the most reliable target for nba_api right now — 3.13/3.14 work
# but some scientific deps still ship 3.12 wheels first.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Cloud Run health check pings / on first cold start, so we want the worker up
# fast. uvicorn directly (not gunicorn) is fine for this workload because most
# requests are I/O-bound on stats.nba.com / ESPN; concurrency is handled by
# Cloud Run spinning extra container instances.
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080}"]
