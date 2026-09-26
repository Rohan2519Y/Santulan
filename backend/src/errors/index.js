const HttpError = require('./HttpError');
const CODES = require('./codes');
const logger = require('../utils/logger');

function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (err instanceof HttpError) {
    const error = { code: err.code, message: err.message, details: err.details || {} };
    if (err.totalProblems !== undefined) error.totalProblems = err.totalProblems; // upload rejections list every problem (capped) plus the total
    return res.status(err.status).json({ error });
  }

  if (err && err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: { code: 'UPLOAD_TOO_LARGE', message: 'File exceeds the size limit', details: {} } });
    }
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: err.message, details: {} } });
  }

  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Malformed JSON body', details: {} } });
  }

  if (err && err.name === 'ZodError') {
    return res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'Request validation failed', details: { issues: err.issues } },
    });
  }

  logger.error({ err }, 'Unhandled error');
  return res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', details: {} },
  });
}

module.exports = { HttpError, CODES, errorHandler };
