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
  transport: config.env === 'production' ? undefined : { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } },
});
