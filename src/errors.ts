/**
 * Error returned by the Lucrios APIs.
 *
 * `code` is stable and meant to be branched on; `message` is for humans.
 * `retryable` tells an automated caller whether sending the same request
 * again can succeed without changing anything.
 */
export class ApiError extends Error {
  override readonly name = "ApiError";

  constructor(
    /** HTTP status of the response. */
    readonly status: number,
    /** Stable machine-readable code, e.g. `UNAUTHORIZED`, `CONFLICT`, `INVALID`. */
    readonly code: string,
    message: string,
    /** True for rate limits and server-side failures. */
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

/** The request never produced an HTTP response (DNS, connection, timeout). */
export class NetworkError extends Error {
  override readonly name = "NetworkError";
  readonly retryable = true;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}
