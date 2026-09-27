export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}
export const badRequest = (m = 'Bad request', d) => new HttpError(400, m, d);
export const unauthorized = (m = 'Please sign in') => new HttpError(401, m);
export const forbidden = (m = 'You don’t have access to that') => new HttpError(403, m);
export const notFound = (m = 'Not found') => new HttpError(404, m);
export const conflict = (m = 'Conflict', d) => new HttpError(409, m, d);
export const invalid = (errors) => new HttpError(422, 'Please fix the highlighted fields', { errors });
export const tooMany = (m = 'Too many requests. Please wait a moment and try again.') => new HttpError(429, m);
