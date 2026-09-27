'use strict';
const mongoose = require('mongoose');
const env = require('./config/env');
const { connectDatabase } = require('./db');
const { createApp } = require('./app');
const { getTransporter } = require('./services/email');

async function start() {
  await connectDatabase();

  // Verify SMTP once at boot so a bad email config surfaces immediately (non-fatal: the API still serves).
  const transporter = getTransporter();
  if (transporter) {
    try {
      await transporter.verify();
      console.log('[email] SMTP ready; alerts will be sent to', env.cofounderEmails.length, 'recipient(s)');
    } catch (e) {
      console.warn('[email] SMTP verify failed; alerts may not send:', e.message);
    }
  } else {
    console.warn('[email] not configured; critical alerts will be skipped');
  }

  const app = createApp();
  const server = app.listen(env.port, () => console.log(`[server] listening on :${env.port} (${env.nodeEnv})`));

  // Graceful shutdown: stop accepting connections, close the DB, then exit.
  const shutdown = (signal) => {
    console.log(`\n[server] ${signal} received, shutting down`);
    server.close(async () => {
      await mongoose.connection.close().catch(() => {});
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref(); // force-exit if it hangs
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => console.error('[unhandledRejection]', reason));
}

start().catch((err) => {
  console.error('[server] failed to start:', err.message);
  process.exit(1);
});
