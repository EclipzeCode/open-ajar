import { h } from '../dom.js';
import { icon } from '../components/icons.js';
import { oppForm } from '../components/opp-form.js';
import { emptyState, skeletonRows, errorState } from '../components/states.js';
import { toast } from '../components/toast.js';
import { api, ApiError } from '../api.js';
import { session } from '../session.js';
import { verifyBanner } from '../components/verify-banner.js';

export default function submit(ctx) {
  const editId = ctx.match?.[1] || null;
  ctx.setTitle(editId ? 'Revise your submission' : 'Submit an opportunity');
  const root = h('div', { class: 'container' });

  if (!session.user) {
    root.append(h('div', { class: 'page-head' }, h('p', { class: 'eyebrow' }, 'Submit'), h('h1', null, 'Know an opportunity?')),
      emptyState({
        title: 'Sign in to submit',
        body: 'We ask for an account so reviewers can follow up and you can see what happens to your submission.',
        actions: [h('a', { class: 'btn', href: `#/login?next=${encodeURIComponent(editId ? `/submit/${editId}` : '/submit')}` }, 'Sign in'), h('a', { class: 'btn btn--ghost', href: '#/register?next=%2Fsubmit' }, 'Create an account')],
      }));
    return root;
  }

  if (!session.user.emailVerified) {
    root.append(h('div', { class: 'page-head' }, h('p', { class: 'eyebrow' }, 'Submit'), h('h1', null, 'One quick step first.'), h('p', null, 'We ask submitters to confirm their email so reviewers can reach a real person.')),
      verifyBanner(), h('div', { class: 'state__actions' }, h('a', { class: 'btn btn--ghost', href: '#/', onclick: (e) => { e.preventDefault(); session.refresh().then(() => location.reload()); } }, 'I’ve confirmed it')));
    return root;
  }

  const head = (eyebrow, title, lead) => h('div', { class: 'page-head' }, h('p', { class: 'eyebrow' }, eyebrow), h('h1', null, title), h('p', null, lead));

  const done = (submission, edited) => {
    root.replaceChildren(head(edited ? 'Resubmitted' : 'Submitted', 'Thank you.', 'Your opportunity is now pending review.'),
      h('div', { class: 'success' },
        h('p', null, h('strong', null, submission.title), ' is in the review queue. A reviewer will check it against the official source before it appears to students. Nothing is public until it’s approved.'),
        h('p', null, 'You’ll see the outcome, and any requested changes, on your account page.'),
        h('div', { class: 'state__actions' }, h('a', { class: 'btn', href: '#/account' }, 'See my submissions'), h('a', { class: 'btn btn--ghost', href: '#/submit', onclick: () => setTimeout(() => location.reload(), 0) }, 'Submit another'))));
    window.scrollTo({ top: 0 });
    root.querySelector('h1').setAttribute('tabindex', '-1'); root.querySelector('h1').focus();
  };

  if (!editId) {
    const form = oppForm({ mode: 'submit', onSubmit: async (values) => { const { submission } = await api.post('/api/submissions', values); done(submission, false); toast('Sent for review'); } });
    root.append(
      head('Submit', 'Know an opportunity?', 'Tell us about an internship, program, scholarship or anything else students should find. A reviewer checks every submission before it’s listed.'),
      h('div', { class: 'submit' },
        h('aside', { class: 'submit__aside' },
          h('h2', null, 'How review works'),
          h('ol', null, h('li', null, 'You submit. It goes to Pending review, private.'), h('li', null, 'A reviewer checks it against the official source.'), h('li', null, 'They approve it, ask you for changes, or decline with a reason.'), h('li', null, 'Approved listings appear in Discover.')),
          h('p', { class: 'help' }, 'Only submit real opportunities from real organizations. Include the official link so students apply at the source.')),
        h('div', { class: 'submit__form' }, form.el)));
    return root;
  }

  // Edit + resubmit flow
  root.append(head('Revise', 'Update your submission', 'A reviewer asked for changes. Fix what they noted and send it back.'), h('div', null, skeletonRows(2)));
  const load = () => api.get(`/api/submissions/${encodeURIComponent(editId)}`).then(({ submission, events }) => {
    const last = [...events].reverse().find((e) => e.toStatus === 'changes_requested');
    if (submission.status !== 'changes_requested') {
      root.replaceChildren(head('Submission', submission.title, ''), emptyState({ title: 'This can’t be edited right now', body: 'Submissions can only be revised after a reviewer requests changes.', actions: [h('a', { class: 'btn', href: '#/account' }, 'Back to my account')] }));
      return;
    }
    const form = oppForm({ mode: 'edit', initial: submission, submitLabel: 'Resubmit for review', onSubmit: async (values) => { const r = await api.put(`/api/submissions/${encodeURIComponent(editId)}`, values); done(r.submission, true); toast('Resubmitted'); } });
    root.replaceChildren(head('Revise', 'Update your submission', 'A reviewer asked for changes. Fix what they noted and send it back.'),
      last ? h('div', { class: 'sub__msg sub__msg--lead', role: 'note' }, h('strong', null, 'What the reviewer asked for'), h('p', null, last.message)) : null,
      h('div', { class: 'submit__form submit__form--solo' }, form.el));
  }).catch((e) => root.replaceChildren(head('Revise', 'Update your submission', ''), e instanceof ApiError && e.status === 404
    ? emptyState({ title: 'We couldn’t find that submission', body: 'It may belong to another account.', actions: [h('a', { class: 'btn', href: '#/account' }, 'Back to my account')] })
    : errorState({ title: 'We couldn’t load your submission', body: e.message, onRetry: load })));
  load();
  return root;
}
