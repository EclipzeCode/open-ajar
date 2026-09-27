'use strict';
const { Schema, model } = require('mongoose');

/**
 * Distress indicators that feed the vulnerability score. Map your application form's
 * distress questions to these fields. All optional with safe defaults so a partial
 * form still scores.
 */
const metricsSchema = new Schema(
  {
    revenueDeclinePercent: { type: Number, min: 0, max: 100, default: 0 },
    monthsBehindOnRent: { type: Number, min: 0, max: 60, default: 0 },
    monthsUntilClosure: { type: Number, min: 0, max: 60, default: 12 }, // owner's estimate; lower = more urgent
    employeesAtRisk: { type: Number, min: 0, max: 1000, default: 0 },
    yearsInOperation: { type: Number, min: 0, max: 200, default: 0 },
    priorAidReceived: { type: Boolean, default: false },
  },
  { _id: false }
);

const applicationSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 }, // restaurant name
    owner: { type: String, required: true, trim: true, maxlength: 200 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 320 },
    address: { type: String, required: true, trim: true, maxlength: 400 },
    statement: { type: String, default: '', trim: true, maxlength: 5000 },
    allocation: { type: Number, min: 0, max: 1000000, default: 0 }, // grant dollars requested / to allocate

    metrics: { type: metricsSchema, default: () => ({}) },

    // Computed server-side by services/scoring.js. Never trust a score sent by the client.
    vulnerabilityScore: { type: Number, min: 1, max: 100, required: true, index: true },

    status: { type: String, enum: ['pending', 'approved', 'declined'], default: 'pending', index: true },
    decisionNote: { type: String, default: '', trim: true, maxlength: 2000 },
    reviewedAt: { type: Date, default: null },
  },
  { timestamps: true } // adds createdAt / updatedAt automatically
);

// Supports the "highest vulnerability first" list query efficiently.
applicationSchema.index({ vulnerabilityScore: -1, createdAt: -1 });

module.exports = model('RestaurantApplication', applicationSchema);
