import { Buffer } from "node:buffer";
import { writeFile } from "node:fs/promises";

import {
  APIError,
  AuthError,
  CountryUnavailableError,
  InvalidParamsError,
  QuotaError,
  SiteShotError,
  SiteShotTimeoutError,
} from "./errors";

const DEFAULT_BASE_URL = "https://api.site-shot.com/";
const SDK_VERSION = "0.1.0";
/** The API's own default server-side render deadline (`timeout` param), ms. */
const DEFAULT_SERVER_TIMEOUT_MS = 60_000;
/** Client-side headroom on top of the server deadline, so the server always answers first. */
const CLIENT_TIMEOUT_HEADROOM_MS = 30_000;

export interface SiteShotOptions {
  /** API endpoint. Default: `https://api.site-shot.com/`. */
  baseUrl?: string;
  /**
   * Client-side abort deadline in milliseconds. Default: the per-call server
   * `timeout` param (or its API default of 60000) plus 30s headroom, so the
   * server always gets to answer first.
   */
  timeoutMs?: number;
  /**
   * Retries for **connection-level failures only** (DNS, connect reset, no
   * bytes received), with jittered backoff. Default: `0` — renders cost
   * quota, so the SDK never auto-retries a completed-but-failed render.
   */
  retries?: number;
  /** fetch implementation override (test seam). Default: global `fetch`. */
  fetchImpl?: typeof fetch;
}

/**
 * Capture options. Names mirror the HTTP query parameters of
 * `GET https://api.site-shot.com/` verbatim (snake_case). Booleans are
 * accepted and coerced to `1`/`0`. Unknown options pass through verbatim, so
 * future API params work without an SDK release.
 *
 * `userkey` is owned by the {@link SiteShot} constructor and `response_type`
 * by the return-mode methods — neither can be set per call.
 */
export interface CaptureOptions {
  /** The page to capture. Bare domains like `example.com` are accepted (`https://` is assumed). */
  url: string;
  /** Viewport width in px, 100–8000. API default: 1024. */
  width?: number;
  /** Viewport height in px, 100–20000. API default: 768. */
  height?: number;
  /** Percentage zoom, 5–1000. API default: 100. */
  zoom?: number;
  /** Capture the full scrollable page (height capped by `max_height`). */
  full_size?: boolean | 0 | 1;
  /** Height cap for `full_size` captures, 100–20000. API default: 20000. */
  max_height?: number;
  /** Scale the result image to this width, 50–10000. */
  scaled_width?: number;
  /** Image format. API default: `png`. */
  format?: "png" | "jpeg";
  /** Wait this many ms before capturing, 0–60000. API default: 500. */
  delay_time?: number;
  /** Server-side render deadline in ms, 0–120000. API default: 60000. */
  timeout?: number;
  /** Custom User-Agent for the rendering browser. */
  user_agent?: string;
  /**
   * Extra request headers for the rendering browser, as an object. Emitted as
   * repeated `request_header=Name:value` query params.
   */
  request_headers?: Record<string, string>;
  /** Bring-your-own-proxy passthrough. */
  http_proxy?: string;
  proxy_username?: string;
  proxy_password?: string;
  /**
   * Route selection. There is no default, and omitting this is not the same as passing
   * either value: leave it out and Site-Shot picks the route (recommended). `1` sends every
   * attempt through a rotating proxy. `0` makes a single attempt without rotation — through
   * one proxy of `country` when a country is set, otherwise direct.
   */
  proxy_rotation?: boolean | 0 | 1;
  /** Include the rendered HTML in the JSON result (use with `captureJson`). */
  source_code?: boolean | 0 | 1;
  /** JavaScript to inject into the page before capture. */
  javascript_code?: string;
  /** Remove ads. API default: 0. */
  no_ads?: boolean | 0 | 1;
  /** Remove cookie-consent banners. API default: 0. */
  no_cookie_popup?: boolean | 0 | 1;
  /**
   * Render from this country — ISO 3166-1 alpha-2 code, e.g. `"DE"`.
   * Auto-sets language, time zone, and geolocation to match.
   */
  country?: string;
  /**
   * Fail with {@link CountryUnavailableError} when the requested country has
   * no capacity, instead of silently falling back to a US vantage point.
   */
  strict_country?: boolean | 0 | 1;
  /** GPS override as `"lat,lng"`, independent of IP. */
  geolocation?: string;
  /** Accept-Language override, e.g. `"de"`. */
  language?: string;
  /** IANA time-zone name, e.g. `"Europe/Berlin"`. */
  time_zone?: string;
  /** Unknown options pass through to the API verbatim. */
  [param: string]: unknown;
}

