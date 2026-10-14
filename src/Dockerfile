FROM node:24.21.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build

FROM node:24.21.0-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node src/persistence/migrations ./dist/persistence/migrations
COPY --chown=node:node config ./config
USER node
EXPOSE 8083
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 CMD ["node", "--input-type=module", "-e", "try { const r = await fetch('http://127.0.0.1:8083/ready', {signal: AbortSignal.timeout(2000)}); process.exit(r.ok ? 0 : 1); } catch { process.exit(1); }"]
CMD ["node", "dist/main.js"]
