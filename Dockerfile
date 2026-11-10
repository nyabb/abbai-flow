ARG BUILD_FROM=ghcr.io/hassio-addons/base:16.3.2

# ---------- Build stage ----------
# Pinned to the *build* platform, not the target platform. Its output is
# architecture-independent -- static JS/CSS from vite plus the pure-JS `ws`
# package -- so building it once on native amd64 is equivalent to building it
# per target, except that the per-target builds run under QEMU for arm64 and
# armv7, where Node/V8 is roughly an order of magnitude slower. Without this
# flag a three-platform release ran `npm ci` and `tsc && vite build` three
# times, two of them emulated, which is where the multi-hundred-second
# `Build and push` times came from. Verified: `tsc` 4.3s and `vite build` 4.0s
# natively, so 8s per pass rather than 8s x 3 with two QEMU multipliers.
FROM --platform=$BUILDPLATFORM node:20-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

# ---------- Runtime stage ----------
FROM ${BUILD_FROM}

RUN apk add --no-cache nodejs

WORKDIR /app

COPY --from=builder /app/dist /app/dist
COPY --from=builder /app/node_modules/ws /app/node_modules/ws
COPY run.sh /etc/services.d/beacon/run
COPY server.js /app/server.js
# Request handling lives in server/app.cjs and is required by server.js.
COPY server/ /app/server/
# Planner mutation rules are shared with the browser bundle (server/app.cjs
# imports them at runtime, so they must exist next to `server/`).
COPY shared/ /app/shared/
COPY custom_sentences/ /app/custom_sentences/
COPY custom_intents/ /app/custom_intents/
RUN chmod a+x /etc/services.d/beacon/run

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO /dev/null http://localhost:3000/ || exit 1
