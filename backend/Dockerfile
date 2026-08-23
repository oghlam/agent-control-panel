# Build dependencies and Python wheels in an isolated stage.
FROM python:3.12-slim AS builder

ENV VIRTUAL_ENV=/opt/venv
ENV PATH="${VIRTUAL_ENV}/bin:${PATH}"

RUN python -m venv "${VIRTUAL_ENV}"
COPY backend/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r /tmp/requirements.txt

# Keep the runtime image small and run the service without root privileges.
FROM python:3.12-slim AS runtime

ENV VIRTUAL_ENV=/opt/venv
ENV PATH="${VIRTUAL_ENV}/bin:${PATH}"
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV PORT=8080

RUN groupadd --system app \
    && useradd --system --gid app --create-home app

WORKDIR /app
COPY --from=builder /opt/venv /opt/venv
COPY backend ./backend

RUN chown -R app:app /app
USER app

EXPOSE 8080
CMD ["sh", "-c", "exec uvicorn backend.main:app --host 0.0.0.0 --port ${PORT}"]
