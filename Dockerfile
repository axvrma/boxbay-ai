# syntax=docker/dockerfile:1
FROM scratch AS wheelhouse
FROM python:3.11-slim
WORKDIR /srv/boxbay
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 BOXBAY_STATE_DIR=/tmp/boxbay
RUN adduser --system --group --no-create-home boxbay \
    && install -d -o boxbay -g boxbay /var/lib/boxbay
COPY services/intelligence/requirements-runtime.txt requirements.txt
ARG PIP_NO_INDEX=0
RUN --mount=type=bind,from=wheelhouse,target=/wheels pip install --no-cache-dir --timeout 90 --find-links /wheels -r requirements.txt
COPY services ./services
COPY infra/001_documents.sql ./infra/001_documents.sql
COPY data/models ./data/models
COPY apps/web/public/evidence/*.json ./apps/web/public/evidence/
USER boxbay
EXPOSE 8000
CMD ["sh", "-c", "exec uvicorn services.intelligence.api:app --host 0.0.0.0 --port \"${PORT:-8000}\" --no-access-log"]
