import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  SiteShot,
  SiteShotError,
  AuthError,
  QuotaError,
  CountryUnavailableError,
  InvalidParamsError,
  SiteShotTimeoutError,
  APIError,
} from "../dist/index.js";

const PIXELS = Buffer.from("not-really-a-png-but-bytes-are-bytes");
const PIXELS_B64 = PIXELS.toString("base64");

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Fetch stub that records calls and replies from a queue (last reply repeats). */
function makeFetch(...replies) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    const reply = replies.length > 1 ? replies.shift() : replies[0];
    if (typeof reply === "function") return reply(url, init);
    if (reply instanceof Error) throw reply;
    return reply;
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

function paramsOf(call) {
  return new URL(call.url).searchParams;
}

// ---------------------------------------------------------------------------
// Constructor / auth
// ---------------------------------------------------------------------------

test("constructor throws AuthError when no key is given and env is empty", (t) => {
  const saved = process.env.SITESHOT_API_KEY;
  delete process.env.SITESHOT_API_KEY;
  t.after(() => {
    if (saved !== undefined) process.env.SITESHOT_API_KEY = saved;
  });
  assert.throws(() => new SiteShot(), AuthError);
  assert.throws(() => new SiteShot("   "), AuthError);
});

test("constructor falls back to SITESHOT_API_KEY env var", async (t) => {
  const saved = process.env.SITESHOT_API_KEY;
  process.env.SITESHOT_API_KEY = "env-key";
  t.after(() => {
    if (saved !== undefined) process.env.SITESHOT_API_KEY = saved;
    else delete process.env.SITESHOT_API_KEY;
  });
  const fetchImpl = makeFetch(jsonResponse({ image: PIXELS_B64 }));
  const client = new SiteShot(undefined, { fetchImpl });
  await client.capture({ url: "https://example.com/" });
  assert.equal(paramsOf(fetchImpl.calls[0]).get("userkey"), "env-key");
});

test("auth goes in the userkey query param, never in a header", async () => {
  const fetchImpl = makeFetch(jsonResponse({ image: PIXELS_B64 }));
  const client = new SiteShot("test-key", { fetchImpl });
  await client.capture({ url: "https://example.com/" });
  const call = fetchImpl.calls[0];
  assert.equal(paramsOf(call).get("userkey"), "test-key");
  const headers = call.init?.headers ?? {};
  const headerNames = Object.keys(headers).map((h) => h.toLowerCase());
  assert.ok(!headerNames.includes("authorization"));
  assert.ok(!JSON.stringify(headers).includes("test-key"));
});

test("per-call userkey cannot override the constructor key", async () => {
  const fetchImpl = makeFetch(jsonResponse({ image: PIXELS_B64 }));
  const client = new SiteShot("test-key", { fetchImpl });
  await client.capture({ url: "https://example.com/", userkey: "other-key" });
  const params = paramsOf(fetchImpl.calls[0]);
  assert.deepEqual(params.getAll("userkey"), ["test-key"]);
});

// ---------------------------------------------------------------------------
// Param serialization
// ---------------------------------------------------------------------------

test("serializes params verbatim, coerces booleans, keeps unknown passthrough", async () => {
  const fetchImpl = makeFetch(jsonResponse({ image: PIXELS_B64 }));
  const client = new SiteShot("test-key", { fetchImpl });
  await client.capture({
    url: "https://example.com/page",
    width: 1280,
    full_size: true,
    proxy_rotation: false,
    no_ads: 1,
    country: "DE",
    strict_country: true,
    delay_time: 0,
    language: undefined,
    time_zone: null,
    some_future_param: "value-42",
  });
  const params = paramsOf(fetchImpl.calls[0]);
  assert.equal(params.get("url"), "https://example.com/page");
  assert.equal(params.get("width"), "1280");
  assert.equal(params.get("full_size"), "1");
  assert.equal(params.get("proxy_rotation"), "0");
  assert.equal(params.get("no_ads"), "1");
  assert.equal(params.get("country"), "DE");
  assert.equal(params.get("strict_country"), "1");
  assert.equal(params.get("delay_time"), "0");
  assert.equal(params.get("some_future_param"), "value-42");
  assert.ok(!params.has("language"));
  assert.ok(!params.has("time_zone"));
});

