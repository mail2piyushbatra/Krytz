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


# â”€â”€â”€ Development â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
FROM base AS development

ENV NODE_ENV=development

EXPOSE 8000

# Run migrations then start dev server
CMD ["sh", "-c", "cd /app && npm run dev:server"]

# â”€â”€â”€ Production â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
FROM node:20-alpine AS production

WORKDIR /app

ENV NODE_ENV=production

COPY package.json ./
COPY server/package.json ./server/
COPY shared/package.json ./shared/

RUN npm install --workspace=server --workspace=shared --production=true

COPY shared/ ./shared/
COPY server/ ./server/


# Entrypoint script: migrate then start
COPY server/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

# Non-root user for security
RUN addgroup -g 1001 -S Krytz && \
    adduser -S Krytz -u 1001 -G Krytz
USER Krytz

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8000/health || exit 1

CMD ["/app/docker-entrypoint.sh"]
