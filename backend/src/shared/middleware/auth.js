const jwt = require('jsonwebtoken');
const config = require('../../config');
const { HttpError } = require('../errors');

function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return next(new HttpError(401, 'UNAUTHENTICATED', 'Missing or invalid Authorization header'));
  }

  try {
    const payload = jwt.verify(token, config.jwtSecret);
    req.user = { id: payload.sub, role: payload.role, email: payload.email };
    return next();
  } catch (err) {
    return next(new HttpError(401, 'UNAUTHENTICATED', 'Invalid or expired token'));
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new HttpError(403, 'FORBIDDEN', 'Insufficient role for this operation'));
    }
    return next();
  };
}

module.exports = { authenticate, requireRole };
