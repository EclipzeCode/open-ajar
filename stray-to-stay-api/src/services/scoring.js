'use strict';

/**
 * Vulnerability scoring for Stray-to-Stay grant triage.
 *
 * IMPORTANT (read before relying on this): the WEIGHTS below encode a POLICY decision about how you
 * prioritize struggling restaurants. They are a transparent, reasonable default — NOT a validated or
 * official distress metric. Review them with your team and tune them to match your real criteria.
 *
 * A meaningful 1–100 score cannot come from name/email/address alone, so the score is computed from the
 * distress indicators in `metrics` (see the schema). Wire your application form's distress questions to
 * those fields. The function is pure and deterministic: the same inputs always yield the same score.
 */

const WEIGHTS = {
  revenueDeclinePercent: 0.35, // how far revenue has fallen
  monthsBehindOnRent: 0.25, // rent arrears
  closureUrgency: 0.25, // derived from monthsUntilClosure (sooner = higher)
  employeesAtRisk: 0.10, // jobs on the line (ties to the teen-jobs mission)
  priorAidReceived: 0.05, // applied as a reduction, to spread help
};

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const normalize = (value, max) => clamp(Number(value) || 0, 0, max) / max;

/**
 * @param {object} metrics distress indicators (see RestaurantApplication schema)
 * @returns {number} integer 1..100
 */
function computeVulnerabilityScore(metrics = {}) {
  const revenue = normalize(metrics.revenueDeclinePercent, 100); // 0..1
  const rent = normalize(metrics.monthsBehindOnRent, 6); // capped at 6 months
  const monthsLeft = metrics.monthsUntilClosure == null ? 12 : metrics.monthsUntilClosure;
  const closureUrgency = 1 - normalize(monthsLeft, 12); // 0 months left => 1.0
  const employees = normalize(metrics.employeesAtRisk, 25); // capped at 25
  const priorAidPenalty = metrics.priorAidReceived ? 1 : 0;

  let raw =
    WEIGHTS.revenueDeclinePercent * revenue +
    WEIGHTS.monthsBehindOnRent * rent +
    WEIGHTS.closureUrgency * closureUrgency +
    WEIGHTS.employeesAtRisk * employees -
    WEIGHTS.priorAidReceived * priorAidPenalty;

  raw = clamp(raw, 0, 1);
  return clamp(Math.round(raw * 100), 1, 100);
}

/** Human-readable distress indicators, for the alert email and the dashboard. */
function distressIndicators(metrics = {}) {
  const out = [];
  if (metrics.revenueDeclinePercent) out.push(`Revenue down ${metrics.revenueDeclinePercent}%`);
  if (metrics.monthsBehindOnRent) out.push(`${metrics.monthsBehindOnRent} month(s) behind on rent`);
  if (metrics.monthsUntilClosure != null) out.push(`~${metrics.monthsUntilClosure} month(s) from estimated closure`);
  if (metrics.employeesAtRisk) out.push(`${metrics.employeesAtRisk} job(s) at risk`);
  if (metrics.yearsInOperation) out.push(`${metrics.yearsInOperation} year(s) in operation`);
  if (metrics.priorAidReceived) out.push('Has received prior aid');
  return out;
}

module.exports = { computeVulnerabilityScore, distressIndicators, WEIGHTS };
