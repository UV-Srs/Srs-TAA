# ---------- Stage 1: build React frontend ----------
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---------- Stage 2: Python runtime ----------
FROM python:3.11-slim
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HOST=0.0.0.0 \
    PORT=8000
WORKDIR /app

COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY run.py alembic.ini ./
COPY backend/ backend/
COPY --from=frontend-build /app/frontend/dist frontend/dist

RUN mkdir -p /app/backend/uploads
VOLUME ["/app/backend/uploads"]

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD python -c "import urllib.request,os;urllib.request.urlopen('http://127.0.0.1:%s/api/health'%os.getenv('PORT','8000'))" || exit 1

# Migrations run first. If they fail (or the database must be adopted by hand), the container exits
# and the app never starts. No script file on purpose: it avoids Windows line-ending problems.
CMD ["sh", "-c", "python backend/scripts/migrate.py && exec python run.py"]
