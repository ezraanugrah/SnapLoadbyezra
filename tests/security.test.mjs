import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  validateDirectUrl,
  fetchMedia,
  trustedTransferLength,
} from "../lib/download.ts";
import { detectPlatform, validateUrl } from "../lib/media.ts";
import { validateMediaStructure } from "../lib/media-structure.ts";
import {
  downloadByteLimit,
  DESKTOP_DOWNLOAD_BYTES,
  CONSERVATIVE_DOWNLOAD_BYTES,
} from "../lib/device-limits.ts";
import config, { contentSecurityPolicy } from "../next.config.mjs";
const file = async (ext) =>
  new Uint8Array(
    await readFile(new URL(`./fixtures/sample.${ext}`, import.meta.url)),
  );
const media = async (ext, data, headers = {}, extra = {}) =>
  fetchMedia(`https://media.example.org/test.${ext}`, {
    signal: new AbortController().signal,
    fetcher: async () =>
      new Response(data, {
        headers: {
          "content-type": ext === "mp3" ? "audio/mpeg" : "video/mp4",
          ...headers,
        },
      }),
    ...extra,
  });
const box = (type, payload) => {
  const data = new Uint8Array(8 + payload.length);
  new DataView(data.buffer).setUint32(0, data.length);
  data.set(new TextEncoder().encode(type), 4);
  data.set(payload, 8);
  return data;
};

test("normalizes trailing dots consistently before hostname filters and platform path validation", () => {
  for (const host of [
    "youtube.com.",
    "WWW.TIKTOK.COM..",
    "cdninstagram.com.",
    "localhost.",
    "foo.local.",
    "127.0.0.1.",
    "x.internal.",
  ])
    assert.throws(() => validateDirectUrl(`https://${host}/a.mp4`));
  assert.equal(
    validateDirectUrl("https://MEDIA.EXAMPLE.ORG./a.mp4").href,
    "https://media.example.org/a.mp4",
  );
  assert.equal(
    detectPlatform("https://youtube.com./watch?v=dQw4w9WgXcQ"),
    "YouTube",
  );
  assert.equal(validateUrl("https://youtu.be./dQw4w9WgXcQ"), null);
  assert.equal(validateUrl("https://vm.tiktok.com./Abc123/"), null);
});

test("valid fixtures pass; corrupt frames, ID3 bombs and fake ftyp boxes fail", async () => {
  for (const ext of ["mp3", "mp4"]) {
    const data = await file(ext);
    await assert.doesNotReject(media(ext, data));
    await assert.rejects(
      media(ext, data.subarray(0, data.length - 1)),
      /Corrupt/,
    );
  }
  await assert.rejects(
    media("mp3", new TextEncoder().encode("ID3NOT A REAL MP3")),
    /Corrupt/,
  );
  const bomb = new Uint8Array([73, 68, 51, 4, 0, 0, 127, 127, 127, 127, 0]);
  await assert.rejects(media("mp3", bomb), /Unsupported/);
  await assert.rejects(media("mp4", box("ftyp", new Uint8Array(8))), /Corrupt/);
  const mp3 = await file("mp3");
  mp3[mp3.length - 2] = 0; // payload changes need not corrupt framing
  await assert.doesNotReject(media("mp3", mp3));
  await assert.rejects(
    media("mp4", new TextEncoder().encode("<html>")),
    /Corrupt/,
  );
  await assert.rejects(
    validateMediaStructure(new Blob([mp3]), "audio/wav"),
    /Unsupported/,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    validateMediaStructure(new Blob([mp3]), "audio/mpeg", controller.signal),
    { name: "AbortError" },
  );
});

test("MP4 sample offsets outside mdat, metadata bombs, and unbounded box counts fail", async () => {
  const mp4 = await file("mp4");
  const needle = new TextEncoder().encode("stco");
  let found = -1;
  for (let i = 0; i < mp4.length - 4; i++)
    if (needle.every((v, j) => mp4[i + j] === v)) {
      found = i;
      break;
    }
  assert.ok(found >= 0);
  new DataView(mp4.buffer).setUint32(found + 12, 0xffffffff);
  await assert.rejects(media("mp4", mp4), /Corrupt/);
  await assert.rejects(
    media("mp4", box("moov", new Uint8Array(2 * 1024 * 1024))),
    /Unsupported/,
  );
  await assert.rejects(
    media(
      "mp4",
      new Blob(
        Array.from({ length: 10001 }, () => box("free", new Uint8Array(0))),
      ),
    ),
    /Unsupported/,
  );
});

