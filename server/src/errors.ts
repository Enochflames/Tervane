// Typed HTTP errors with stable codes (SERVER.md §6).
export class HttpError extends Error {
  constructor(readonly status: 400 | 401 | 404 | 409 | 413 | 422 | 500 | 503, readonly code: string, message = code, readonly extra: Record<string, unknown> = {}) {
    super(message)
  }
}
