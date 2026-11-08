# site-shot-sdk

Official Node.js SDK for the [Site-Shot](https://www.site-shot.com/) screenshot API.

```bash
npm install site-shot-sdk
```

Capture website screenshots in a real Chromium browser: full-page capture, country
proxies, automatic ad & cookie-banner removal. **Zero runtime dependencies**
(built-in `fetch`), Node.js >= 18, TypeScript types bundled, ESM + CommonJS.

The [free browser tool](https://www.site-shot.com/) is no-signup; the **API
requires a key** — get one at <https://www.site-shot.com/start/>, which walks
through the key, the install and a first capture in three steps. A confirmed
account's API key comes with the **free plan**: 100 API captures a month, no
card needed, renewing every month. Accounts confirmed before 2026-10-30 switch
it on with one button on `/start/`; an account that has had a paid plan before
does not get the free plan. Paid plans start at **$5/mo** (X-Lite, 2,000
screenshots). Free-plan captures come from the default location or the US;
other countries need a paid plan.

## Quickstart

```js
import { SiteShot } from "site-shot-sdk";
import fs from "node:fs/promises";

const client = new SiteShot("YOUR_API_KEY"); // or new SiteShot() to read SITESHOT_API_KEY

const png = await client.capture({ url: "example.com", full_size: true });
await fs.writeFile("shot.png", png); // png is a Buffer
```

CommonJS works too:

```js
const { SiteShot } = require("site-shot-sdk");
```

Building an AI agent with an MCP-capable client instead? Use the sibling MCP
server: `npx -y site-shot-mcp`.

## Capture cleanly (ads and cookie banners removed)

```js
const png = await client.capture({
  url: "https://example.com/",
  no_ads: true,
  no_cookie_popup: true,
});
```

## Return modes

One capture concept, four return modes — pick the method, not a flag:

```js
// 1. Bytes (primary mode) — returns a Buffer
const png = await client.capture({ url: "https://example.com/" });

// 2. Straight to a file (without `format`, .jpg/.jpeg/.webp/.png picks it)
await client.captureToFile({ url: "https://example.com/" }, "shot.png");

// 3. Base64 string (data URLs, LLM vision payloads)
const b64 = await client.captureBase64({ url: "https://example.com/" });

// 4. Full JSON result (image plus metadata; add source_code for rendered HTML)
const meta = await client.captureJson({ url: "https://example.com/", source_code: true });
// meta.image, meta.source_code, meta.source_code_status, meta.response.status_code,
// meta.screenshot_parameters (the values the API actually used)
```

`source_code` can be missing even when requested (for example on a slow page);
`source_code_status` then says why.

### `buildUrl()` — build the request URL without executing it

```js
const url = client.buildUrl({ url: "https://example.com/", width: 1280 });
```

> **⚠️ Key-leak warning:** the returned URL **embeds your API key** (`userkey`),
> and Site-Shot has no signed-URL scheme. Use it for debugging or server-side
> proxying only. **Never** put it in an `<img src>` or anywhere a browser or
> third party can see it.

## Screenshots from another country

Pass `country` as an **ISO 3166-1 alpha-2 code** (e.g. `"DE"`, `"BR"`, `"JP"` —
the current list is at <https://www.site-shot.com/countries/>). It automatically
sets a matching IP, language, time zone, and geolocation. Full country names are
not valid values. Countries other than the US need a paid plan; free-plan
captures come from the default location or the US.

By default, if the requested country has no capacity at that moment, the API
silently falls back to a US vantage point. Set `strict_country` to fail fast
instead:

```js
import { SiteShot, CountryUnavailableError } from "site-shot-sdk";

const client = new SiteShot("YOUR_API_KEY");

try {
  const shot = await client.capture({
    url: "https://whatismycountry.com/",
    country: "DE",
    strict_country: true,
    no_ads: true,
    no_cookie_popup: true,
  });
} catch (e) {
  if (e instanceof CountryUnavailableError) {
    // No live DE capacity right now: retry later or drop strict_country.
    // A code that keeps failing may not be offered; see /countries/.
  }
}
```

More on geotargeted screenshots:
<https://www.site-shot.com/blog/screenshot-website-from-another-country/>

## Options

Option names mirror the HTTP query parameters **verbatim** (snake_case) — the
[API reference on the homepage](https://www.site-shot.com/#documentation) and
this SDK share one vocabulary. Booleans are accepted and coerced to `1`/`0`.
**Unknown options pass through verbatim**, so future API params work without an
SDK update. A camelCase name such as `fullSize` is refused with
`InvalidParamsError` before anything is sent (the API would silently ignore it).
Out-of-range numbers are not rejected: the API clamps them to the range (for
example `width: 50` gives a 100 px wide image); `screenshot_parameters` in the
`captureJson` result shows the values it used.

| Option | Type / range | API default | Notes |
|---|---|---|---|
| `url` | string, **required** | — | bare domains like `example.com` accepted (`https://` assumed) |
| `width` | int 100–8000 | 1024 | viewport width |
| `height` | int 100–20000 | 768 | viewport height |
| `zoom` | int 5–1000 | 100 | percentage zoom |
| `full_size` | boolean | false | full-page capture (height capped by `max_height`) |
| `max_height` | int 100–20000 | 20000 | only meaningful with `full_size` |
| `scaled_width` | int 50–10000 | — | scale result image to width |
| `format` | `png` \| `jpeg` \| `webp` | png | `png`/`webp` lossless, `jpeg` lossy; `webp` is typically about 35% smaller than `png`; WebP capped at 16,383 px/side (a taller `full_size` capture keeps only its top 16,383 px; use `png` for taller pages) |
| `delay_time` | int ms 0–60000 | 500 | wait before capture (SPAs, animations) |
| `timeout` | int ms 0–120000 | 60000 | renderer time budget per attempt; it does not cap the whole request, which can take noticeably longer |
| `user_agent` | string | — | custom UA for the rendering browser |
| `request_headers` | object | — | emitted as repeated `request_header=Name:value` params |
| `http_proxy` / `proxy_username` / `proxy_password` | string | — | bring-your-own-proxy passthrough |
| `proxy_rotation` | boolean \| 0 \| 1 | — | omit and Site-Shot picks the route; `1` rotates a proxy on every attempt; `0` makes one attempt without rotation (via `country` if set, else direct) |
| `source_code` | boolean | false | include rendered HTML (use with `captureJson`) |
| `javascript_code` | string | — | inject JS into the page before capture |
| `no_ads` | boolean | false | remove ads |
| `no_cookie_popup` | boolean | false | remove cookie-consent banners |
| `country` | ISO 3166-1 alpha-2 | — | e.g. `"DE"` — auto-sets language/time zone/geolocation |
| `strict_country` | boolean | false | fail fast instead of silent US fallback |
| `geolocation` | `"lat,lng"` | — | GPS override, independent of IP |
| `language` | string | from `country` / en | Accept-Language |
| `time_zone` | IANA name | America/New_York | see <https://www.site-shot.com/time-zones/> |
| `webgl` | boolean | false | give the page a working (software) WebGL context; detectable by bot protection, so only when the page needs it |
| `fresh_session` | boolean \| 0 \| 1 | 0 | start in a clean browser: no cookies or local storage from an earlier capture, and nothing from this one kept |

`userkey` (your API key) is owned by the `SiteShot` constructor — never a
per-call option. `response_type` is owned by the return-mode methods.

The SDK sends GET requests; very long `javascript_code` or `user_agent` values
can exceed practical URL length limits (~8 KB).

## Client options

```js
const client = new SiteShot("YOUR_API_KEY", {
  baseUrl: "https://api.site-shot.com/",
  timeoutMs: 90_000, // client-side abort; default = the server `timeout` + 30s headroom
                     // (an aborted request may still count as a capture)
  retries: 0,        // connection-level retries only (see below)
});
```

The API key falls back to the `SITESHOT_API_KEY` environment variable — the
same variable the [Site-Shot MCP server](https://www.npmjs.com/package/site-shot-mcp)
uses.

## Errors

Every error is a subclass of `SiteShotError` and carries, where available:
`httpStatus` (the API's own HTTP status; a capture that failed after the API
admitted it still answers 200), `code` (the API's `error_code`, e.g.
`proxy_navigation_failed`), `targetStatus` (the status the page or renderer
reported) and the raw response `body`.

| Error | Thrown when |
|---|---|
| `AuthError` | missing or rejected API key (also thrown early by the constructor on an empty key or the `YOUR_API_KEY` placeholder) |
| `QuotaError` | a paid plan's quota exhausted, the free plan's 100 captures for the month used up (HTTP 403 until it renews), a `country` other than US on the free plan (Site-Shot refuses it and returns an error instead of an image; the refused request still counts toward the month's 100), payment required, or no active subscription on the account (turn on the free plan or pick a plan at <https://www.site-shot.com/start/>) |
| `ConcurrencyLimitError` | HTTP 429: more parallel captures than the plan allows (the free plan: one at a time). A subclass of `QuotaError`; the refused request does not count |
| `CountryUnavailableError` | `strict_country` capture and the requested country has no capacity right now, or is not offered |
| `InvalidParamsError` | a camelCase option name, a `captureToFile` extension that contradicts `format`, or a parameter the API rejected (out-of-range numbers are clamped, not rejected) |
| `SiteShotTimeoutError` | client-side abort, or the API reported a timeout (`page_load_timeout`, `selector_timeout`, `screenshot_capture_timeout`) |
| `PageLoadError` | the page could not be opened: its host did not resolve or did not answer (`proxy_navigation_failed`, `dns_lookup_failed`, `connection_refused_by_host`). A subclass of `APIError`. A failed login to your own `http_proxy` (`proxy_auth_failed`) is a plain `APIError` |
| `APIError` | anything else (the target page answered an error such as 403 Forbidden, server errors, unparseable bodies, connection failures, an unsupported `format` value) |

Under the hood the SDK always asks the API for a JSON response and decodes the
image itself, so a failure the API reports surfaces as a typed exception
instead of an error picture saved as your screenshot. One known gap: when a
render runs out of time on the API side, the API can still return its
"timeout budget" error card as a normal image. Until that is fixed in the API,
`captureJson` lets you check `response.status_code`; a `5xx` there means the
image may be that card (or the site's own error page).

## Parallel captures

Each plan allows a fixed number of captures at once; the free plan allows one.
A request over the limit is refused with `ConcurrencyLimitError` (HTTP 429) and
does not count. So instead of `Promise.all(urls.map(...))`, capture one after
another (or cap concurrency at your plan's limit):

```js
for (const url of urls) {
  await client.captureToFile({ url }, `${new URL(url).hostname}.png`);
}
```

## Retries

Default: `0`. Screenshots cost quota, and a timed-out render may still have
consumed one — so the SDK never auto-retries a render that completed with an
error. The `retries` option applies to **connection-level failures only**
(DNS, connection reset, no bytes received) between your code and the API,
with jittered backoff. They do not re-run a `CountryUnavailableError`.

## Building an agent?

If your agent drives a browser, it can screenshot pages itself — the right tool for pages that must
be signed into or stepped through a flow. For public URLs, delegating the capture to the API is
usually better engineering: the same pipeline on every request, country-specific vantage points
(`country` + `strict_country`), every frame validated before it is returned, and a fraction of a cent
per capture instead of a browser session plus vision tokens per look. The full comparison:
[AI agent vs. screenshot API — who should capture the page](https://www.site-shot.com/blog/ai-agent-vs-screenshot-api/).

## Requirements

- Node.js >= 18 (built-in `fetch`)
- Zero runtime dependencies

## Links

- Quickstart & API keys: <https://www.site-shot.com/start/>
- Pricing: <https://www.site-shot.com/pricing/>
- For AI agents & assistants: <https://www.site-shot.com/ai-agents/>
- Supported countries: <https://www.site-shot.com/countries/>
- Time zones: <https://www.site-shot.com/time-zones/>
- MCP server (agent tooling sibling): `npx -y site-shot-mcp`
- When an agent should delegate the capture: <https://www.site-shot.com/blog/ai-agent-vs-screenshot-api/>

## License

MIT
