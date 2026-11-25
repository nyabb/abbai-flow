# Abbai Flow — standalone container image.
#
# The application is a single Node process: it serves the built SPA and proxies
# Home Assistant so the browser never needs a token. No add-on runtime, no
# ingress path, no supervisor base URL.

ARG BUILD_FROM=node:20-alpine

# ---------- Build stage ----------
FROM --platform=$BUILDPLATFORM node:20-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

# ---------- Runtime stage ----------
FROM ${BUILD_FROM}

RUN apk add --no-cache tini python3 py3-pip
WORKDIR /app
ENV NODE_ENV=production PORT=3000

COPY server/requirements-icloud.txt /tmp/requirements-icloud.txt
RUN python3 -m venv /opt/pyicloud-venv \
  && /opt/pyicloud-venv/bin/pip install --no-cache-dir -r /tmp/requirements-icloud.txt \
  && rm /tmp/requirements-icloud.txt
ENV ABBAI_FLOW_PYTHON=/opt/pyicloud-venv/bin/python

COPY --from=builder /app/dist /app/dist
COPY --from=builder /app/node_modules/ws /app/node_modules/ws
COPY server.js /app/server.js
COPY server/ /app/server/
# Compiled by `npm run build:server` in the builder stage (src/api/planner-rules.ts).
COPY --from=builder /app/server/build /app/server/build
COPY custom_sentences/ /app/custom_sentences/
COPY custom_intents/ /app/custom_intents/

# Home Assistant, Encore, and Spotify integration settings are stored in /data.
VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
