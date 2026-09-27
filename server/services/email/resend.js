/**
 * Resend adapter (https://resend.com/docs/api-reference/emails/send-email).
 * Uses plain fetch, so no SDK dependency. The API key is read from config (env), never hardcoded or logged.
 *
 * Provider contract (implement this shape to add another provider, e.g. Postmark or SES):
 *   { name: string, send({ to, subject, html, text, idempotencyKey? }) => Promise<{ id?: string }> }
 * Throw EmailError on failure. Messages must never contain the API key or message bodies.
 */
export class EmailError extends Error {
  constructor(message, { status } = {}) { super(message); this.name = 'EmailError'; this.status = status; }
}

const ENDPOINT = 'https://api.resend.com/emails';

export function createResendProvider({ apiKey, from, fetchImpl = fetch, timeoutMs = 8000 }) {
  if (!apiKey) throw new Error('RESEND_API_KEY is required for the Resend email provider');
  return {
    name: 'resend',
    async send({ to, subject, html, text, idempotencyKey }) {
      let res;
      try {
        res = await fetchImpl(ENDPOINT, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
          },
          body: JSON.stringify({ from, to: [to], subject, html, text }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (e) {
        throw new EmailError(e.name === 'TimeoutError' ? 'Resend request timed out' : 'Could not reach Resend');
      }
      let body = null;
      try { body = await res.json(); } catch { /* non-JSON error body */ }
      if (!res.ok) {
        // Include Resend's own explanation (e.g. "domain is not verified") to make setup problems diagnosable, with the key scrubbed.
        const detail = typeof body?.message === 'string' ? body.message.split(apiKey).join('[redacted]').slice(0, 300) : '';
        throw new EmailError(`Resend rejected the request (${res.status}${body?.name ? `: ${body.name}` : ''})${detail ? `: ${detail}` : ''}`, { status: res.status });
      }
      return { id: body?.id };
    },
  };
}
