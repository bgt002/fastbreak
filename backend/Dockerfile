# Generic container for FastAPI: works on Fly.io, Cloud Run, Render, Railway
# — anywhere that injects $PORT and runs the CMD. Python 3.12 is the most
# reliable target for nba_api right now (3.13/3.14 work but some scientific
# deps still ship 3.12 wheels first).
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# uvicorn directly (not gunicorn) is fine for this workload because most
# requests are I/O-bound on stats.nba.com / ESPN; the host platform handles
# concurrency by spinning additional container instances when needed.
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080}"]
