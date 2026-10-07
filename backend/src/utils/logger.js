/*
 * Structured process logger (pino). Same messages and the same conditions the codebase already logged under (console.*
 * calls, each gated exactly as before) - only the output format changes, from a bare string/console line to a structured
 * JSON log line (pretty-printed in development). Silent during tests, same as the console.* calls were already suppressed
 * in test env at their call sites.
 */
const pino = require('pino');
const config = require('../config');

module.exports = pino({
  level: config.env === 'test' ? 'silent' : config.logLevel,
  // G-44: credentials never reach a log line, in any environment, even if a caller passes the whole object. (The one deliberate
  // exception - a local developer reading a one-time code or reset link - logs under the key `devSecret`, only in development and only
  // while real email is off; see services/identity/index.js.)
  redact: { paths: ['password', 'newPassword', 'token', 'accessToken', 'refreshToken', 'temporaryPassword', 'secret', 'emailVerificationToken', '*.password', '*.newPassword', '*.token', '*.accessToken', '*.temporaryPassword', '*.emailVerificationToken', 'req.headers.authorization', 'headers.authorization'], censor: '[redacted]' },
  transport: config.env === 'production' ? undefined : { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } },
});
