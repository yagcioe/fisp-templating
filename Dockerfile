# syntax=docker/dockerfile:1

# ---- build: typecheck, compile TS → JS, then strip dev dependencies ----------
FROM node:24-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
# Install scripts are skipped (npm 11 gates them anyway): puppeteer's would only
# download Chrome, which the runtime stage installs itself.
RUN npm ci --ignore-scripts

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run typecheck \
 && npm run build \
 && npm prune --omit=dev

# ---- runtime: compiled JS + production dependencies + Chrome ----------------
FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    # Keep the Chrome download inside /app.
    PUPPETEER_CACHE_DIR=/app/.cache/puppeteer \
    # Chromium's sandbox needs user namespaces, which Docker's default seccomp
    # profile blocks. It only renders our own HTML (user input is escaped).
    PUPPETEER_ARGS="--no-sandbox"

WORKDIR /app

# Fonts for the Kita/Chromium PDFs ("serif" → Liberation Serif). typst uses
# its bundled fonts from @typst-wasm/fonts.
# unzip: puppeteer needs it to extract the Chrome download.
RUN apt-get update \
 && apt-get install -y --no-install-recommends fonts-liberation fonts-dejavu-core unzip \
 && rm -rf /var/lib/apt/lists/*

# package.json is needed at runtime for "type": "module".
COPY package.json package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
# Chrome version is pinned by the installed puppeteer; --install-deps adds the
# shared libraries it needs. This layer is reused until dependencies change.
RUN apt-get update \
 && npx puppeteer browsers install chrome --install-deps \
 && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/dist ./dist

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT}/engines`).then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

# node directly (not npm) so SIGTERM reaches the server's shutdown handler.
CMD ["node", "dist/server.js"]
