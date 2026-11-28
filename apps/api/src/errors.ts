import type { ContentfulStatusCode } from 'hono/utils/http-status';

export class ApiError extends Error {
  constructor(public readonly status: ContentfulStatusCode, public readonly code: string, message: string, public readonly details?: unknown, options?: ErrorOptions) {
    super(message, options);
  }
}
