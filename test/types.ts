// Type-level pin for `CaptureOptions["format"]`.
//
// This file is never executed — `npm run typecheck` (`tsc --noEmit`) picks it
// up because tsconfig.json's `include` lists it alongside `src`. If the
// `format` union in src/client.ts ever loses a value this SDK promises to
// accept, this file fails to compile and `npm run typecheck` (which CI and
// `prepublishOnly` both run) goes red.
import type { CaptureOptions } from "../src/client";

// "webp" must be assignable. CaptureOptions also carries a
// `[param: string]: unknown` index signature, but an *explicitly declared*
// property like `format` is checked against its own declared type, not the
// index signature, so this only compiles when the union actually lists "webp".
const webpOptions: CaptureOptions = { url: "https://example.com/", format: "webp" };
void webpOptions;

// The existing values must keep working too.
const pngOptions: CaptureOptions = { url: "https://example.com/", format: "png" };
void pngOptions;
const jpegOptions: CaptureOptions = { url: "https://example.com/", format: "jpeg" };
void jpegOptions;
