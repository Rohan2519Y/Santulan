const { HttpError } = require('../errors');

/**
 * Validates `req[part]` against a zod schema, replacing it with the parsed
 * (typed/coerced) value on success, or raising a 400 VALIDATION_ERROR with
 * per-field details on failure.
 */
function validate(schema, part = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[part]);
    if (!result.success) {
      const details = { issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) };
      return next(new HttpError(400, 'VALIDATION_ERROR', 'Request validation failed', details));
    }
    req[part] = result.data;
    return next();
  };
}

module.exports = { validate };
