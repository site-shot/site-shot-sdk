# site-shot-sdk

Official Node.js SDK for the [Site-Shot](https://www.site-shot.com/) screenshot API.

```bash
npm install site-shot-sdk
```

Capture website screenshots in a real Chromium browser: full-page capture, country
proxies, automatic ad & cookie-banner removal. **Zero runtime dependencies**
(built-in `fetch`), Node.js >= 18, TypeScript types bundled, ESM + CommonJS.

API plans from **$5/mo** (X-Lite, 2,000 screenshots). The
[free browser tool](https://www.site-shot.com/) is no-signup, but the **API
requires a key** — get one at <https://www.site-shot.com/pricing/>.

## Quickstart

```js
import { SiteShot } from "site-shot-sdk";
import fs from "node:fs/promises";

const client = new SiteShot("YOUR_API_KEY"); // or set SITESHOT_API_KEY in the env

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

// 2. Straight to a file
await client.captureToFile({ url: "https://example.com/" }, "shot.png");

// 3. Base64 string (data URLs, LLM vision payloads)
const b64 = await client.captureBase64({ url: "https://example.com/" });

// 4. Full JSON result (image plus metadata; add source_code for rendered HTML)
const meta = await client.captureJson({ url: "https://example.com/", source_code: true });
```

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
not valid values.

By default, if the requested country has no capacity at that moment, the API
silently falls back to a US vantage point. Set `strict_country` to fail fast
instead:

```js
import { SiteShot, CountryUnavailableError } from "site-shot-sdk";

const client = new SiteShot("YOUR_API_KEY", { retries: 2 }); // recommended for geo captures

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
    // No live DE capacity right now — retry later or drop strict_country.
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
SDK update.

| Option | Type / range | API default | Notes |
|---|---|---|---|
| `url` | string, **required** | — | bare domains like `example.com` accepted (`https://` assumed) |
| `width` | int 100–8000 | 1024 | viewport width |
| `height` | int 100–20000 | 768 | viewport height |
| `zoom` | int 5–1000 | 100 | percentage zoom |
| `full_size` | boolean | false | full-page capture (height capped by `max_height`) |
| `max_height` | int 100–20000 | 20000 | only meaningful with `full_size` |
| `scaled_width` | int 50–10000 | — | scale result image to width |
| `format` | `png` \| `jpeg` | png | |
| `delay_time` | int ms 0–60000 | 500 | wait before capture (SPAs, animations) |
| `timeout` | int ms 0–120000 | 60000 | server-side render deadline |
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

`userkey` (your API key) is owned by the `SiteShot` constructor — never a
per-call option. `response_type` is owned by the return-mode methods.

The SDK sends GET requests; very long `javascript_code` or `user_agent` values
can exceed practical URL length limits (~8 KB).

## Client options

```js
const client = new SiteShot("YOUR_API_KEY", {
  baseUrl: "https://api.site-shot.com/",
  timeoutMs: 90_000, // client-side abort; default = the server `timeout` + 30s headroom
  retries: 0,        // connection-level retries only (see below)
});
```

The API key falls back to the `SITESHOT_API_KEY` environment variable — the
same variable the [Site-Shot MCP server](https://www.npmjs.com/package/site-shot-mcp)
uses.

## Errors

Every error is a subclass of `SiteShotError` and carries `httpStatus` and the
raw response `body` where available.

| Error | Thrown when |
|---|---|
| `AuthError` | missing or rejected API key (also thrown early by the constructor on an empty key) |
| `QuotaError` | plan quota exhausted / payment required |
| `CountryUnavailableError` | `strict_country` capture and the requested country has no capacity right now |
| `InvalidParamsError` | the API rejected a parameter (out-of-range width, bad format, ...) |
| `SiteShotTimeoutError` | client-side abort, or the API reported a render timeout |
| `APIError` | anything else (server errors, unparseable bodies, connection failures) |

Under the hood the SDK always asks the API for a JSON response and decodes the
image itself — so errors surface as typed exceptions instead of an error
picture pretending to be your screenshot.

## Retries

Default: `0`. Screenshots cost quota, and a timed-out render may still have
consumed one — so the SDK never auto-retries a render that completed with an
error. The `retries` option applies to **connection-level failures only**
(DNS, connection reset, no bytes received), with jittered backoff.
`retries: 2` is a sensible setting for `country=` captures.

## Requirements

- Node.js >= 18 (built-in `fetch`)
- Zero runtime dependencies

## Links

- Pricing & API keys: <https://www.site-shot.com/pricing/>
- For AI agents & assistants: <https://www.site-shot.com/ai-agents/>
- Supported countries: <https://www.site-shot.com/countries/>
- Time zones: <https://www.site-shot.com/time-zones/>
- MCP server (agent tooling sibling): `npx -y site-shot-mcp`

## License

MIT
