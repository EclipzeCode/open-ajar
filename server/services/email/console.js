/**
 * DEVELOPMENT ONLY email provider. Nothing is sent anywhere: messages are kept in memory (and shown at #/dev/inbox
 * while running locally) so verification and reset flows can be tried without an email account.
 * The server refuses to start in production with this provider.
 */
export function createConsoleProvider({ limit = 50, log = console.log } = {}) {
  const outbox = [];
  return {
    name: 'console',
    outbox,
    async send({ to, subject, html, text }) {
      const id = `dev-${Date.now()}-${outbox.length}`;
      outbox.unshift({ id, to, subject, text, html, at: new Date().toISOString() });
      if (outbox.length > limit) outbox.length = limit;
      log(`[email:console] not sent (development). To: ${to} · ${subject}`);
      return { id };
    },
  };
}