/** Parsed JSON result of a capture. Unknown fields are preserved. */
export interface CaptureResult {
  /** Base64-encoded image, possibly prefixed with `data:image/...;base64,`. */
  image?: string;
  /** Rendered HTML (only when `source_code` was requested). */
  source_code?: string;
  [field: string]: unknown;
}

/** Params the SDK owns; silently dropped if passed per call. */
const RESERVED_PARAMS = new Set(["url", "userkey", "response_type", "request_headers"]);

function normalizeUrl(raw: unknown): string {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) {
    throw new InvalidParamsError('Missing required "url" option.');
  }
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    // eslint-disable-next-line no-new
    new URL(candidate);
  } catch {
    throw new InvalidParamsError(
      `Invalid url: "${trimmed}". Pass a web page URL such as https://example.com ` +
        "(bare domains like example.com are also accepted).",
    );
  }
  return candidate;
}

function appendParam(params: URLSearchParams, key: string, value: unknown): void {
  if (value === undefined || value === null) return;
  if (typeof value === "boolean") {
    params.append(key, value ? "1" : "0");
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) appendParam(params, key, item);
    return;
  }
  params.append(key, String(value));
}

function stripDataUrlPrefix(image: string): string {
  if (image.startsWith("data:")) {
    const comma = image.indexOf(",");
    if (comma !== -1) return image.slice(comma + 1);
  }
  return image;
}

function asErrorText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function isAbortError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { name?: string }).name === "AbortError"
  );
}

function classifyError(status: number, errorText: string | undefined, body: unknown): SiteShotError {
  const opts = { httpStatus: status, body };
  const lower = (errorText ?? "").toLowerCase();

  if (lower === "country_unavailable") {
    return new CountryUnavailableError(
      "The requested country has no available capacity right now (country_unavailable). " +
        "Retry later, or drop strict_country to allow the default US fallback.",
      opts,
    );
  }
  // 401 is the only status that means "the key itself was rejected": it is what
  // the API returns for a missing or unknown `userkey`.
  if (/userkey|api.?key|invalid key|unauthoriz|forbidden|authenticat/.test(lower) || status === 401) {
    return new AuthError(
      `Site-Shot rejected the API key${errorText ? `: ${errorText}` : ""}. ` +
        "Check the key or get one at https://www.site-shot.com/pricing/.",
      opts,
    );
  }
  // 403 is a *billing* state, not a key problem: the API returns it when the
  // account has no active subscription, and a bad or missing key is always a
  // 401. Classifying it as AuthError would send users to check a key that is
  // perfectly valid.
  if (status === 402 || status === 403 || status === 429 || /quota|limit exceed|payment|credit|subscription/.test(lower)) {
    return new QuotaError(
      `Site-Shot quota or payment issue${errorText ? `: ${errorText}` : ` (HTTP ${status})`}.`,
      opts,
    );
  }
  if (status === 400 || /invalid|out of range|must be|unsupported/.test(lower)) {
    return new InvalidParamsError(
      `Site-Shot rejected the request parameters${errorText ? `: ${errorText}` : ` (HTTP ${status})`}.`,
      opts,
    );
  }
  if (/time.?out|timed out/.test(lower)) {
    return new SiteShotTimeoutError(`Site-Shot render timed out: ${errorText}`, opts);
  }
  return new APIError(
    `Site-Shot API error${errorText ? `: ${errorText}` : ""} (HTTP ${status}).`,
    opts,
  );
}