test("only trustworthy identity lengths are compared; decoded files are still structurally validated", async () => {
  const mp3 = await file("mp3");
  for (const headers of [
    { "content-length": "1" },
    { "content-length": "1", "content-encoding": "gzip" },
    { "content-length": "999999" },
  ]) {
    const result = await media("mp3", mp3, headers);
    assert.equal(result.size, mp3.length);
  }
  await assert.rejects(
    media("mp3", mp3, {
      "content-length": "1",
      "content-encoding": "identity",
    }),
    /incomplete/,
  );
  await assert.rejects(
    media("mp3", new TextEncoder().encode("ID3fake"), {
      "content-length": "1",
      "content-encoding": "gzip",
    }),
    /Corrupt/,
  );
  const response = new Response(mp3, {
    headers: { "content-length": String(mp3.length) },
  });
  Object.defineProperty(response, "type", { value: "cors" });
  assert.equal(trustedTransferLength(response), null);
  const basic = new Response(mp3, {
    headers: { "content-length": String(mp3.length) },
  });
  Object.defineProperty(basic, "type", { value: "basic" });
  assert.equal(trustedTransferLength(basic), mp3.length);
});

test("device limits cover mobile, unknown-memory devices, desktop, and explicit low-memory reports", () => {
  assert.equal(downloadByteLimit({}), CONSERVATIVE_DOWNLOAD_BYTES);
  assert.equal(downloadByteLimit({ deviceMemory: 8 }), DESKTOP_DOWNLOAD_BYTES);
  assert.equal(
    downloadByteLimit({ deviceMemory: 4 }),
    CONSERVATIVE_DOWNLOAD_BYTES,
  );
  assert.equal(
    downloadByteLimit({ deviceMemory: 8, userAgent: "iPhone" }),
    CONSERVATIVE_DOWNLOAD_BYTES,
  );
  assert.equal(
    downloadByteLimit({
      deviceMemory: 8,
      platform: "MacIntel",
      maxTouchPoints: 5,
    }),
    CONSERVATIVE_DOWNLOAD_BYTES,
  );
});

test("stress: exact 32 MB valid MP4, tiny chunks, streamed overflow, and cleanup", async () => {
  const fixture = await file("mp4");
  const padded = new Blob([
    fixture,
    box("free", new Uint8Array(DESKTOP_DOWNLOAD_BYTES - fixture.length - 8)),
  ]);
  const result = await media(
    "mp4",
    padded,
    {},
    { maxBytes: DESKTOP_DOWNLOAD_BYTES },
  );
  assert.equal(result.size, DESKTOP_DOWNLOAD_BYTES);
  const mp3 = await file("mp3");
  let cancelled = false;
  let cursor = 0;
  const tiny = () =>
    new Response(
      new ReadableStream({
        pull(c) {
          if (cursor === mp3.length) {
            c.close();
            return;
          }
          c.enqueue(mp3.subarray(cursor, cursor + 1));
          cursor++;
        },
        cancel() {
          cancelled = true;
        },
      }),
      { headers: { "content-type": "audio/mpeg" } },
    );
  await assert.doesNotReject(
    fetchMedia("https://media.example.org/x.mp3", {
      signal: new AbortController().signal,
      fetcher: async () => tiny(),
    }),
  );
  let sent = 0;
  const oversized = () =>
    new Response(
      new ReadableStream({
        pull(c) {
          sent++;
          c.enqueue(new Uint8Array(1024 * 1024));
        },
        cancel() {
          cancelled = true;
        },
      }),
      { headers: { "content-type": "video/mp4" } },
    );
  await assert.rejects(
    fetchMedia("https://media.example.org/x.mp4", {
      signal: new AbortController().signal,
      maxBytes: CONSERVATIVE_DOWNLOAD_BYTES,
      fetcher: async () => oversized(),
    }),
    /8 MB/,
  );
  assert.ok(cancelled);
  assert.ok(sent <= 10);
  await assert.doesNotReject(media("mp3", mp3));
});

test("security headers cover all paths and constrain frames, plugins, scripts and WASM", async () => {
  const rules = await config.headers();
  assert.equal(rules[0].source, "/:path*");
  const headers = Object.fromEntries(
    rules[0].headers.map(({ key, value }) => [key, value]),
  );
  assert.equal(headers["X-Frame-Options"], "DENY");
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  for (const directive of [
    "worker-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "script-src-attr 'none'",
    "'wasm-unsafe-eval'",
  ])
    assert.ok(contentSecurityPolicy.includes(directive));
  assert.ok(!contentSecurityPolicy.includes("'unsafe-eval'"));
});
