# syntax=docker/dockerfile:1.7
#
# Ontos application image. One image serves two roles:
#   app  — `node dist/boot.js`          (the default CMD)
#   init — `node dist/db/bootstrap.js`  (migrate, first-boot seed, admin account)
#
# Everything the server and bootstrap need is bundled by esbuild into dist/,
# so the runtime stage carries no node_modules and no build tooling.

ARG NODE_IMAGE=node:24.11.1-bookworm-slim

# ── Build ──────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build && npm run build:db

# ── Runtime ────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app

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
