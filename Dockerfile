# syntax=docker/dockerfile:1
# Everything:       docker build -t toolmaster .
# One tool only:    docker build --build-arg TOOLS=latex-to-docx -t toolmaster-latex-to-docx .
# Run:              docker run --rm -p 127.0.0.1:5757:5757 toolmaster   (then open http://127.0.0.1:5757)
ARG TOOLS=all

FROM node:24-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c AS build
ARG TOOLS
# Tectonic builds a TLS client at startup and panics without a CA bundle.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json ./
COPY core ./core
COPY tools ./tools
COPY bin ./bin
COPY scripts/prune-tools.mjs ./scripts/prune-tools.mjs
# Keep only the requested tools, download just their engines (checksum-verified), prime their caches.
RUN node scripts/prune-tools.mjs "$TOOLS" && node bin/toolmaster.mjs install && node bin/toolmaster.mjs warmup
COPY web/package.json web/package-lock.json ./web/
RUN npm --prefix web ci
COPY web ./web
RUN npm --prefix web run build

FROM node:24-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c
LABEL org.opencontainers.image.source="https://github.com/rajatgedam/ToolMaster" \
      org.opencontainers.image.licenses="MIT"
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    TOOLMASTER_HOST=0.0.0.0 \
    TOOLMASTER_ALLOW_REMOTE=1 \
    TOOLMASTER_PORT=5757
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/core ./core
COPY --from=build --chown=node:node /app/tools ./tools
COPY --from=build --chown=node:node /app/bin ./bin
COPY --from=build --chown=node:node /app/vendor ./vendor
COPY --from=build --chown=node:node /app/web/dist ./web/dist
USER node
EXPOSE 5757
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:5757/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "bin/toolmaster.mjs", "ui", "--no-open"]
