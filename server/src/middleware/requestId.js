const crypto = require('crypto');

/**
 * Request ID middleware.
 * Generates a unique X-Request-Id for every incoming request.
 * Used for log correlation and debugging.
 */
function requestId(req, res, next) {
  const id = req.headers['x-request-id'] || crypto.randomUUID();
  req.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
}

module.exports = { requestId };
