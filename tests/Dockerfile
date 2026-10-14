FROM node:24.21.0-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY tsconfig.json tsconfig.test.json ./
COPY src ./src
COPY tests ./tests
COPY scripts ./scripts
COPY config ./config
COPY openapi.yaml ./
COPY .validator.json ./
COPY .env.example ./
COPY data/lote_10000.csv ./data/lote_10000.csv
RUN npm run build && npm run typecheck
CMD ["npm", "run", "test:junit"]
