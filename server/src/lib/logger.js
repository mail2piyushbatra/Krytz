/**
 * ✦ FLOWRA LOGGER
 *
 * Structured JSON logging with levels, context, and request tracing.
 * Replaces console.log/Morgan with a proper logging system.
 *
 * Levels: error > warn > info > debug
 * Output: JSON to stdout (compatible with Loki, Datadog, CloudWatch)
 */

const LOG_LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const CURRENT_LEVEL = LOG_LEVELS[process.env.LOG_LEVEL || 'info'];

function formatLog(level, message, meta = {}) {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    service: 'flowra-api',
    message,
    ...meta,
    ...(meta.error && {
      error: {
        message: meta.error.message,
        stack: process.env.NODE_ENV !== 'production' ? meta.error.stack : undefined,
      },
    }),
  });
}

const logger = {
  error(message, meta = {}) {
    if (CURRENT_LEVEL >= LOG_LEVELS.error) {
      process.stderr.write(formatLog('error', message, meta) + '\n');
    }
  },

  warn(message, meta = {}) {
    if (CURRENT_LEVEL >= LOG_LEVELS.warn) {
      process.stdout.write(formatLog('warn', message, meta) + '\n');
    }
  },

  info(message, meta = {}) {
    if (CURRENT_LEVEL >= LOG_LEVELS.info) {
      process.stdout.write(formatLog('info', message, meta) + '\n');
    }
  },

  debug(message, meta = {}) {
    if (CURRENT_LEVEL >= LOG_LEVELS.debug) {
      process.stdout.write(formatLog('debug', message, meta) + '\n');
    }
  },

  /**
   * Express middleware: log every request/response.
   */
  requestLogger() {
    return (req, res, next) => {
      const start = Date.now();

      // Capture response finish
      res.on('finish', () => {
        const duration = Date.now() - start;
        const meta = {
          method: req.method,
          path: req.path,
          status: res.statusCode,
          duration: `${duration}ms`,
          userId: req.user ? req.user.id : undefined,
          ip: req.ip,
          userAgent: req.get('user-agent'),
        };

        if (res.statusCode >= 500) {
          logger.error(`${req.method} ${req.path} ${res.statusCode}`, meta);
        } else if (res.statusCode >= 400) {
          logger.warn(`${req.method} ${req.path} ${res.statusCode}`, meta);
        } else {
          logger.info(`${req.method} ${req.path} ${res.statusCode}`, meta);
        }
      });

      next();
    };
  },
};

module.exports = logger;
