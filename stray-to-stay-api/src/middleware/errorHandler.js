'use strict';
const env = require('./../config/env');

function notFound(req, res) {
  res.status(404).json({ error: 'Not found' });
}

/* eslint-disable no-unused-vars */
function errorHandler(err, req, res, next) {
  // Explicit validation failures raised by our validators.
  if (err && err.status === 422 && err.details) {
    return res.status(422).json({ error: 'Validation failed', details: err.details });
  }
  // Mongoose schema validation.
  if (err && err.name === 'ValidationError') {
    const details = Object.fromEntries(Object.entries(err.errors).map(([k, v]) => [k, v.message]));
    return res.status(422).json({ error: 'Validation failed', details });
  }
  if (err && err.name === 'CastError') return res.status(400).json({ error: 'Invalid identifier' });
  if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'Payload too large' });
  if (err && /Not allowed by CORS/.test(err.message || '')) return res.status(403).json({ error: 'Origin not allowed' });

  const status = err.status || 500;
  if (status >= 500) console.error('[error]', err);
  const message = status >= 500 && env.isProd ? 'Internal server error' : err.message || 'Error';
  res.status(status).json({ error: message });
}
/* eslint-enable no-unused-vars */

module.exports = { notFound, errorHandler };
