import * as templates from './email/templates.js';

const DAY = 86400000;
/** Whole days from today (local) to a YYYY-MM-DD date. Negative when past. */
function daysUntil(iso) {
  if (!iso) return null;
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return Math.round((d - new Date(new Date().toDateString())) / DAY);
}

/**
 * Emails students a digest of upcoming deadlines for the opportunities they're tracking.
 *
 * Rules that keep it from spamming:
 *  - Only tracked items in an early stage (Interested / Preparing) on a still-live opportunity.
 *  - Only users who verified their email and left reminders on (default on; toggle on the account page).
 *  - Only deadlines from today up to `reminderDays` away.
 *  - Each (item, deadline) is reminded once: we store the deadline we reminded for, so changing a deadline
 *    re-arms it but nothing sends twice.
 *  - The whole pass runs at most once per calendar day (guarded by app_meta), so restarts don't re-send.
 */
export function createReminderService({ repo, mailer, config }) {
  const windowDays = config.reminderDays;

  async function runOnce({ force = false, today = new Date().toISOString().slice(0, 10) } = {}) {
    if (!config.remindersEnabled) return { skipped: 'disabled' };
    if (!force && repo.getMeta('reminderRunDate') === today) return { skipped: 'already-ran-today' };

    const byUser = new Map();
    for (const r of repo.reminderCandidates()) {
      const deadline = (r.own_deadline && r.own_deadline.trim()) ? r.own_deadline.slice(0, 10) : (r.deadline_date || '').slice(0, 10);
      if (!deadline) continue;
      const daysLeft = daysUntil(deadline);
      if (daysLeft == null || daysLeft < 0 || daysLeft > windowDays) continue;
      if (r.reminded_for === deadline) continue; // already reminded for this exact deadline
      if (!byUser.has(r.user_id)) byUser.set(r.user_id, { email: r.email, name: r.display_name, items: [] });
      byUser.get(r.user_id).items.push({ oppId: r.opportunity_id, title: r.title, deadline, daysLeft });
    }

    let sent = 0, failed = 0;
    for (const [userId, u] of byUser) {
      u.items.sort((a, b) => a.daysLeft - b.daysLeft);
      try {
        await mailer.send(templates.deadlineReminder({ to: u.email, name: u.name, items: u.items, appUrl: config.appUrl }));
        for (const it of u.items) repo.markReminded(userId, it.oppId, it.deadline);
        sent += 1;
      } catch (e) {
        failed += 1;
        console.error(`[reminders] failed to email ${u.email}: ${e.message}`);
      }
    }

    repo.setMeta('reminderRunDate', today);
    return { skipped: false, users: byUser.size, sent, failed };
  }

  return { runOnce };
}
