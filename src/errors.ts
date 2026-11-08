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
  /** The API's machine-readable `error_code`, when the envelope carried one. */
  code?: string;
  /** The status the target page (or the renderer) reported, from `response.status_code`. */
  targetStatus?: number;
}

/** Base class for all errors thrown by the Site-Shot SDK. */
export class SiteShotError extends Error {
  /**
   * HTTP status of the API response itself. A capture that fails after the
   * API admitted it still answers HTTP 200 in JSON mode; see `targetStatus`.
   */
  readonly httpStatus?: number;
  readonly body?: unknown;
  /** The API's machine-readable `error_code` (e.g. `proxy_navigation_failed`). */
  readonly code?: string;
  /** The status the target page (or the renderer) reported, from `response.status_code`. */
  readonly targetStatus?: number;

  constructor(message: string, options: SiteShotErrorOptions = {}) {
    super(
      message,
      options.cause !== undefined ? { cause: options.cause } : undefined,
    );
    this.name = new.target.name;
    this.httpStatus = options.httpStatus;
    this.body = options.body;
    this.code = options.code;
    this.targetStatus = options.targetStatus;
  }
}

/** Missing or rejected API key (`userkey`). */
export class AuthError extends SiteShotError {}

/**
 * A paid plan's quota exhausted, the free plan's 100 captures for the month
 * used up (HTTP 403 until it renews), a `country` other than US on the free
 * plan (Site-Shot refuses it and returns an error instead of an image; the
 * refused request still counts toward the month's 100), payment required, or
 * the account has no active subscription. Distinct from {@link AuthError}: the
 * API key is valid, the allowance behind it is not.
 */
export class QuotaError extends SiteShotError {}

/**
 * HTTP 429: the plan's parallel-request limit was hit (the free plan allows one
 * capture at a time). The request was refused before it started, so it does
 * not count; run captures one after another, or cap your concurrency. A
 * subclass of {@link QuotaError}, so existing `instanceof QuotaError` checks
 * still match.
 */
export class ConcurrencyLimitError extends QuotaError {}

/**
 * Thrown when a capture with `strict_country` set requests a country that has
 * no available capacity right now (the API's `country_unavailable` envelope).
 * Without `strict_country` the API silently falls back to a US vantage point
 * instead of failing.
 */
export class CountryUnavailableError extends SiteShotError {}

/**
 * A request parameter was rejected: by the SDK before sending (a camelCase
 * option name, a `captureToFile` extension that contradicts `format`), or by
 * the API. Note that the API clamps out-of-range numbers (e.g. `width: 50`
 * becomes 100) instead of rejecting them.
 */
export class InvalidParamsError extends SiteShotError {}

/**
 * Client-side abort, or the API reported that the render timed out. A request
 * the client aborted had already reached the API, so it may still count
 * against your allowance.
 */
export class SiteShotTimeoutError extends SiteShotError {}

/**
 * Anything else: 5xx responses, unparseable bodies, connection failures, or
 * an unsupported `format` value (the API answers that with HTTP 404 in image
 * mode, or a 200 JSON envelope whose `error` is `422 Unprocessable Entity`).
 */
export class APIError extends SiteShotError {}

/**
 * The page itself could not be opened: its host did not resolve or did not
 * answer (`error_code` `proxy_navigation_failed` and other `proxy_*` codes).
 * Check the URL. A subclass of {@link APIError}.
 */
export class PageLoadError extends APIError {}
