// Run against `npm start`. Uses installed Chrome; no browser download required.
import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const browser = await chromium.launch({
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const directory = await mkdtemp(join(tmpdir(), "snapload-mp3-"));
try {
  const page = await browser.newPage({ acceptDownloads: true });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    const live = new Set();
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      const url = create(blob);
      live.add(url);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      live.delete(url);
      revoke(url);
    };
    window.__snaploadBlobCount = () => live.size;
  });
  const response = await page.goto(
    process.env.SNAPLOAD_TEST_URL ?? "http://localhost:3000",
  );
  const headers = response.headers();
  assert.equal(headers["x-frame-options"], "DENY");
  assert.equal(headers["x-content-type-options"], "nosniff");
  assert.ok(
    headers["content-security-policy"].includes("frame-ancestors 'none'"),
  );
  const violations = [];
  await page.evaluate(() =>
    window.addEventListener("securitypolicyviolation", (event) => {
      console.error("CSP-VIOLATION", event.violatedDirective);
    }),
  );
  page.on("console", (message) => {
    if (message.text().includes("CSP-VIOLATION"))
      violations.push(message.text());
  });
  await page.getByRole("tab", { name: "Upload a file" }).click();
  const upload = async (path) =>
    page.locator("#local-file").setInputFiles(resolve(path));
  const ensureClean = async () => {
    const deadline = Date.now() + 5000;
    while (page.workers().length && Date.now() < deadline)
      await page.waitForTimeout(100);
    assert.equal(
      page.workers().length,
      0,
      "conversion worker must be terminated",
    );
  };
  await upload("tests/fixtures/conversion.mp4");
  for (const bitrate of [128, 192, 320]) {
    await page.getByLabel("MP3 audio bitrate").selectOption(String(bitrate));
    await page.getByRole("button", { name: /Convert (to MP3|again)/ }).click();
    const output = page.getByRole("link", { name: "Download MP3" });
    await Promise.race([
      output.waitFor({ timeout: 90_000 }),
      page
        .locator('.converter [role="alert"]')
        .waitFor({ timeout: 90_000 })
        .then(async () => {
          throw new Error(
            await page.locator('.converter [role="alert"]').innerText(),
          );
        }),
    ]);
    const downloadEvent = page.waitForEvent("download");
    await output.click();
    const downloaded = await downloadEvent;
    const path = join(directory, `${bitrate}.mp3`);
    await downloaded.saveAs(path);
    execFileSync("/usr/local/bin/ffmpeg", [
      "-v",
      "error",
      "-i",
      path,
      "-f",
      "null",
      "-",
    ]);
    const decoded = spawnSync(
      "/usr/local/bin/ffmpeg",
      ["-hide_banner", "-i", path, "-f", "null", "-"],
      { encoding: "utf8" },
    );
    assert.equal(decoded.status, 0, decoded.stderr);
    assert.match(decoded.stderr, /Audio: mp3/);
    assert.match(
      decoded.stderr,
      new RegExp(`Audio: mp3[^\\n]*${bitrate} kb/s`),
    );
    await ensureClean();
    console.log(
      `PASS: real WASM ${bitrate} kbps output downloaded and decoded`,
    );
  }
  // Cancel immediately during engine loading, then verify recovery.
  await page.getByRole("button", { name: "Convert again" }).click();
  await page.getByRole("button", { name: "Cancel conversion" }).click();
  await page.getByText("Conversion cancelled. No output saved.").waitFor();
  await ensureClean();
  assert.equal(
    await page.evaluate(() => document.activeElement.textContent),
    "Convert to MP3",
  );
  console.log("PASS: cancellation and worker cleanup");
  await upload("tests/fixtures/cancellation.mp4");
  await page.getByRole("button", { name: "Convert to MP3" }).click();
  await page
    .locator('.converter [role="status"]')
    .filter({ hasText: "Converting audio locally" })
    .waitFor({ timeout: 90_000 });
  await page.getByRole("button", { name: "Cancel conversion" }).click();
  await page.getByText("Conversion cancelled. No output saved.").waitFor();
  await ensureClean();
  assert.equal(await page.evaluate(() => window.__snaploadBlobCount()), 1);
  assert.equal(
    await page.evaluate(() => document.activeElement.textContent),
    "Convert to MP3",
  );
  console.log("PASS: active encoding cancellation and output cleanup");

  await upload("tests/fixtures/sample.mp4");
  await page.getByRole("button", { name: "Convert to MP3" }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "no supported audio track" })
    .waitFor({ timeout: 90_000 });
  await ensureClean();
  console.log("PASS: video without audio rejected and worker cleaned");
  await page.locator("#local-file").setInputFiles({
    name: "broken.mp4",
    mimeType: "video/mp4",
    buffer: Buffer.from("broken video"),
  });
  await page.getByRole("button", { name: "Convert to MP3" }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: /Cannot read|duration/ })
    .waitFor({ timeout: 90_000 });
  await ensureClean();
  console.log("PASS: malformed input rejected and worker cleaned");
  await upload("tests/fixtures/conversion.mp4");
  await page.getByRole("button", { name: "Convert to MP3" }).click();
  await page.getByRole("tab", { name: "Paste a link" }).click();
  await ensureClean();
  assert.equal(await page.evaluate(() => window.__snaploadBlobCount()), 0);
  console.log(
    "PASS: switching tabs cancels conversion and revokes all blob URLs",
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(violations, []);
  console.log("PASS: no browser page errors");
} finally {
  await browser.close();
  await rm(directory, { recursive: true, force: true });
}
