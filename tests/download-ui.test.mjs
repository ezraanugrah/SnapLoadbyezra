import { test } from "node:test";
import assert from "node:assert/strict";
import { detectPlatform } from "../lib/media.ts";
import { validateDirectUrl } from "../lib/download.ts";
import config, { contentSecurityPolicy } from "../next.config.mjs";

test("social platforms remain identified and rejected for direct downloading", () => {
  for (const [url, platform] of [
    ["https://www.tiktok.com/@creator/video/6718335390845095173", "TikTok"],
    ["https://vm.tiktok.com/ABC123/", "TikTok"],
    ["https://www.instagram.com/reel/ABC123/", "Instagram"],
    ["https://youtu.be/dQw4w9WgXcQ", "YouTube"],
    ["https://youtube.com./watch?v=dQw4w9WgXcQ", "YouTube"],
    ["https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ", "YouTube"],
  ]) {
    assert.equal(detectPlatform(url), platform);
    assert.throws(
      () => validateDirectUrl(url),
      /Social platform downloads are unsupported/,
    );
  }
  assert.equal(detectPlatform("https://youtube.com.evil.test/file.mp4"), null);
  assert.equal(
    validateDirectUrl("https://media.example.org/file.mp4").hostname,
    "media.example.org",
  );
});
test("social embed permissions are fully revoked without weakening local media/worker protections", async () => {
  assert.ok(contentSecurityPolicy.split("; ").includes("frame-src 'none'"));
  for (const domain of [
    "instagram.com",
    "tiktok.com",
    "youtube.com",
    "youtube-nocookie.com",
  ])
    assert.ok(!contentSecurityPolicy.includes(domain));
  for (const directive of [
    "worker-src 'self'",
    "media-src 'self' blob:",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "script-src-attr 'none'",
    "'wasm-unsafe-eval'",
  ])
    assert.ok(contentSecurityPolicy.includes(directive));
  const headers = Object.fromEntries(
    (await config.headers())[0].headers.map(({ key, value }) => [key, value]),
  );
  assert.equal(headers["X-Frame-Options"], "DENY");
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
});
