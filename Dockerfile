# syntax=docker/dockerfile:1
# Everything:       docker build -t toolmaster .
# One tool only:    docker build --build-arg TOOLS=pdf-pages -t toolmaster-pdf-pages .
# Run:              docker run --rm -p 127.0.0.1:5757:5757 toolmaster   (then open http://127.0.0.1:5757)
#
# The image is built from the same "lite" bundle the release zips use: one bundled JavaScript file (only the chosen
# tools and their libraries), the engines those tools need, and the web app. No node_modules, no sources.
ARG TOOLS=all

FROM node:24-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c AS build
ARG TOOLS
# Tectonic builds a TLS client at startup and panics without a CA bundle.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY web/package.json web/package-lock.json ./web/
RUN npm --prefix web ci
COPY web ./web
RUN npm --prefix web run build
COPY core ./core
COPY tools ./tools
COPY engines ./engines
COPY bin ./bin
COPY scripts ./scripts
COPY LICENSE ./
# Download only the engines the chosen tools need (checksum-verified), prime their caches, then bundle just those tools.
RUN set -e; T=""; if [ "$TOOLS" != "all" ]; then T="$(echo "$TOOLS" | tr ',' ' ')"; fi; \
    node bin/toolmaster.mjs install $T && node bin/toolmaster.mjs warmup $T && \
    node scripts/build-portable.mjs --tools "$TOOLS" --runtime node --no-pack --out /out

FROM node:24-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c
LABEL org.opencontainers.image.source="https://github.com/rajatgedam/ToolMaster" \
      org.opencontainers.image.licenses="MIT"
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    TOOLMASTER_HOST=0.0.0.0 \
    TOOLMASTER_ALLOW_REMOTE=1 \
    TOOLMASTER_PORT=5757
WORKDIR /app
COPY --from=build --chown=node:node /out /app
USER node
EXPOSE 5757
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:5757/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "toolmaster.cjs", "ui", "--no-open"]
