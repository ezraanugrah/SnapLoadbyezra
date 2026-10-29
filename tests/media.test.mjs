import assert from "node:assert/strict";
import { test } from "node:test";
import { detectPlatform, validateUrl, inferMediaType } from "../lib/media.ts";

test("accepts supported media path shapes without claiming availability", () => {
  for (const url of [
    "https://www.instagram.com/reel/Abc_123/",
    "https://instagram.com/p/Abc-123/",
    "https://www.tiktok.com/@creator/video/1234567890",
    "https://vm.tiktok.com/Abc123/",
    "https://vt.tiktok.com/Abc123/",
    "https://www.tiktok.com/t/Abc123/",
    "https://youtube.com/watch?v=dQw4w9WgXcQ&feature=share",
    "https://youtu.be/dQw4w9WgXcQ?t=10",
    "https://m.youtube.com/shorts/dQw4w9WgXcQ",
    "https://youtube.com/live/dQw4w9WgXcQ",
    "https://youtube.com/embed/dQw4w9WgXcQ",
  ])
    assert.equal(validateUrl(url), null, url);
});

test("rejects malformed, non-media, spoofed and credentialed URLs", () => {
  for (const url of [
    "",
    "youtube.com/watch?v=dQw4w9WgXcQ",
    "javascript:alert(1)",
    "https://youtube.com/",
    "https://instagram.com/creator/",
    "https://tiktok.com/@creator",
    "https://youtube.com/playlist?list=123",
    "https://youtube.com/watch?v=short",
    "https://youtu.be/",
    "https://youtube.com/shorts/dQw4w9WgXcQ/extra",
    "https://instagram.com/reel/",
    "https://tiktok.com/@a/video/not-a-number",
    "https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ",
    "https://notyoutube.com/watch?v=dQw4w9WgXcQ",
    "https://user:password@youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com:8080/watch?v=dQw4w9WgXcQ",
  ])
    assert.ok(validateUrl(url), url);
  assert.equal(detectPlatform("https://youtube.com.evil.test"), null);
  assert.equal(detectPlatform("https://www.instagram.com/"), "Instagram");
});

test("uses a conservative extension fallback only for missing or generic MIME", () => {
  assert.equal(inferMediaType({ name: "clip.MP4", type: "" }), "video/mp4");
  assert.equal(
    inferMediaType({ name: "song.mp3", type: "application/octet-stream" }),
    "audio/mpeg",
  );
  assert.equal(inferMediaType({ name: "clip.mp4.exe", type: "" }), null);
  assert.equal(inferMediaType({ name: "clip.mp4", type: "text/html" }), null);
  assert.equal(inferMediaType({ name: "unknown", type: "" }), null);
  assert.equal(
    inferMediaType({ name: "audio", type: "audio/wav" }),
    "audio/wav",
  );
});

test("rejects prototype property extensions", () => {
  assert.equal(inferMediaType({ name: "file.constructor", type: "" }), null);
});
