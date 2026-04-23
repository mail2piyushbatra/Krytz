const { z } = require('zod');

/**
 * Middleware factory: validates req.body against a Zod schema.
 */
function validate(schema) {
  return (req, res, next) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (err) {
      next(err); // ZodError → caught by errorHandler
    }
  };
}

module.exports = { validate };
