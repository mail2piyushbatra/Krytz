FROM node:20-alpine AS base

WORKDIR /app

# Install dependencies
COPY package.json ./
COPY server/package.json ./server/
COPY shared/package.json ./shared/

RUN npm install --workspace=server --workspace=shared --production=false

# Copy source
COPY shared/ ./shared/
COPY server/ ./server/

# Generate Prisma client
RUN cd server && npx prisma generate

# ─── Development ───────────────────────────────────────────────
FROM base AS development

ENV NODE_ENV=development

EXPOSE 8000

CMD ["npm", "run", "dev:server"]

# ─── Production ────────────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

ENV NODE_ENV=production

COPY package.json ./
COPY server/package.json ./server/
COPY shared/package.json ./shared/

RUN npm install --workspace=server --workspace=shared --production=true

COPY shared/ ./shared/
COPY server/ ./server/

RUN cd server && npx prisma generate

# Non-root user for security
RUN addgroup -g 1001 -S flowra && \
    adduser -S flowra -u 1001 -G flowra
USER flowra

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8000/health || exit 1

CMD ["node", "server/src/index.js"]
