import { h } from '../dom.js';
import { session } from '../session.js';
import { toast } from './toast.js';
import { ApiError } from '../api.js';

/** Shown to signed-in students who haven't confirmed their email. Returns null when nothing needs doing. */
export function verifyBanner({ compact = false } = {}) {
  const user = session.user;
  if (!user || user.emailVerified) return null;
  const btn = h('button', { type: 'button', class: 'btn btn--ghost btn--sm' }, 'Resend the email');
  const status = h('p', { class: 'help', role: 'status' });
  btn.addEventListener('click', async () => {
    btn.disabled = true; btn.classList.add('is-loading');
    try {
      const r = await session.resendVerification();
      if (r.alreadyVerified) { await session.refresh(); toast('Your email is already confirmed'); return; }
      status.textContent = `Sent to ${user.email}. Check your inbox and spam folder.`;
      toast('Confirmation email sent');
    } catch (e) { status.textContent = e instanceof ApiError ? e.message : 'Couldn’t send just now. Try again shortly.'; }
    finally { btn.disabled = false; btn.classList.remove('is-loading'); }
  });
  return h('section', { class: `verify-banner${compact ? ' verify-banner--compact' : ''}`, 'aria-labelledby': 'vb-h' },
    h('div', null,
      h('h2', { id: 'vb-h' }, 'Confirm your email'),
      session.devInbox
        ? h('p', null, 'Email sending isn’t set up on this copy of the site, so nothing was delivered to ', h('strong', null, user.email), '. Your confirmation email is in the ', h('a', { href: '#/dev/inbox' }, 'Dev inbox'), '.')
        : h('p', null, `We sent a link to ${user.email}. Confirming it lets you submit opportunities. Saving and tracking work without it.`),
      status),
    btn);
}
