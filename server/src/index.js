require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const rateLimit = require('express-rate-limit');

const logger         = require('./lib/logger');
const authRoutes     = require('./modules/auth/auth.routes');
const entryRoutes    = require('./modules/entries/entry.routes');
const stateRoutes    = require('./modules/state/state.routes');
const fileRoutes     = require('./modules/files/file.routes');
const recallRoutes   = require('./modules/recall/recall.routes');
const itemRoutes     = require('./modules/items/item.routes');
const categoryRoutes = require('./modules/categories/category.routes');
const analyticsRoutes = require('./modules/analytics/analytics.routes');
const exportRoutes   = require('./modules/export/export.routes');
const { errorHandler } = require('./middleware/errorHandler');
const db = require('./lib/db');

// â”€â”€â”€ V3 Infrastructure â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const { intelligenceRoutes, stripeWebhookRoute } = require('./modules/intelligence/intelligence.routes');
const productRoutesV2 = require('./modules/product/product.routes.v2');
const supportRoutes   = require('./modules/support/support.routes');
const platformRoutes  = require('./modules/platform/platform.routes');
const inspectorRoutes = require('./modules/inspector/inspector.routes');
const { rlsMiddleware } = require('./middleware/rls.middleware');
const { tierMiddleware } = require('./lib/tiers');
const { startCron }     = require('./lib/cron');
const { runBootMigrations } = require('./lib/bootMigrations');

// Single shared pg Pool â€” all modules use lib/db.js
const pool = db;

const app = express();
const PORT = process.env.PORT || 8000;

// â”€â”€â”€ Global Middleware â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const { requestId } = require('./middleware/requestId');
app.use(requestId);
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',')
    : ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175', 'http://localhost:8088', 'http://localhost:19006'],
  credentials: true,
}));
app.use(logger.requestLogger());

// Stripe verifies against the exact raw bytes, so mount this before JSON parsing.
if (pool) app.use('/api/v1', stripeWebhookRoute(pool));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const apiRateLimitMax = Number(process.env.API_RATE_LIMIT_MAX || 600);
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: apiRateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.' },
  },
});
app.use('/api', limiter);

// AI endpoints get stricter rate limiting
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: {
    success: false,
    error: { code: 'RATE_LIMITED', message: 'AI endpoint rate limit reached.' },
  },
});

// â”€â”€â”€ Health Check â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Krytz-api',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// Engine health endpoint
app.get('/health/engines', (req, res) => {
  const { engines } = require('./engines');
  res.json({
    status: 'ok',
    engines: engines.cortex.getSystemHealth(),
  });
});

// â”€â”€â”€ API Routes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

if (pool) app.use('/api/v1', rlsMiddleware(pool));

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/entries', entryRoutes);
app.use('/api/v1/items', itemRoutes);
app.use('/api/v1/categories', categoryRoutes);
app.use('/api/v1/analytics', analyticsRoutes);
app.use('/api/v1/export', exportRoutes);
app.use('/api/v1/state', stateRoutes);
app.use('/api/v1/files', fileRoutes);
app.use('/api/v1/recall', aiLimiter, recallRoutes);

// â”€â”€â”€ V3 Routes (pool-based, tier + RLS aware) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
if (pool) {
  // Attach tier to req for feature-gate middleware
  app.use('/api/v1', tierMiddleware(pool));

  // Intelligence routes: contradictions, commitments, simulate, estimate, capacity, billing, gdpr, plan/week
  // Mounted at /intelligence sub-path to match documented API surface and avoid collisions
  app.use('/api/v1/intelligence', intelligenceRoutes(pool));

  // Product v2: capture, plan/today, explain, action, undo, feedback, metrics
  const { engines } = require('./engines');
  app.use('/api/v1', productRoutesV2(engines, pool));

  // Support routes: rules CRUD, notifications, stats
  app.use('/api/v1', supportRoutes(pool));

  // Platform console: read-only operator/devops/coder visibility
  app.use('/api/v1', platformRoutes(pool));

  // Inspector: traces, replay, anomalies, decisions, graph, connectors
  app.use('/api/v1/inspector', inspectorRoutes(pool));
}

// â”€â”€â”€ 404 Handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found` },
  });
});

// â”€â”€â”€ Error Handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

app.use(errorHandler);

// â”€â”€â”€ Start Server â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const { initializeEngines } = require('./engines');

let server;

async function start() {
  // Verify database connection
  await db.verifyConnection();
  logger.info('Database connected');

  await runBootMigrations(db);
  logger.info('Database schema ready');

  // Initialize all engines before accepting requests
  await initializeEngines();
  logger.info('All engines initialized');

  server = app.listen(PORT, () => {
    logger.info(`Krytz API running`, { port: PORT, env: process.env.NODE_ENV || 'development' });
  });

  // Start cron scheduler (requires pg pool)
  if (pool) {
    startCron(pool);
    logger.info('Cron scheduler started');
  }
}

// â”€â”€â”€ Graceful Shutdown â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function shutdown(signal) {
  logger.info(`${signal} received. Shutting down gracefully...`);

  // Stop accepting new connections
  if (server) {
    server.close(() => {
      logger.info('HTTP server closed');
    });
  }

  // Disconnect database
  try {
    await db.closePool();
    logger.info('Database disconnected');
  } catch (err) {
    logger.error('Error disconnecting database', { error: err });
  }

  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start().catch((err) => {
  logger.error('Failed to start server', { error: err });
  // Railway's log viewer parses JSON and only shows `message`, hiding err.message.
  // Write the raw error directly so the actual cause is always visible.
  process.stderr.write(`STARTUP ERROR: ${err.message}\n${err.stack || ''}\n`);
  process.exit(1);
});

module.exports = app;