test("capture methods always request response_type=json (and callers cannot override it)", async () => {
  const fetchImpl = makeFetch(jsonResponse({ image: PIXELS_B64 }));
  const client = new SiteShot("test-key", { fetchImpl });
  await client.capture({ url: "https://example.com/", response_type: "image" });
  assert.deepEqual(paramsOf(fetchImpl.calls[0]).getAll("response_type"), ["json"]);
});

test("bare domains get https:// prepended", async () => {
  const fetchImpl = makeFetch(jsonResponse({ image: PIXELS_B64 }));
  const client = new SiteShot("test-key", { fetchImpl });
  await client.capture({ url: "example.com" });
  assert.equal(paramsOf(fetchImpl.calls[0]).get("url"), "https://example.com");
});

test("empty url throws InvalidParamsError without calling fetch", async () => {
  const fetchImpl = makeFetch(jsonResponse({ image: PIXELS_B64 }));
  const client = new SiteShot("test-key", { fetchImpl });
  await assert.rejects(client.capture({ url: "" }), InvalidParamsError);
  assert.equal(fetchImpl.calls.length, 0);
});

test("request_headers object becomes repeated request_header params", async () => {
  const fetchImpl = makeFetch(jsonResponse({ image: PIXELS_B64 }));
  const client = new SiteShot("test-key", { fetchImpl });
  await client.capture({
    url: "https://example.com/",
    request_headers: { "X-First": "one", "X-Second": "two" },
  });
  const params = paramsOf(fetchImpl.calls[0]);
  assert.deepEqual(params.getAll("request_header"), ["X-First:one", "X-Second:two"]);
});

// ---------------------------------------------------------------------------
// Return modes
// ---------------------------------------------------------------------------

test("capture returns decoded Buffer", async () => {
  const fetchImpl = makeFetch(jsonResponse({ image: PIXELS_B64 }));
  const client = new SiteShot("test-key", { fetchImpl });
  const buf = await client.capture({ url: "https://example.com/" });
  assert.ok(Buffer.isBuffer(buf));
  assert.deepEqual(buf, PIXELS);
});

test("capture decodes data-URL-prefixed base64", async () => {
  const fetchImpl = makeFetch(
    jsonResponse({ image: `data:image/png;base64,${PIXELS_B64}` }),
  );
  const client = new SiteShot("test-key", { fetchImpl });
  const buf = await client.capture({ url: "https://example.com/" });
  assert.deepEqual(buf, PIXELS);
});

test("captureBase64 returns plain base64 with any data-URL prefix stripped", async () => {
  const fetchImpl = makeFetch(
    jsonResponse({ image: `data:image/png;base64,${PIXELS_B64}` }),
  );
  const client = new SiteShot("test-key", { fetchImpl });
  assert.equal(await client.captureBase64({ url: "https://example.com/" }), PIXELS_B64);
});

test("captureJson returns the full result object", async () => {
  const fetchImpl = makeFetch(
    jsonResponse({ image: PIXELS_B64, source_code: "<html></html>", extra_field: 7 }),
  );
  const client = new SiteShot("test-key", { fetchImpl });
  const meta = await client.captureJson({
    url: "https://example.com/",
    source_code: true,
  });
  assert.equal(meta.image, PIXELS_B64);
  assert.equal(meta.source_code, "<html></html>");
  assert.equal(meta.extra_field, 7);
  assert.equal(paramsOf(fetchImpl.calls[0]).get("source_code"), "1");
});

test("captureToFile writes the decoded bytes to disk", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "site-shot-sdk-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const fetchImpl = makeFetch(jsonResponse({ image: PIXELS_B64 }));
  const client = new SiteShot("test-key", { fetchImpl });
  const filePath = join(dir, "shot.png");
  await client.captureToFile({ url: "https://example.com/" }, filePath);
  assert.deepEqual(await readFile(filePath), PIXELS);
});

