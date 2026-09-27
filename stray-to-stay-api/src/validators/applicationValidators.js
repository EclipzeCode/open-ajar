'use strict';
const { body, param, validationResult } = require('express-validator');

/** Turns express-validator results into a 422 with per-field messages. */
function assertValid(req) {
  const result = validationResult(req);
  if (result.isEmpty()) return;
  const details = {};
  for (const e of result.array()) if (!details[e.path]) details[e.path] = e.msg;
  const err = new Error('Validation failed');
  err.status = 422;
  err.details = details;
  throw err;
}

// POST /api/applications — note: vulnerabilityScore and status are NOT accepted from the client.
const createApplication = [
  body('name').isString().withMessage('Required').bail().trim().isLength({ min: 2, max: 200 }),
  body('owner').isString().withMessage('Required').bail().trim().isLength({ min: 2, max: 200 }),
  body('email').isEmail().withMessage('A valid email is required').bail().isLength({ max: 320 }).normalizeEmail(),
  body('address').isString().withMessage('Required').bail().trim().isLength({ min: 4, max: 400 }),
  body('statement').optional({ nullable: true }).isString().isLength({ max: 5000 }),
  body('allocation').optional({ nullable: true }).isFloat({ min: 0, max: 1000000 }).toFloat(),
  body('metrics').optional({ nullable: true }).isObject().withMessage('metrics must be an object'),
  body('metrics.revenueDeclinePercent').optional({ nullable: true }).isFloat({ min: 0, max: 100 }).toFloat(),
  body('metrics.monthsBehindOnRent').optional({ nullable: true }).isFloat({ min: 0, max: 60 }).toFloat(),
  body('metrics.monthsUntilClosure').optional({ nullable: true }).isFloat({ min: 0, max: 60 }).toFloat(),
  body('metrics.employeesAtRisk').optional({ nullable: true }).isInt({ min: 0, max: 1000 }).toInt(),
  body('metrics.yearsInOperation').optional({ nullable: true }).isFloat({ min: 0, max: 200 }).toFloat(),
  body('metrics.priorAidReceived').optional({ nullable: true }).isBoolean().toBoolean(),
];

// PUT /api/applications/:id/status
const updateStatus = [
  param('id').isMongoId().withMessage('Invalid application id'),
  body('status').isIn(['approved', 'declined']).withMessage("status must be 'approved' or 'declined'"),
  body('decisionNote').optional({ nullable: true }).isString().isLength({ max: 2000 }),
];

module.exports = { createApplication, updateStatus, assertValid };