/**
 * Site-Shot API client.
 *
 * ```js
 * const client = new SiteShot("YOUR_API_KEY"); // or set SITESHOT_API_KEY
 * const png = await client.capture({ url: "example.com", full_size: true });
 * ```
 */
export class SiteShot {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs?: number;
  private readonly retries: number;
  private readonly fetchImpl: typeof fetch;

  constructor(apiKey?: string, options: SiteShotOptions = {}) {
    const key = apiKey ?? process.env.SITESHOT_API_KEY;
    if (!key || !String(key).trim()) {
      throw new AuthError(
        "Missing Site-Shot API key. Pass it to new SiteShot(apiKey) or set the " +
          "SITESHOT_API_KEY environment variable. Get a key at https://www.site-shot.com/pricing/.",
      );
    }
    this.apiKey = String(key).trim();
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.timeoutMs = options.timeoutMs;
    this.retries = Math.max(0, options.retries ?? 0);
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    if (typeof this.fetchImpl !== "function") {
      throw new APIError(
        "No fetch implementation available. site-shot-sdk requires Node.js >= 18 " +
          "(built-in fetch) or an explicit fetchImpl option.",
      );
    }
  }

  /**
   * Capture a screenshot and return the image bytes as a Buffer.
   */
  async capture(options: CaptureOptions): Promise<Buffer> {
    const base64 = await this.captureBase64(options);
    const buf = Buffer.from(base64, "base64");
    // Node's base64 decoder silently skips invalid characters, so a
    // malformed/truncated `image` field would otherwise come back as a
    // corrupt (or empty) Buffer posing as a successful screenshot. A valid
    // payload decodes to exactly floor(3/4) of its non-padding characters.
    const expectedLength = Math.floor((base64.replace(/[\s=]/g, "").length * 3) / 4);
    if (buf.length === 0 || buf.length < expectedLength) {
      throw new APIError(
        "Site-Shot returned a malformed base64 image payload " +
          `(decoded ${buf.length} bytes from ${base64.length} base64 characters).`,
      );
    }
    return buf;
  }

  /**
   * Capture a screenshot and write it to `filePath`.
   */
  async captureToFile(options: CaptureOptions, filePath: string): Promise<void> {
    await writeFile(filePath, await this.capture(options));
  }

  /**
   * Capture a screenshot and return it as a plain base64 string (no data-URL
   * prefix) — handy for data URLs and LLM vision payloads.
   */
  async captureBase64(options: CaptureOptions): Promise<string> {
    const result = await this.captureJson(options);
    const image = typeof result.image === "string" ? result.image : undefined;
    if (!image) {
      throw new APIError("Site-Shot response did not contain an image.", { body: result });
    }
    return stripDataUrlPrefix(image);
  }

