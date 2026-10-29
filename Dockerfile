# syntax=docker/dockerfile:1
# Build: docker build -t latextopdf .
# Run:   docker run --rm -p 127.0.0.1:5757:5757 latextopdf   (then open http://127.0.0.1:5757)

FROM node:24-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c AS build
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY scripts ./scripts
COPY bin ./bin
COPY examples ./examples
# Checksum-verified Tectonic download, then prime the package cache so the image also works offline.
RUN node scripts/install-engine.mjs && node scripts/warmup.mjs
COPY web/package.json web/package-lock.json ./web/
RUN npm --prefix web ci
COPY web ./web
RUN npm --prefix web run build

FROM node:24-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c
LABEL org.opencontainers.image.source="https://github.com/rajatgedam/LatexToPDF" \
      org.opencontainers.image.licenses="MIT"
ENV NODE_ENV=production \
    LATEX2PDF_HOST=0.0.0.0 \
    LATEX2PDF_ALLOW_REMOTE=1 \
    LATEX2PDF_PORT=5757
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/src ./src
COPY --from=build --chown=node:node /app/bin ./bin
COPY --from=build --chown=node:node /app/examples ./examples
COPY --from=build --chown=node:node /app/vendor ./vendor
COPY --from=build --chown=node:node /app/web/dist ./web/dist
USER node
EXPOSE 5757
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:5757/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "bin/latex2pdf-ui.mjs", "--no-open"]
