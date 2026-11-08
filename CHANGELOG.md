# Changelog

All notable changes to `site-shot-sdk`. Dates are npm publish dates (UTC).

## Unreleased

- Capture failures are classified by the API's `error_code` first. A page whose
  host does not resolve or does not answer (`proxy_*` codes) is now a
  `PageLoadError` (a subclass of `APIError`) instead of a `SiteShotTimeoutError`;
  "504 Gateway Timeout" on its own no longer reads as a render timeout. A target
  page's own error (e.g. "403 Forbidden") says the target page answered it.
- `SiteShotError` carries `code` (the API's `error_code`) and `targetStatus`
  (`response.status_code`) next to `httpStatus`.
- HTTP 429 (parallel-request limit) is a `ConcurrencyLimitError`, a subclass of
  `QuotaError`, that says to run captures one after another.
- Key errors link <https://www.site-shot.com/start/> instead of `/pricing/`;
  "No active subscription found" names the free-plan next step. The
  `YOUR_API_KEY` placeholder is refused before any request.
- A camelCase option name (`fullSize`) is refused with `InvalidParamsError`
  instead of being sent and silently ignored by the API.
- `captureToFile` takes `format` from the file extension when none is given,
  and refuses a `format` that contradicts it.
- Types: `CaptureResult` gains `response`, `screenshot_parameters` and
  `source_code_status`; `CaptureOptions` gains `webgl`.
- Docs: `timeout` is a per-attempt budget; out-of-range numbers are clamped by
  the API, not rejected; WebP keeps the top 16,383 px; parallel captures;
  `retries` does not re-run `country_unavailable`; the timeout-card gap.

## 0.2.1 (2026-10-31)

- The free plan's refusals ("Free plan used up", "Free API trial used up",
  "Geotargeting needs a paid plan") raise `QuotaError` on any HTTP status,
  including the HTTP 200 JSON envelope.
- README: a confirmed account's API key comes with the free plan (100 API
  captures a month).

## 0.2.0 (2026-09-24)

- `CaptureOptions.format` accepts `"webp"` (lossless).
- CI runs the type check and tests on Node 18, 20 and 22.

## 0.1.3 (2026-08-16)

- The API's `message` error key is read as well as `error`; HTTP 403 is a
  `QuotaError`, not an `AuthError`.
- An upstream "403 Forbidden" capture failure is no longer blamed on the API
  key.
- The User-Agent version is kept in sync with `package.json`.
- README: when an agent should delegate the capture to the API.

## 0.1.2 (2026-08-13)

- Documented API defaults corrected: `delay_time` 500, `max_height` 20000,
  `proxy_rotation` has no default.

## 0.1.1 (2026-08-13)

- README: the literal country count is replaced by the country list link.

## 0.1.0 (2026-08-12)

- First release: `capture`, `captureToFile`, `captureBase64`, `captureJson` and
  `buildUrl`, typed errors, ESM and CommonJS, zero runtime dependencies.
