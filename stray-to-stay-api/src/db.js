'use strict';
const mongoose = require('mongoose');
const env = require('./config/env');

mongoose.set('strictQuery', true);

/** Connects to MongoDB and wires connection lifecycle logging. Throws if it cannot connect. */
async function connectDatabase() {
  mongoose.connection.on('connected', () => console.log('[db] connected'));
  mongoose.connection.on('error', (err) => console.error('[db] connection error:', err.message));
  mongoose.connection.on('disconnected', () => console.warn('[db] disconnected'));

  await mongoose.connect(env.mongoUri, {
    serverSelectionTimeoutMS: 10000,
    maxPoolSize: 10,
  });
  return mongoose.connection;
}

module.exports = { connectDatabase };
