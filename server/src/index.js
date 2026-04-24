require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const logger = require('./lib/logger');
const authRoutes = require('./modules/auth/auth.routes');
const entryRoutes = require('./modules/entries/entry.routes');
const stateRoutes = require('./modules/state/state.routes');
const fileRoutes = require('./modules/files/file.routes');
const recallRoutes = require('./modules/ai/recall.routes');
const { errorHandler } = require('./middleware/errorHandler');
const prisma = require('./lib/prisma');

const app = express();
const PORT = process.env.PORT || 8000;

// ─── Global Middleware ────────────────────────────────────────────

app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
}));
app.use(logger.requestLogger());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100,
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

// ─── Health Check ─────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'flowra-api',
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

// ─── API Routes ───────────────────────────────────────────────────

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/entries', entryRoutes);
app.use('/api/v1/state', stateRoutes);
app.use('/api/v1/files', fileRoutes);
app.use('/api/v1/recall', aiLimiter, recallRoutes);

// ─── 404 Handler ──────────────────────────────────────────────────

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found` },
  });
});

// ─── Error Handler ────────────────────────────────────────────────

app.use(errorHandler);

// ─── Start Server ─────────────────────────────────────────────────

const { initializeEngines } = require('./engines');

let server;

async function start() {
  // Verify database connection
  await prisma.$connect();
  logger.info('Database connected');

  // Initialize all engines before accepting requests
  await initializeEngines();
  logger.info('All engines initialized');

  server = app.listen(PORT, () => {
    logger.info(`Flowra API running`, { port: PORT, env: process.env.NODE_ENV || 'development' });
  });
}

// ─── Graceful Shutdown ────────────────────────────────────────────

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
    await prisma.$disconnect();
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
  process.exit(1);
});

module.exports = app;
