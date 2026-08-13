/**
 * Typed error taxonomy for the Site-Shot SDK.
 *
 * Every error thrown by the SDK is a subclass of {@link SiteShotError} and
 * carries the HTTP status (when one was received) plus the raw response body
 * or JSON envelope for debugging.
 */

export interface SiteShotErrorOptions {
  /** HTTP status code of the API response, when one was received. */
  httpStatus?: number;
  /** Raw response body or parsed JSON envelope, when available. */
  body?: unknown;
  /** Underlying cause (e.g. a network error). */
  cause?: unknown;
}

/** Base class for all errors thrown by the Site-Shot SDK. */
export class SiteShotError extends Error {
  readonly httpStatus?: number;
  readonly body?: unknown;

  constructor(message: string, options: SiteShotErrorOptions = {}) {
    super(
      message,
      options.cause !== undefined ? { cause: options.cause } : undefined,
    );
    this.name = new.target.name;
    this.httpStatus = options.httpStatus;
    this.body = options.body;
  }
}

/** Missing or rejected API key (`userkey`). */
export class AuthError extends SiteShotError {}

/**
 * Plan quota exhausted, payment required, or the account has no active
 * subscription. Distinct from {@link AuthError}: the API key is valid, the
 * plan behind it is not.
 */
export class QuotaError extends SiteShotError {}

/**
 * Thrown when a capture with `strict_country` set requests a country that has
 * no available capacity right now (the API's `country_unavailable` envelope).
 * Without `strict_country` the API silently falls back to a US vantage point
 * instead of failing.
 */
export class CountryUnavailableError extends SiteShotError {}

/** The API rejected one of the request parameters (out of range, bad format, ...). */
export class InvalidParamsError extends SiteShotError {}

/** Client-side abort, or the API reported that the render timed out. */
export class SiteShotTimeoutError extends SiteShotError {}

/** Anything else: 5xx responses, unparseable bodies, connection failures. */
export class APIError extends SiteShotError {}
