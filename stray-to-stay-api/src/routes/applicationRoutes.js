'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const requireAdmin = require('./../middleware/auth');
const asyncHandler = require('./../middleware/asyncHandler');
const validators = require('./../validators/applicationValidators');
const controller = require('./../controllers/applicationController');

const router = express.Router();

// Public submission endpoint: tighter limit to deter spam/abuse from a single IP.
const submitLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });

// --- Public ---
router.post('/applications', submitLimiter, validators.createApplication, asyncHandler(controller.createApplication));

// --- Founder panel (admin bearer token required) ---
router.get('/applications', requireAdmin, asyncHandler(controller.listApplications));
router.put('/applications/:id/status', requireAdmin, validators.updateStatus, asyncHandler(controller.updateStatus));
router.get('/metrics', requireAdmin, asyncHandler(controller.metricsEndpoint));

module.exports = router;
