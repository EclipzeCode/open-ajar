'use strict';
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const mongoSanitize = require('express-mongo-sanitize');
const rateLimit = require('express-rate-limit');
const env = require('./config/env');
const applicationRoutes = require('./routes/applicationRoutes');
const { notFound, errorHandler } = require('./middleware/errorHandler');

/** Builds the Express app. Kept separate from server.js so it can be imported by tests. */
function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // behind a reverse proxy / platform load balancer (correct client IPs for rate limiting)

  app.use(helmet());

  app.use(
    cors({
      origin(origin, cb) {
        // Allow non-browser clients (no Origin) and any configured origin. Empty list = allow all (dev).
        if (!origin || env.corsOrigins.length === 0 || env.corsOrigins.includes(origin)) return cb(null, true);
        return cb(new Error('Not allowed by CORS'));
      },
      methods: ['GET', 'POST', 'PUT'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    })
  );

  app.use(express.json({ limit: '32kb' })); // reject oversized bodies
  app.use(mongoSanitize()); // strip $ and . operators to block NoSQL injection

  // Global rate limit across all routes (the public POST has its own tighter limit on top).
  app.use(rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false }));

  app.get('/health', (req, res) => res.json({ ok: true }));
  app.use('/api', applicationRoutes);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
