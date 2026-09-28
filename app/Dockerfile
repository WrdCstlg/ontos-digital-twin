# syntax=docker/dockerfile:1.7
#
# Ontos application image. One image serves several roles:
#   app          — `node dist/boot.js`          (the default CMD)
#   init         — `node dist/db/bootstrap.js`  (migrate, first-boot seed, admin account)
#   worker       — `node dist/worker.js`        (background jobs)
#   engine host  — `node dist/engineHost.js`    (one open-ontologies engine per workspace;
#                                                not used by the app yet)
#
# Everything the server and bootstrap need is bundled by esbuild into dist/,
# so the runtime stage carries no node_modules and no build tooling.

ARG NODE_IMAGE=node:24.11.1-bookworm-slim
# The semantic engine, from its official image, by digest. Keep in step with
# compose.yaml and with ENGINE_VERSION in .github/workflows/ci.yml.
ARG ENGINE_IMAGE=ghcr.io/fabio-rovai/open-ontologies:1.3.0@sha256:db7a7e0f03ae7c3df4649c81d438a0952033abe4b524d3cd84d59dd617e4207a

FROM ${ENGINE_IMAGE} AS engine

# ── Build ──────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
# Where the client says its source is (AGPL section 13; src/lib/source.ts).
# Vite reads these when it builds, so they are build arguments: set them in
# .env for compose, or with --build-arg, and rebuild after changing them.
ARG VITE_SOURCE_URL=
ARG VITE_SOURCE_COMMIT=
RUN npm run build && npm run build:db

# ── Runtime ────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app

# The engine binary, for the engine host. Both images are Debian 12 (glibc);
# of the libraries the binary loads, this one lacks only OpenSSL's two (ldd:
# libssl.so.3, libcrypto.so.3), copied from the engine image beside it. They
# go in a directory of their own, so nothing apt installs is overwritten, and
# the build fails here if the binary cannot run. It goes in /usr/local/bin,
# not /usr/bin: the app looks for a binary at /bin/open-ontologies (merged
# /usr) and would start engines of its own if it found one.
COPY --from=engine /usr/local/bin/open-ontologies /usr/local/bin/open-ontologies
COPY --from=engine /lib/x86_64-linux-gnu/libssl.so.3 /lib/x86_64-linux-gnu/libcrypto.so.3 /usr/local/lib/open-ontologies/
RUN echo /usr/local/lib/open-ontologies > /etc/ld.so.conf.d/open-ontologies.conf \
 && ldconfig \
 && open-ontologies --help > /dev/null \
 && mkdir -p /var/lib/ontos-engine \
 && chown node:node /var/lib/ontos-engine
ENV ENGINE_HOST_BIN=/usr/local/bin/open-ontologies \
    ENGINE_HOST_DATA_DIR=/var/lib/ontos-engine

# The bundles are ES modules with a .js extension, so Node needs a package
# scope declaring "type": "module" to load them.
RUN printf '{ "private": true, "type": "module" }\n' > package.json

COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/db/migrations ./db/migrations

USER node
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["node", "dist/boot.js"]
