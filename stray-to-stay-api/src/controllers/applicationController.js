'use strict';
const RestaurantApplication = require('./../models/RestaurantApplication');
const { computeVulnerabilityScore, distressIndicators } = require('./../services/scoring');
const { sendCriticalAlert } = require('./../services/email');
const { assertValid } = require('./../validators/applicationValidators');
const env = require('./../config/env');

/**
 * POST /api/applications
 * Validates input, computes the vulnerability score server-side, persists the record, and
 * (only after a successful write) fires the co-founder alert when the score crosses the threshold.
 */
async function createApplication(req, res) {
  assertValid(req);

  const { name, owner, email, address, statement = '', allocation = 0, metrics = {} } = req.body;

  // The score is always computed here; a score sent by the client is ignored.
  const vulnerabilityScore = computeVulnerabilityScore(metrics);

  const application = await RestaurantApplication.create({
    name, owner, email, address, statement, allocation, metrics, vulnerabilityScore, status: 'pending',
  });

  // Alerting must never break submission: the record is already saved, so we swallow email errors.
  const shouldAlert = vulnerabilityScore >= env.alertThreshold;
  let alerted = false;
  if (shouldAlert) {
    try {
      const result = await sendCriticalAlert(application, distressIndicators(metrics));
      alerted = !result.skipped;
    } catch (e) {
      console.error('[email] critical alert failed:', e.message);
    }
  }

  res.status(201).json({ application, vulnerabilityScore, thresholdMet: shouldAlert, alerted });
}

/**
 * GET /api/applications  (founder panel; admin only)
 * Returns records sorted by highest vulnerability first. Optional ?status=pending|approved|declined.
 */
async function listApplications(req, res) {
  const filter = {};
  if (['pending', 'approved', 'declined'].includes(req.query.status)) filter.status = req.query.status;

  const applications = await RestaurantApplication.find(filter)
    .sort({ vulnerabilityScore: -1, createdAt: -1 })
    .limit(500)
    .lean();

  res.json({ count: applications.length, applications });
}

/**
 * PUT /api/applications/:id/status  (founder panel; admin only)
 * Applies an approved/declined decision and returns the recomputed program metrics.
 */
async function updateStatus(req, res) {
  assertValid(req);
  const { status, decisionNote = '' } = req.body;

  const application = await RestaurantApplication.findByIdAndUpdate(
    req.params.id,
    { status, decisionNote, reviewedAt: new Date() },
    { new: true, runValidators: true }
  );
  if (!application) {
    const err = new Error('Application not found');
    err.status = 404;
    throw err;
  }

  res.json({ application, metrics: await computeMetrics() });
}

/** GET /api/metrics (admin only). */
async function metricsEndpoint(req, res) {
  res.json({ metrics: await computeMetrics() });
}

/**
 * Global program metrics, aggregated from the collection itself.
 * We compute these from the source data rather than mutating standalone counters, so the numbers
 * can never drift out of sync with the actual applications.
 */
async function computeMetrics() {
  const [row] = await RestaurantApplication.aggregate([
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        pending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
        approved: { $sum: { $cond: [{ $eq: ['$status', 'approved'] }, 1, 0] } },
        declined: { $sum: { $cond: [{ $eq: ['$status', 'declined'] }, 1, 0] } },
        totalAllocatedApproved: { $sum: { $cond: [{ $eq: ['$status', 'approved'] }, '$allocation', 0] } },
        avgVulnerability: { $avg: '$vulnerabilityScore' },
      },
    },
  ]);
  if (!row) return { total: 0, pending: 0, approved: 0, declined: 0, totalAllocatedApproved: 0, avgVulnerability: 0 };
  return {
    total: row.total,
    pending: row.pending,
    approved: row.approved,
    declined: row.declined,
    totalAllocatedApproved: row.totalAllocatedApproved,
    avgVulnerability: row.avgVulnerability ? Math.round(row.avgVulnerability) : 0,
  };
}

module.exports = { createApplication, listApplications, updateStatus, metricsEndpoint, computeMetrics };
