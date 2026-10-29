import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import {
  fetchMedia,
  validateDirectUrl,
  MAX_DOWNLOAD_BYTES,
} from "../lib/download.ts";
const options = (fetcher) => ({
  signal: new AbortController().signal,
  fetcher,
});
const fixture = async (extension) =>
  new Uint8Array(
    await readFile(new URL(`./fixtures/sample.${extension}`, import.meta.url)),
  );
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("real HTTP transfers preserve generated MP4 and MP3 bytes and decoder-ready files", async () => {
  const files = { mp4: await fixture("mp4"), mp3: await fixture("mp3") };
  const server = createServer((req, res) => {
    const ext = req.url.slice(1);
    const data = files[ext];
    res.writeHead(200, {
      "content-type": ext === "mp4" ? "video/mp4" : "audio/mpeg",
      "content-length": data.length,
    });
    res.end(data);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    for (const extension of ["mp4", "mp3"]) {
      const progress = [];
      // Test-only transport adapter: production has no localhost or HTTP exception.
      const fetcher = (_url, init) =>
        fetch(`http://127.0.0.1:${server.address().port}/${extension}`, init);
      const media = await fetchMedia(
        `https://media.example.org/sample.${extension}`,
        { ...options(fetcher), onProgress: (p) => progress.push(p) },
      );
      assert.equal(
        digest(new Uint8Array(await media.blob.arrayBuffer())),
        digest(files[extension]),
      );
      assert.equal(media.size, files[extension].length);
      assert.equal(progress.at(-1).received, files[extension].length);
      assert.equal(media.name, `sample.${extension}`);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("rejects unsafe URLs before fetching", () => {
  for (const url of [
    "http://example.org/a.mp4",
    "https://127.0.0.1/a.mp4",
    "https://[::1]/a",
    "https://localhost/a",
    "https://a.local/a",
    "https://user:pass@example.org/a",
    "https://example.org:8080/a",
    "https://www.youtube.com/watch?v=123",
    "https://x.googlevideo.com/a",
  ])
    assert.throws(() => validateDirectUrl(url));
  assert.equal(
    validateDirectUrl("https://media.example.org/file?token=abc").hostname,
    "media.example.org",
  );
});

test("rejects HTML, fake media, empty, truncated, oversized, redirects and HTTP failures", async () => {
  const mp4 = await fixture("mp4");
  for (const response of [
    new Response("<html/>", { headers: { "content-type": "text/html" } }),
    new Response("not a video", { headers: { "content-type": "video/mp4" } }),
    new Response("", { headers: { "content-type": "audio/mpeg" } }),
    new Response(mp4, {
      headers: {
        "content-type": "video/mp4",
        "content-length": mp4.length + 1,
        "content-encoding": "identity",
      },
    }),
    new Response(mp4, {
      headers: {
        "content-type": "video/mp4",
        "content-length": MAX_DOWNLOAD_BYTES + 1,
        "content-encoding": "identity",
      },
    }),
    new Response(null, { status: 302 }),
    new Response(null, { status: 403 }),
    new Response(mp4, { status: 206 }),
  ])
    await assert.rejects(
      fetchMedia(
        "https://media.example.org/file",
        options(async () => response),
      ),
    );
});

test("unknown-length streams report bytes; network/CORS and cancellation are explicit", async () => {
  const mp3 = await fixture("mp3");
  const progress = [];
  await fetchMedia("https://media.example.org/file", {
    ...options(
      async () =>
        new Response(mp3, { headers: { "content-type": "audio/mpeg" } }),
    ),
    onProgress: (p) => progress.push(p),
  });
  assert.equal(progress.at(-1).total, null);
  await assert.rejects(
    fetchMedia(
      "https://media.example.org/file",
      options(async () => {
        throw new TypeError("Failed to fetch");
      }),
    ),
    /CORS/,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    fetchMedia("https://media.example.org/file", { signal: controller.signal }),
    { name: "AbortError" },
  );
  const active = new AbortController();
  await assert.rejects(
    fetchMedia("https://media.example.org/file", {
      signal: active.signal,
      fetcher: async (_url, init) => {
        assert.equal(init.credentials, "omit");
        assert.equal(init.redirect, "manual");
        return new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(mp3);
            },
            cancel() {},
          }),
          { headers: { "content-type": "audio/mpeg" } },
        );
      },
      onProgress: (p) => {
        if (p.received) active.abort();
      },
    }),
    { name: "AbortError" },
  );
});
