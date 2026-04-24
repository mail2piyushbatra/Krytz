const jwt = require('jsonwebtoken');
const { AppError } = require('./errorHandler');

/**
 * JWT authentication middleware.
 * Extracts Bearer token, verifies it, and attaches user to req.
 */
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new AppError('Authentication required.', 401, 'UNAUTHORIZED'));
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: decoded.sub, email: decoded.email };
    next();
  } catch (err) {
    next(err); // Will be caught by errorHandler (JWT errors)
  }
}

module.exports = { authenticate };
