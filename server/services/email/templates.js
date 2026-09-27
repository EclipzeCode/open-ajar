/** Plain, accessible transactional emails. Table-free, inline styles only (email clients ignore stylesheets). */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function layout({ preheader, heading, paragraphs, button, link, footer, bodyHtml = '', bodyText = '' }) {
  const html = `<!doctype html><html lang="en"><body style="margin:0;background:#F3EFE6;color:#15140F;font-family:Helvetica,Arial,sans-serif;">
<span style="display:none;max-height:0;overflow:hidden;">${esc(preheader)}</span>
<div style="max-width:520px;margin:0 auto;padding:32px 24px;">
  <p style="font-family:Georgia,serif;font-size:22px;margin:0 0 24px;">Open Ajar</p>
  <h1 style="font-family:Georgia,serif;font-weight:400;font-size:28px;line-height:1.15;margin:0 0 16px;">${esc(heading)}</h1>
  ${paragraphs.map((p) => `<p style="font-size:16px;line-height:1.55;margin:0 0 16px;">${esc(p)}</p>`).join('')}
  ${bodyHtml}
  <p style="margin:24px 0;"><a href="${esc(link)}" style="background:#15140F;color:#F3EFE6;text-decoration:none;padding:14px 22px;border-radius:3px;font-weight:600;display:inline-block;">${esc(button)}</a></p>
  <p style="font-size:14px;line-height:1.5;color:#5E5B50;margin:0 0 8px;">Or paste this link into your browser:<br><span style="word-break:break-all;">${esc(link)}</span></p>
  <p style="font-size:14px;line-height:1.5;color:#5E5B50;margin:24px 0 0;">${esc(footer)}</p>
</div></body></html>`;
  const text = `${heading}\n\n${paragraphs.join('\n\n')}\n${bodyText ? `\n${bodyText}` : ''}\n${button}: ${link}\n\n${footer}\n\nOpen Ajar`;
  return { html, text };
}

const first = (name) => String(name || '').trim().split(/\s+/)[0] || 'there';

export function verifyEmail({ to, name, link }) {
  return {
    to, subject: 'Confirm your email for Open Ajar',
    ...layout({
      preheader: 'One click to confirm your email address.',
      heading: `Welcome, ${first(name)}.`,
      paragraphs: ['Confirm your email address to finish setting up your Open Ajar account. You’ll need this before you can submit an opportunity.', 'This link works once and expires in 24 hours.'],
      button: 'Confirm my email', link,
      footer: 'If you didn’t create an Open Ajar account, you can ignore this email and nothing will happen.',
    }),
  };
}

export function resetPassword({ to, name, link }) {
  return {
    to, subject: 'Reset your Open Ajar password',
    ...layout({
      preheader: 'Use this link to choose a new password.',
      heading: 'Reset your password',
      paragraphs: [`Hi ${first(name)}, we got a request to reset the password for your Open Ajar account.`, 'This link works once and expires in 1 hour. After you choose a new password, you’ll be signed out everywhere.'],
      button: 'Choose a new password', link,
      footer: 'If you didn’t ask for this, you can ignore this email. Your password won’t change.',
    }),
  };
}

export function deadlineReminder({ to, name, items, appUrl }) {
  const one = items.length === 1;
  const list = items.map((it) => {
    const when = it.daysLeft === 0 ? 'due today' : it.daysLeft === 1 ? 'due tomorrow' : `in ${it.daysLeft} days`;
    return `- ${it.title} (${when}, ${it.deadline})`;
  }).join('\n');
  const htmlList = items.map((it) => {
    const when = it.daysLeft === 0 ? 'Due today' : it.daysLeft === 1 ? 'Due tomorrow' : `In ${it.daysLeft} days`;
    const link = `${appUrl}/#/o/${it.oppId}`;
    return `<li style="margin:0 0 10px"><a href="${esc(link)}" style="color:#15140F;font-weight:600;text-decoration:none">${esc(it.title)}</a><br><span style="color:#5E5B50;font-size:14px">${esc(when)} · ${esc(it.deadline)}</span></li>`;
  }).join('');
  const heading = one ? 'A deadline is coming up' : `${items.length} deadlines are coming up`;
  return {
    to,
    subject: one ? `Reminder: ${items[0].title} is ${items[0].daysLeft === 0 ? 'due today' : items[0].daysLeft === 1 ? 'due tomorrow' : `due in ${items[0].daysLeft} days`}` : `You have ${items.length} deadlines coming up`,
    ...layout({
      preheader: one ? `${items[0].title} is coming up.` : `${items.length} of the opportunities you\u2019re tracking are closing soon.`,
      heading: `${first(name)}, ${heading.toLowerCase()}.`,
      paragraphs: [`These are opportunities you\u2019re tracking on Open Ajar. Confirm the exact deadline on the official page before you rely on it.`],
      button: 'Open your tracker', link: `${appUrl}/#/tracker`,
      footer: 'You get these because you asked to track these opportunities. Turn reminders off any time on your account page.',
      bodyHtml: `<ul style="padding-left:18px;margin:0 0 20px">${htmlList}</ul>`,
      bodyText: `${list}\n`,
    }),
  };
}
