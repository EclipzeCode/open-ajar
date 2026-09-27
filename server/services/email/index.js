import { createResendProvider } from './resend.js';
import { createConsoleProvider } from './console.js';

export { EmailError } from './resend.js';

/**
 * Chooses the email provider from config. Everything else in the app depends only on `mailer.send(message)`,
 * so replacing Resend means adding one file here that returns { name, send } and one line below.
 */
export function createMailer(config, overrides = {}) {
  if (config.production && config.emailProvider !== 'resend') {
    throw new Error('Production requires EMAIL_PROVIDER=resend and RESEND_API_KEY. The console provider is for development only.');
  }
  switch (config.emailProvider) {
    case 'resend': return createResendProvider({ apiKey: config.resendApiKey, from: config.emailFrom, ...overrides });
    case 'console': return createConsoleProvider(overrides);
    default: throw new Error(`Unknown EMAIL_PROVIDER "${config.emailProvider}". Use "resend" or "console".`);
  }
}
