import { h } from '../dom.js';
import { icon } from '../components/icons.js';
import { input, select, textarea, checkGroup, formState, submitButton } from '../components/form.js';
import { ApiError as _ApiError } from '../api.js';
import { statusBadge } from '../components/opportunity-row.js';
import { emptyState, skeletonRows } from '../components/states.js';
import { toast } from '../components/toast.js';
import { api, ApiError } from '../api.js';
import { META, fmtDate } from '../meta.js';
import { session } from '../session.js';
import { verifyBanner } from '../components/verify-banner.js';

const ROLE_LABEL = { student: 'Student', organization: 'Organization', counselor: 'Counselor', admin: 'Admin' };

export default function account(ctx) {
  ctx.setTitle('Account');
  if (!session.user) { location.replace('#/login?next=%2Faccount'); return h('div'); }
  const user = session.user;

  // ---- Profile ----
  const pf = [
    input({ name: 'displayName', label: 'Name', value: user.displayName, required: true, autocomplete: 'name', maxlength: 80 }),
    select({ name: 'grade', label: 'Grade', options: META.grades.map((g) => ({ value: g, label: `Grade ${g}` })), value: user.profile.grade ?? '', placeholder: 'Prefer not to say' }),
    input({ name: 'location', label: 'Where you are', value: user.profile.location, maxlength: 120, help: 'City or region. Used only to help you filter.' }),
    checkGroup({ name: 'interests', label: 'Interests', options: META.interests, values: user.profile.interests, help: 'We’ll use these for the “Match my profile” shortcut in Discover.' }),
  ];
  const ps = formState(pf);
  const pBtn = submitButton('Save profile');
  const profileForm = h('form', { class: 'account__form', novalidate: true, onsubmit: async (e) => {
    e.preventDefault(); ps.clearErrors(); pBtn.setBusy(true, 'Saving…');
    try { await session.updateProfile(ps.values()); toast('Profile saved'); }
    catch (err) { ps.showErrors(err.errors, err instanceof ApiError && !Object.keys(err.errors || {}).length ? err.message : null); }
    finally { pBtn.setBusy(false); }
  } }, ps.summary, ...pf.map((f) => f.el), h('div', { class: 'form-actions' }, pBtn));

  // ---- Password ----
  const wf = [
    input({ name: 'currentPassword', label: 'Current password', type: 'password', autocomplete: 'current-password', required: true }),
    input({ name: 'newPassword', label: 'New password', type: 'password', autocomplete: 'new-password', required: true, help: 'At least 10 characters. Changing it signs out your other devices.' }),
  ];
  const ws = formState(wf);
  const wBtn = submitButton('Change password');
  const pwForm = h('form', { class: 'account__form', novalidate: true, onsubmit: async (e) => {
    e.preventDefault(); ws.clearErrors(); wBtn.setBusy(true, 'Updating…');
    try { await api.post('/api/auth/password', ws.values()); wf.forEach((f) => f.set('')); toast('Password changed'); }
    catch (err) { ws.showErrors(err.errors, err instanceof ApiError && !Object.keys(err.errors || {}).length ? err.message : null); }
    finally { wBtn.setBusy(false); }
  } }, ws.summary, ...wf.map((f) => f.el), h('div', { class: 'form-actions' }, wBtn));

  // ---- Submissions ----
  const subs = h('div', null, skeletonRows(2));
  api.get('/api/me/submissions').then(({ items }) => {
    if (!items.length) {
      subs.replaceChildren(emptyState({ title: 'You haven’t submitted anything', body: 'Know an opportunity students should hear about? Submit it and a reviewer will check it before it’s listed.', actions: [h('a', { class: 'btn', href: '#/submit' }, 'Submit an opportunity')] }));
      return;
    }
    subs.replaceChildren(h('ul', { class: 'subs' }, items.map((o) => h('li', { class: 'sub' },
      h('div', { class: 'sub__top' }, h('h3', null, o.status === 'approved' ? h('a', { href: `#/o/${o.id}` }, o.title) : o.title), statusBadge(o.status)),
      h('p', { class: 'sub__meta' }, `${o.org} · ${o.type} · Submitted ${fmtDate(o.createdAt)}`),
      o.reviewerMessage && ['changes_requested', 'rejected'].includes(o.status) ? h('div', { class: 'sub__msg' }, h('strong', null, o.status === 'rejected' ? 'Reviewer note' : 'What to change'), h('p', null, o.reviewerMessage)) : null,
      o.status === 'pending_review' ? h('p', { class: 'help' }, 'A reviewer will look at this soon. You’ll see the outcome here.') : null,
      o.status === 'changes_requested' ? h('a', { class: 'btn btn--sm', href: `#/submit/${o.id}` }, 'Edit and resubmit') : null))));
  }).catch((e) => subs.replaceChildren(h('p', { class: 'field-error' }, e.message)));

  // ---- Community Voices (your quote) ----
  const VOICE_STATUS = {
    pending: 'Your quote is in review. It will appear once a reviewer approves it.',
    approved: 'Your quote is live on the site. Thanks for sharing it.',
    declined: 'This quote wasn’t approved. You can edit it and submit again.',
  };
  const voiceStatusLine = h('p', { class: 'help' });
  const vf = [
    input({ name: 'role', label: 'How to show you', value: '', maxlength: 80, placeholder: 'e.g. High School Student, or Junior @ Cornell', help: 'Shown under your name. Optional.' }),
    textarea({ name: 'quote', label: 'Your quote', rows: 4, required: true, maxlength: 400, help: 'A sentence or two about your experience with Open Ajar. Shown with your name, ' + user.displayName + '.' }),
  ];
  const vs = formState(vf);
  const vBtn = submitButton('Share my quote');
  const setVoiceStatus = (status) => { voiceStatusLine.textContent = VOICE_STATUS[status] || ''; voiceStatusLine.hidden = !status; };
  const voiceForm = h('form', { class: 'account__form', novalidate: true, onsubmit: async (e) => {
    e.preventDefault(); vs.clearErrors(); vBtn.setBusy(true, 'Sending…');
    try {
      const { testimonial } = await api.post('/api/testimonials', vs.values());
      setVoiceStatus(testimonial.status); toast('Thanks! Your quote was sent for review.');
    } catch (err) { vs.showErrors(err.errors, err instanceof ApiError && !Object.keys(err.errors || {}).length ? err.message : null); }
    finally { vBtn.setBusy(false); }
  } }, vs.summary, voiceStatusLine, ...vf.map((f) => f.el), h('div', { class: 'form-actions' }, vBtn));
  setVoiceStatus(null);
  api.get('/api/me/testimonial').then(({ testimonial }) => {
    if (!testimonial) return;
    vf[0].set(testimonial.role || ''); vf[1].set(testimonial.quote || '');
    setVoiceStatus(testimonial.status);
  }).catch(() => {});

  // ---- Notifications ----
  const remindToggle = h('input', { type: 'checkbox', id: 'email-reminders' });
  remindToggle.checked = user.emailReminders !== false;
  remindToggle.addEventListener('change', async () => {
    remindToggle.disabled = true;
    try { await session.updateProfile({ emailReminders: remindToggle.checked }); toast(remindToggle.checked ? 'Deadline reminders on' : 'Deadline reminders off'); }
    catch (e) { remindToggle.checked = !remindToggle.checked; toast(e.message || 'Couldn’t save that'); }
    finally { remindToggle.disabled = false; }
  });
  const notifications = h('div', { class: 'account__form' },
    h('label', { class: 'check', for: 'email-reminders' }, remindToggle, h('span', null, 'Email me when a tracked opportunity’s deadline is coming up')),
    h('p', { class: 'help' }, 'A short digest, at most once a day, only when something you’re tracking is closing soon.'));

  const out = h('button', { type: 'button', class: 'btn btn--ghost', onclick: async () => { await session.logout(); location.hash = '#/'; toast('Signed out'); } }, 'Sign out');

  // ---- Delete account (irreversible; requires the current password) ----
  const del = h('div', { class: 'danger-zone' });
  function collapsed() {
    del.replaceChildren(
      h('p', null, 'Deleting your account removes your profile, saved opportunities, and tracked applications for good. This cannot be undone.'),
      h('button', { type: 'button', class: 'btn btn--danger btn--ghost', onclick: expanded }, 'Delete my account'));
  }
  function expanded() {
    const pw = input({ name: 'confirmPassword', label: 'Enter your password to confirm', type: 'password', autocomplete: 'current-password', required: true });
    const st = formState([pw]);
    const confirm = h('button', { type: 'button', class: 'btn btn--danger' }, 'Permanently delete');
    confirm.addEventListener('click', async () => {
      st.clearErrors(); confirm.disabled = true; confirm.classList.add('is-loading'); confirm.textContent = 'Deleting...';
      try {
        await session.deleteAccount(pw.get());
        location.hash = '#/'; toast('Your account has been deleted.');
      } catch (err) {
        confirm.disabled = false; confirm.classList.remove('is-loading'); confirm.textContent = 'Permanently delete';
        st.showErrors(err.errors, err instanceof _ApiError && !Object.keys(err.errors || {}).length ? err.message : null);
      }
    });
    del.replaceChildren(
      h('p', null, h('strong', null, 'This is permanent.'), ' Your account, saved opportunities, and tracker will be deleted and cannot be recovered.'),
      st.summary, h('form', { class: 'account__form', novalidate: true, onsubmit: (e) => e.preventDefault() }, pw.el,
        h('div', { class: 'form-actions' }, confirm, h('button', { type: 'button', class: 'btn btn--ghost', onclick: collapsed }, 'Cancel'))));
    pw.focus();
  }
  collapsed();

  return h('div', { class: 'container' },
    h('div', { class: 'page-head' },
      h('p', { class: 'eyebrow' }, `${ROLE_LABEL[user.role] || user.role} account`),
      h('h1', null, user.displayName),
      h('p', null, [user.email, user.emailVerified ? ' · confirmed' : ' · not confirmed yet'])),
    verifyBanner(),
    h('div', { class: 'account' },
      h('section', { class: 'account__block', 'aria-labelledby': 'acc-profile' }, h('h2', { id: 'acc-profile' }, 'Profile'), profileForm),
      h('section', { class: 'account__block', 'aria-labelledby': 'acc-subs' }, h('h2', { id: 'acc-subs' }, 'Your submissions'), subs),
      h('section', { class: 'account__block', 'aria-labelledby': 'acc-voice' }, h('h2', { id: 'acc-voice' }, 'Share your experience'), h('p', { class: 'help' }, 'Add a short quote about Open Ajar. A reviewer checks it, then it appears in Community Voices on the home page.'), voiceForm),
      h('section', { class: 'account__block', 'aria-labelledby': 'acc-notif' }, h('h2', { id: 'acc-notif' }, 'Notifications'), notifications),
      h('section', { class: 'account__block', 'aria-labelledby': 'acc-sec' }, h('h2', { id: 'acc-sec' }, 'Security'), pwForm),
      h('section', { class: 'account__block', 'aria-labelledby': 'acc-out' }, h('h2', { id: 'acc-out' }, 'Session'), h('div', null, out)),
      h('section', { class: 'account__block', 'aria-labelledby': 'acc-del' }, h('h2', { id: 'acc-del' }, 'Delete account'), del)));
}
