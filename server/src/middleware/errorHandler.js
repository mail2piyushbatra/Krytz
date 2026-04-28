const logger = require('../lib/logger');

/**
 * Global error handler middleware.
 * Catches all errors and returns consistent JSON response.
 */
function errorHandler(err, req, res, next) {
  logger.error(err.message, { error: err, path: req.path, method: req.method });

  // PostgreSQL unique violation (was Prisma P2002)
  if (err.code === '23505') {
    return res.status(409).json({
      success: false,
      error: {
        code: 'CONFLICT',
        message: 'A record with this value already exists.',
        details: err.detail,
      },
    });
  }

  // PostgreSQL foreign key violation
  if (err.code === '23503') {
    return res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Referenced record not found.' },
    });
  }

  // Zod validation errors
  if (err.name === 'ZodError') {
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request data.',
        details: err.errors.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        })),
      },
    });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Invalid token.' },
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      error: { code: 'TOKEN_EXPIRED', message: 'Token has expired.' },
    });
  }

  // Custom app errors
  if (err.statusCode) {
    return res.status(err.statusCode).json({
      success: false,
      error: { code: err.code || 'ERROR', message: err.message },
    });
  }

  // Fallback: internal server error
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: process.env.NODE_ENV === 'production'
        ? 'An unexpected error occurred.'
        : err.message,
    },
  });
}

/**
 * Custom AppError class for throwing known errors.
 */
class AppError extends Error {
  constructor(message, statusCode, code) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

module.exports = { errorHandler, AppError };
