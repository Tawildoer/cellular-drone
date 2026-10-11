# The server image. Build from the repository root, which holds the shared
# protocol package the server imports:
#   docker build -f server/Dockerfile -t cellular-drone-server .
# deploy/docker-compose.yml does this for you.
FROM node:24-slim

WORKDIR /app
# The root workspace installs zod for packages/protocol.
COPY package.json package-lock.json ./
COPY packages/protocol/package.json packages/protocol/
RUN npm ci --omit=dev --ignore-scripts
COPY packages/protocol packages/protocol

COPY server/package.json server/package-lock.json server/
RUN cd server && npm ci --omit=dev --ignore-scripts
COPY server/tsconfig.json server/
COPY server/src server/src

# Everything that must survive a new image: database, signing key, flight logs.
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8788 \
    DB_PATH=/data/server.db \
    SESSION_SIGNING_KEY_FILE=/data/session-signing.key \
    FLIGHT_LOG_DIR=/data/flightlogs
RUN mkdir /data && chown node:node /data
VOLUME /data
USER node
WORKDIR /app/server
EXPOSE 8788
HEALTHCHECK --interval=30s --timeout=5s \
  CMD node -e "fetch('http://127.0.0.1:8788/healthz').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node_modules/.bin/tsx", "src/index.ts"]
