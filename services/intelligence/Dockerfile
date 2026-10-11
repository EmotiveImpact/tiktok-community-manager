# syntax=docker/dockerfile:1
FROM node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df
WORKDIR /app/services/intelligence
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 ffmpeg libpq5 libpq-dev build-essential ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*
COPY services/intelligence/package.json services/intelligence/package-lock.json ./
RUN --mount=type=secret,id=proxy_ca,required=false \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    npm ci --omit=dev --no-audit --no-fund \
    && node -e "require('pg-native'); require('tiktok-live-connector')" \
    && npm cache clean --force
COPY --chown=node:node services/intelligence/src ./src
COPY --chown=node:node services/intelligence/speech ./speech
COPY --chown=node:node services/intelligence/scripts/pdf-export.py ./scripts/pdf-export.py
COPY --chown=node:node services/intelligence/runtime-lock.json ./runtime-lock.json
COPY --chown=node:node services/intelligence/runtime-licences ./runtime-licences
COPY --chown=node:node deployment/livelens /app/deployment/livelens
RUN mkdir -p /data/media /data/objects && chown -R node:node /data
USER node
ENV LIVELENS_HOST=0.0.0.0 LIVELENS_PORT=4318 LIVELENS_DB_PATH=/data/intelligence.sqlite \
    LIVELENS_MEDIA_ROOT=/data/media LIVELENS_FFMPEG_PATH=/usr/bin/ffmpeg
EXPOSE 4318
HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:4318/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
ENTRYPOINT ["tini", "--"]
CMD ["node", "src/server.mjs"]
