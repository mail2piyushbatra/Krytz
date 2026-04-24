#!/bin/sh
set -e

echo "✦ Running Prisma migrations..."
cd /app/server
npx prisma migrate deploy

echo "✦ Starting Flowra API..."
cd /app
exec node server/src/index.js
