// Controlled HTTPS transport fixture; no production URL, CORS, or TLS exceptions.
import { chromium } from "playwright-core";
import { createServer } from "node:https";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const base = process.env.SNAPLOAD_TEST_URL ?? "http://localhost:3000";
const origin = new URL(base).origin;
const directory = await mkdtemp(join(tmpdir(), "snapload-security-"));
const files = {
  mp4: await readFile("tests/fixtures/conversion.mp4"),
  mp3: await readFile("tests/fixtures/sample.mp3"),
};
const pad = (bytes, size) => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(size - bytes.length);
  head.write("free", 4);
  return Buffer.concat([bytes, head, Buffer.alloc(size - bytes.length - 8)]);
};
const stress = pad(files.mp4, 32 * 1024 * 1024);
execFileSync(
  "openssl",
  [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    join(directory, "key.pem"),
    "-out",
    join(directory, "cert.pem"),
    "-days",
    "1",
    "-subj",
    "/CN=snapload-security.test",
  ],
  { stdio: "ignore" },
);
const server = createServer(
  {
    key: await readFile(join(directory, "key.pem")),
    cert: await readFile(join(directory, "cert.pem")),
  },
  (req, res) => {
    const path = new URL(req.url, "https://snapload-security.test").pathname;
    const mp3 = path.endsWith(".mp3");
    let body = mp3 ? files.mp3 : files.mp4;
    if (path != "/nocors.mp4")
      res.setHeader("Access-Control-Allow-Origin", origin);
    if (path === "/redirect.mp4") {
      res.writeHead(302, {
        location: "https://snapload-security.test/file.mp4",
      });
      res.end();
      return;
    }
    res.setHeader(
      "Content-Type",
      mp3
        ? "audio/mpeg"
        : path === "/unsupported.webm"
          ? "video/webm"
          : "video/mp4",
    );
    if (path === "/fake.mp3") body = Buffer.from("ID3NOT A REAL MP3");
    if (path === "/truncated.mp4") body = body.subarray(0, body.length - 1);
    if (path === "/gzip.mp3" || path === "/gzip-fake.mp3") {
      body = gzipSync(
        path === "/gzip.mp3" ? files.mp3 : Buffer.from("ID3fake"),
      );
      res.setHeader("Content-Encoding", "gzip");
    }
    if (path === "/stress.mp4") body = stress;
    if (path === "/overflow.mp4") {
      res.writeHead(200);
      let sent = 0;
      const timer = setInterval(() => {
        if (sent++ < 10) res.write(Buffer.alloc(1024 * 1024));
        else {
          clearInterval(timer);
          res.end();
        }
      }, 10);
      res.on("close", () => clearInterval(timer));
      return;
    }
    res.setHeader("Content-Length", body.length);
    res.end(body);
  },
);
await new Promise((r) => server.listen(3345, "127.0.0.1", r));
const browser = await chromium.launch({
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: [
    "--no-proxy-server",
    "--host-resolver-rules=MAP snapload-security.test 127.0.0.1:3345",
  ],
});
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
try {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    acceptDownloads: true,
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "deviceMemory", { get: () => 8 });
    window.__inputArrayBuffers = 0;
    const original = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function () {
      window.__inputArrayBuffers++;
      return original.call(this);
    };
  });
  const page = await context.newPage();
  const response = await page.goto(base);
  const headers = response.headers();
  assert.equal(headers["x-frame-options"], "DENY");
  assert.equal(headers["x-content-type-options"], "nosniff");
  assert.ok(headers["content-security-policy"].includes("'wasm-unsafe-eval'"));
  assert.ok(!headers["content-security-policy"].includes("'unsafe-eval'"));
  const check = async (path) => {
    await page
      .locator("#media-url")
      .fill(`https://snapload-security.test/${path}`);
    await page
      .getByRole("button", { name: "Check download", exact: true })
      .click();
  };
  for (const [path, expected, ext] of [
    ["file.mp4", files.mp4, "MP4"],
    ["file.mp3", files.mp3, "MP3"],
    ["gzip.mp3", files.mp3, "MP3"],
    ["stress.mp4", stress, "MP4"],
  ]) {
    await check(path);
    const button = page.getByRole("button", {
      name: `Download ${ext}`,
    });
    await button.waitFor({ timeout: 30000 });
    const event = page.waitForEvent("download");
    await button.click();
    const downloaded = await event;
    const saved = join(directory, path);
    await downloaded.saveAs(saved);
    assert.equal(hash(await readFile(saved)), hash(expected));
    execFileSync("/usr/local/bin/ffmpeg", [
      "-v",
      "error",
      "-i",
      saved,
      "-f",
      "null",
      "-",
    ]);
    console.log("PASS browser bytes+structure+save", path);
  }
  for (const [path, error] of [
    ["fake.mp3", /Corrupt/],
    ["truncated.mp4", /Corrupt/],
    ["gzip-fake.mp3", /Corrupt/],
    ["unsupported.webm", /Unsupported media type/],
    ["redirect.mp4", /Redirected/],
    ["nocors.mp4", /CORS/],
  ]) {
    await check(path);
    await page.locator("#media-error").waitFor();
    assert.match(await page.locator("#media-error").innerText(), error);
    assert.equal(await page.locator(".download-action:enabled").count(), 0);
    console.log("PASS browser rejects", path);
  }
  await page
    .locator("#media-url")
    .fill("https://youtube.com./watch?v=dQw4w9WgXcQ");
  await page.locator("#unsupported-link").waitFor();
  assert.match(
    await page.locator("#unsupported-link").innerText(),
    /YouTube downloads are unsupported/,
  );
  assert.equal(await page.locator(".download-action").count(), 0);
  assert.equal(await page.locator("iframe").count(), 0);
  // 24 MB mounted conversion exercises the desktop cap without copying File.arrayBuffer.
  await page.getByRole("tab", { name: "Upload a file" }).click();
  await page.locator("#local-file").setInputFiles({
    name: "stress.mp4",
    mimeType: "video/mp4",
    buffer: pad(files.mp4, 24 * 1024 * 1024),
  });
  await page.getByRole("button", { name: "Convert to MP3" }).click();
  const output = page.getByRole("link", { name: "Download MP3" });
  await output.waitFor({ timeout: 90000 });
  const downloadEvent = page.waitForEvent("download");
  await output.click();
  const converted = await downloadEvent;
  const saved = join(directory, "stress-output.mp3");
  await converted.saveAs(saved);
  execFileSync("/usr/local/bin/ffmpeg", [
    "-v",
    "error",
    "-i",
    saved,
    "-f",
    "null",
    "-",
  ]);
  assert.equal(await page.evaluate(() => window.__inputArrayBuffers), 0);
  assert.equal(page.workers().length, 0);
  console.log(
    "PASS 24 MB on-demand conversion stress+decode+worker cleanup (no main-thread full-input read)",
  );
  // Event handler attributes are blocked despite static Next inline hydration scripts.
  await page.evaluate(() => {
    window.__inlineRan = false;
    const b = document.createElement("button");
    b.id = "csp-probe";
    b.setAttribute("onclick", "window.__inlineRan=true");
    document.body.appendChild(b);
    b.click();
  });
  assert.equal(await page.evaluate(() => window.__inlineRan), false);
  console.log("PASS CSP blocks inline event handlers");
  await context.close();
  const mobile = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    userAgent: "iPhone",
  });
  const m = await mobile.newPage();
  await m.goto(base);
  await m
    .locator("#media-url")
    .fill("https://snapload-security.test/overflow.mp4");
  await m.getByRole("button", { name: "Check download", exact: true }).click();
  await m.locator("#media-error").filter({ hasText: "8 MB" }).waitFor();
  assert.equal(await m.locator(".download-action:enabled").count(), 0);
  console.log("PASS streamed mobile overflow is rejected");
  await m.getByRole("tab", { name: "Upload a file" }).click();
  await m.locator("#local-file").setInputFiles({
    name: "too-large.mp4",
    mimeType: "video/mp4",
    buffer: Buffer.alloc(8 * 1024 * 1024 + 1),
  });
  await m.locator("#media-error").filter({ hasText: "8 MB" }).waitFor();
  assert.equal(m.workers().length, 0);
  console.log("PASS oversized local mobile file rejected before processing");
  await mobile.close();
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
  await rm(directory, { recursive: true, force: true });
}
