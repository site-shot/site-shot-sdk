#!/usr/bin/env node
/**
 * Live smoke test against the real Site-Shot API.
 *
 * Gated on SITESHOT_API_KEY: without the env var it prints SKIP and exits 0,
 * so it is safe anywhere but only meaningful with a real key. Each run spends
 * render quota, so it performs a single capture. Not wired into CI on
 * purpose — run it manually as part of the npm-publish checklist:
 *
 *   SITESHOT_API_KEY=... npm run smoke      # (build first: npm run build)
 */
import { SiteShot } from "../dist/index.js";

const key = process.env.SITESHOT_API_KEY;
if (!key || !key.trim()) {
  console.log("SKIP: SITESHOT_API_KEY is not set; live smoke test not run.");
  process.exit(0);
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** A real render of example.com is far bigger than any error blob. */
const MIN_PLAUSIBLE_BYTES = 5_000;

const client = new SiteShot(key);
const buf = await client.capture({ url: "https://example.com/" });

if (!buf.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
  console.error(
    `FAIL: expected PNG magic bytes, got ${buf.subarray(0, 8).toString("hex")} ` +
      `(${buf.length} bytes total)`,
  );
  process.exit(1);
}
if (buf.length < MIN_PLAUSIBLE_BYTES) {
  console.error(`FAIL: image implausibly small (${buf.length} bytes < ${MIN_PLAUSIBLE_BYTES}).`);
  process.exit(1);
}

console.log(`PASS: live capture returned a plausible PNG (${buf.length} bytes).`);
