"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  SiteShot,
  SiteShotError,
  AuthError,
  QuotaError,
  CountryUnavailableError,
  InvalidParamsError,
  SiteShotTimeoutError,
  APIError,
} = require("../dist/index.cjs");

test("CJS entry point exposes the full public surface", () => {
  for (const exported of [
    SiteShot,
    SiteShotError,
    AuthError,
    QuotaError,
    CountryUnavailableError,
    InvalidParamsError,
    SiteShotTimeoutError,
    APIError,
  ]) {
    assert.equal(typeof exported, "function");
  }
});

test("CJS client round-trip works", async () => {
  const bytes = Buffer.from("cjs-bytes");
  const fetchImpl = async () =>
    new Response(JSON.stringify({ image: bytes.toString("base64") }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  const client = new SiteShot("test-key", { fetchImpl });
  const buf = await client.capture({ url: "example.com" });
  assert.deepEqual(buf, bytes);
});