  /**
   * Capture and return the full JSON result (image, plus `source_code` and
   * any other metadata fields the API includes).
   */
  async captureJson(options: CaptureOptions): Promise<CaptureResult> {
    const params = this.buildParams(options);
    params.set("response_type", "json");
    const endpoint = `${this.baseUrl}${this.baseUrl.includes("?") ? "&" : "?"}${params.toString()}`;

    const serverTimeout = Number(options.timeout);
    const timeoutMs =
      this.timeoutMs ??
      (Number.isFinite(serverTimeout) && serverTimeout > 0 ? serverTimeout : DEFAULT_SERVER_TIMEOUT_MS) +
        CLIENT_TIMEOUT_HEADROOM_MS;

    let attempt = 0;
    for (;;) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        let res: Response;
        try {
          res = await this.fetchImpl(endpoint, {
            signal: controller.signal,
            headers: {
              accept: "application/json",
              "user-agent": `site-shot-sdk/${SDK_VERSION} node`,
            },
          });
        } catch (err) {
          if (isAbortError(err)) {
            throw new SiteShotTimeoutError(
              `Site-Shot request timed out after ${timeoutMs} ms (client-side abort).`,
              { cause: err },
            );
          }
          if (attempt < this.retries) {
            attempt += 1;
            await backoff(attempt);
            continue;
          }
          throw new APIError(`Connection to the Site-Shot API failed: ${String(err)}`, {
            cause: err,
          });
        }

        // Read the body while the abort timer is still armed, so `timeoutMs`
        // bounds the full transfer (a screenshot body is the bulk of it), not
        // just the wait for response headers.
        let text: string;
        try {
          text = await res.text();
        } catch (err) {
          if (isAbortError(err) || controller.signal.aborted) {
            throw new SiteShotTimeoutError(
              `Site-Shot request timed out after ${timeoutMs} ms while downloading ` +
                "the response body (client-side abort).",
              { httpStatus: res.status, cause: err },
            );
          }
          throw new APIError(`Failed to read the Site-Shot API response body: ${String(err)}`, {
            httpStatus: res.status,
            cause: err,
          });
        }
        return this.parseResponse(res, text);
      } finally {
        clearTimeout(timer);
      }
    }
  }

  /**
   * Build the request URL without executing it (debugging, server-side
   * proxying). The URL is in the API's default image-response mode.
   *
   * ⚠️ The returned URL embeds your API key (`userkey`) and Site-Shot has no
   * signed-URL scheme — never expose it client-side (e.g. in an `<img src>`
   * on a public page). Server-side use only.
   */
  buildUrl(options: CaptureOptions): string {
    const params = this.buildParams(options);
    return `${this.baseUrl}${this.baseUrl.includes("?") ? "&" : "?"}${params.toString()}`;
  }

  private buildParams(options: CaptureOptions): URLSearchParams {
    const params = new URLSearchParams();
    params.set("url", normalizeUrl(options.url));
    params.set("userkey", this.apiKey);
    for (const [key, value] of Object.entries(options)) {
      if (RESERVED_PARAMS.has(key)) continue;
      appendParam(params, key, value);
    }
    const headers = options.request_headers;
    if (headers && typeof headers === "object") {
      for (const [name, value] of Object.entries(headers)) {
        params.append("request_header", `${name}:${value}`);
      }
    }
    return params;
  }

  private parseResponse(res: Response, text: string): CaptureResult {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }

    if (json && typeof json === "object") {
      const envelope = json as Record<string, unknown>;

      // The API uses two different error keys depending on how the request
      // failed, so both have to be read. The real envelopes are pinned as
      // fixtures in test/sdk.test.mjs.
      //
      // 1. A failure *during capture* comes back as HTTP *200* — the failure
      //    status does not survive onto the response — with the capture
      //    envelope carrying `error` alongside a placeholder error `image`.
      //    Checking `error` on every status, not just non-2xx, is what stops
      //    that placeholder being handed back as if it were a screenshot.
      const appError = asErrorText(envelope.error);
      if (appError) {
        throw classifyError(res.status, appError, envelope);
      }

      // 2. A request rejected *before capture starts* (bad or missing key,
      //    inactive subscription) comes back on a non-2xx status with
      //    `message`. `message` is deliberately NOT read on a 2xx: only that
      //    rejection path uses the key for failures, so treating it as an
      //    error signal on a successful capture would turn any future metadata
      //    field named `message` into a spurious throw.
      if (!res.ok) {
        throw classifyError(res.status, asErrorText(envelope.message), envelope);
      }
      return envelope as CaptureResult;
    }

    if (!res.ok) {
      throw classifyError(res.status, text ? text.slice(0, 500) : undefined, text);
    }
    throw new APIError(
      `Unexpected non-JSON response from the Site-Shot API (HTTP ${res.status}).`,
      { httpStatus: res.status, body: text.slice(0, 500) },
    );
  }
}

async function backoff(attempt: number): Promise<void> {
  const base = Math.min(250 * 2 ** (attempt - 1), 2000);
  const jittered = base * (0.5 + Math.random() * 0.5);
  await new Promise((resolve) => setTimeout(resolve, jittered));
}
