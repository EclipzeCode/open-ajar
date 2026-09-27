/**
 * Sends one real test email through the configured provider and explains what happened.
 *   npm run email:test -- you@example.com
 */
import { config } from '../config.js';
import { createMailer } from '../services/email/index.js';
import { isEmail } from '../validation/validate.js';

const to = process.argv[2];
if (!isEmail(to)) { console.error('Usage: npm run email:test -- you@example.com'); process.exit(1); }

if (config.emailProvider !== 'resend') {
  console.error([
    'Email is NOT configured for real sending, so nothing would be delivered.',
    '',
    'To turn it on:',
    '  1. Create a Resend account and an API key at https://resend.com/api-keys',
    '  2. In the Open Ajar folder, create a file named .env containing:',
    '       RESEND_API_KEY=your_key_here',
    '  3. Run this command again.',
  ].join('\n'));
  process.exit(1);
}

console.log(`Sending a test email to ${to} from ${config.emailFrom} …`);
try {
  const mailer = createMailer(config);
  const r = await mailer.send({ to, subject: 'Open Ajar test email', text: 'If you can read this, Open Ajar can send email through Resend.', html: '<p>If you can read this, Open Ajar can send email through Resend.</p>' });
  console.log(`Sent (Resend id ${r.id}). Check the inbox for ${to}, and the spam folder.`);
} catch (e) {
  console.error(`FAILED: ${e.message}`);
  if (/domain|verify|testing|own email|only send/i.test(e.message) || e.status === 403 || e.status === 422) {
    console.error([
      '',
      'Most common cause: the sender address. Resend\'s default test sender (onboarding@resend.dev) can only deliver to the',
      'email address you signed up to Resend with. To email anyone else, verify your own domain in Resend, then add to .env:',
      '       EMAIL_FROM=Open Ajar <hello@your-domain.example>',
    ].join('\n'));
  } else if (e.status === 401) console.error('\nResend says the API key is invalid. Re-copy it from https://resend.com/api-keys into .env.');
  process.exit(1);
}
