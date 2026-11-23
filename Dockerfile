# ── Stage 1: Build React frontend ──────────────────────────────────
FROM node:20-alpine AS frontend-build

WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci --legacy-peer-deps

COPY frontend/ ./
# Disable HTTPS plugin in production build (backend serves over plain HTTP)
RUN sed -i 's/basicSsl(),//g' vite.config.ts && \
    sed -i '/plugin-basic-ssl/d' vite.config.ts && \
    npm run build

# ── Stage 2: Python backend + embedded frontend dist ───────────────
FROM python:3.12-slim

WORKDIR /app

# System deps for psycopg2, Pillow, reportlab, python-barcode
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        libpq-dev gcc g++ libffi-dev libssl-dev \
        libjpeg-dev zlib1g-dev libpng-dev \
    && rm -rf /var/lib/apt/lists/*

# Install Python deps
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

# Copy backend source
COPY backend/ ./backend/

# Copy the compiled frontend into the location main.py looks for
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

# Create uploads directory
RUN mkdir -p backend/uploads

EXPOSE 8000

CMD ["uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8000"]