test("buildUrl embeds userkey, serializes params, does not execute or set response_type", () => {
  const fetchImpl = makeFetch(jsonResponse({ image: PIXELS_B64 }));
  const client = new SiteShot("test-key", { fetchImpl });
  const url = client.buildUrl({ url: "example.com", width: 1280, no_ads: true });
  const parsed = new URL(url);
  assert.equal(parsed.origin, "https://api.site-shot.com");
  assert.equal(parsed.searchParams.get("url"), "https://example.com");
  assert.equal(parsed.searchParams.get("userkey"), "test-key");
  assert.equal(parsed.searchParams.get("width"), "1280");
  assert.equal(parsed.searchParams.get("no_ads"), "1");
  assert.ok(!parsed.searchParams.has("response_type"));
  assert.equal(fetchImpl.calls.length, 0);
});

test("uses global fetch by default", async (t) => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return jsonResponse({ image: PIXELS_B64 });
  };
  t.after(() => {
    globalThis.fetch = original;
  });
  const client = new SiteShot("test-key");
  const buf = await client.capture({ url: "https://example.com/" });
  assert.deepEqual(buf, PIXELS);
  assert.equal(calls.length, 1);
});

// ---------------------------------------------------------------------------
// Error taxonomy
// ---------------------------------------------------------------------------

test("country_unavailable envelope (HTTP 200) throws CountryUnavailableError", async () => {
  const fetchImpl = makeFetch(jsonResponse({ error: "country_unavailable" }));
  const client = new SiteShot("test-key", { fetchImpl });
  await assert.rejects(
    client.capture({ url: "https://example.com/", country: "DE", strict_country: true }),
    (err) => {
      assert.ok(err instanceof CountryUnavailableError);
      assert.ok(err instanceof SiteShotError);
      assert.equal(err.httpStatus, 200);
      assert.deepEqual(err.body, { error: "country_unavailable" });
      return true;
    },
  );
});

test("country_unavailable envelope on a non-200 status still classifies correctly", async () => {
  const fetchImpl = makeFetch(jsonResponse({ error: "country_unavailable" }, 404));
  const client = new SiteShot("test-key", { fetchImpl });
  await assert.rejects(
    client.capture({ url: "https://example.com/", country: "BR", strict_country: true }),
    CountryUnavailableError,
  );
});

test("HTTP 401/403 throw AuthError", async () => {
  for (const status of [401, 403]) {
    const fetchImpl = makeFetch(jsonResponse({ error: "invalid userkey" }, status));
    const client = new SiteShot("test-key", { fetchImpl });
    await assert.rejects(client.capture({ url: "https://example.com/" }), AuthError);
  }
});

test("auth-flavoured in-band error (HTTP 200) throws AuthError", async () => {
  const fetchImpl = makeFetch(jsonResponse({ error: "Invalid userkey" }));
  const client = new SiteShot("test-key", { fetchImpl });
  await assert.rejects(client.capture({ url: "https://example.com/" }), AuthError);
});

test("HTTP 402/429 throw QuotaError", async () => {
  for (const status of [402, 429]) {
    const fetchImpl = makeFetch(new Response("limit", { status }));
    const client = new SiteShot("test-key", { fetchImpl });
    await assert.rejects(client.capture({ url: "https://example.com/" }), QuotaError);
  }
});

test("quota-flavoured in-band error throws QuotaError", async () => {
  const fetchImpl = makeFetch(jsonResponse({ error: "monthly quota exceeded" }));
  const client = new SiteShot("test-key", { fetchImpl });
  await assert.rejects(client.capture({ url: "https://example.com/" }), QuotaError);
});

test("HTTP 400 throws InvalidParamsError", async () => {
  const fetchImpl = makeFetch(jsonResponse({ error: "width out of range" }, 400));
  const client = new SiteShot("test-key", { fetchImpl });
  await assert.rejects(client.capture({ url: "https://example.com/", width: 9 }), InvalidParamsError);
});

test("HTTP 500 throws APIError with status and body attached", async () => {
  const fetchImpl = makeFetch(new Response("upstream exploded", { status: 500 }));
  const client = new SiteShot("test-key", { fetchImpl });
  await assert.rejects(client.capture({ url: "https://example.com/" }), (err) => {
    assert.ok(err instanceof APIError);
    assert.equal(err.httpStatus, 500);
    return true;
  });
});

test("HTTP 200 with non-JSON body throws APIError", async () => {
  const fetchImpl = makeFetch(new Response("<html>error page</html>", { status: 200 }));
  const client = new SiteShot("test-key", { fetchImpl });
  await assert.rejects(client.capture({ url: "https://example.com/" }), APIError);
});

test("JSON result without an image field throws APIError (capture mode only)", async () => {
  const fetchImpl = makeFetch(jsonResponse({ status: "ok but empty" }));
  const client = new SiteShot("test-key", { fetchImpl });
  await assert.rejects(client.capture({ url: "https://example.com/" }), APIError);
});

test("malformed base64 image payload throws APIError instead of returning corrupt bytes", async () => {
  for (const image of ["@@@@ not base64 @@@@", "%%%%"]) {
    const fetchImpl = makeFetch(jsonResponse({ image }));
    const client = new SiteShot("test-key", { fetchImpl });
    await assert.rejects(client.capture({ url: "https://example.com/" }), APIError);
  }
});

test("client-side timeout throws SiteShotTimeoutError", async () => {
  const fetchImpl = makeFetch((url, init) => {
    return new Promise((resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      });
    });
  });
  const client = new SiteShot("test-key", { fetchImpl, timeoutMs: 20 });
  await assert.rejects(client.capture({ url: "https://example.com/" }), SiteShotTimeoutError);
  assert.equal(fetchImpl.calls.length, 1);
});

test("timeoutMs also bounds the response body download (stalled body aborts, no retry)", async () => {
  const fetchImpl = makeFetch((url, init) => {
    return Promise.resolve({
      ok: true,
      status: 200,
      text: () =>
        new Promise((resolve, reject) => {
          init.signal.addEventListener("abort", () => {
            reject(Object.assign(new Error("body read aborted"), { name: "AbortError" }));
          });
        }),
    });
  });
  const client = new SiteShot("test-key", { fetchImpl, timeoutMs: 20, retries: 3 });
  await assert.rejects(client.capture({ url: "https://example.com/" }), SiteShotTimeoutError);
  assert.equal(fetchImpl.calls.length, 1);
});

// ---------------------------------------------------------------------------
// Retries
// ---------------------------------------------------------------------------

test("connection errors are NOT retried by default (retries: 0)", async () => {
  const fetchImpl = makeFetch(new TypeError("fetch failed"));
  const client = new SiteShot("test-key", { fetchImpl });
  await assert.rejects(client.capture({ url: "https://example.com/" }), APIError);
  assert.equal(fetchImpl.calls.length, 1);
});

test("retries: 2 retries connection errors and can succeed", async () => {
  const fetchImpl = makeFetch(
    new TypeError("fetch failed"),
    new TypeError("fetch failed"),
    jsonResponse({ image: PIXELS_B64 }),
  );
  const client = new SiteShot("test-key", { fetchImpl, retries: 2 });
  const buf = await client.capture({ url: "https://example.com/" });
  assert.deepEqual(buf, PIXELS);
  assert.equal(fetchImpl.calls.length, 3);
});

test("retries exhausted still throws APIError with the cause attached", async () => {
  const fetchImpl = makeFetch(new TypeError("fetch failed"));
  const client = new SiteShot("test-key", { fetchImpl, retries: 1 });
  await assert.rejects(client.capture({ url: "https://example.com/" }), (err) => {
    assert.ok(err instanceof APIError);
    assert.ok(err.cause instanceof TypeError);
    return true;
  });
  assert.equal(fetchImpl.calls.length, 2);
});

test("client-side timeout is never retried, even with retries > 0", async () => {
  const fetchImpl = makeFetch((url, init) => {
    return new Promise((resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      });
    });
  });
  const client = new SiteShot("test-key", { fetchImpl, timeoutMs: 20, retries: 3 });
  await assert.rejects(client.capture({ url: "https://example.com/" }), SiteShotTimeoutError);
  assert.equal(fetchImpl.calls.length, 1);
});

test("API-level errors (HTTP error status) are never retried", async () => {
  const fetchImpl = makeFetch(new Response("boom", { status: 500 }));
  const client = new SiteShot("test-key", { fetchImpl, retries: 3 });
  await assert.rejects(client.capture({ url: "https://example.com/" }), APIError);
  assert.equal(fetchImpl.calls.length, 1);
});
