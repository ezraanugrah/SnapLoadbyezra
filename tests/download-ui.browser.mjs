import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
const browser = await chromium.launch({
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const directory = await mkdtemp(join(tmpdir(), "snapload-download-ui-"));
try {
  const page = await browser.newPage({ acceptDownloads: true });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const files = {
    mp4: await readFile("tests/fixtures/conversion.mp4"),
    mp3: await readFile("tests/fixtures/sample.mp3"),
  };
  let release;
  let providerRequests = 0;
  page.on("request", (request) => {
    if (/https:\/\/[^/]*(?:youtube|instagram|tiktok)/.test(request.url()))
      providerRequests++;
  });
  await page.route("https://media.example.test/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/slow.mp4")
      await new Promise((resolve) => (release = resolve));
    if (path === "/missing.mp4")
      return route.fulfill({ status: 404, body: "Not found" });
    const mp3 = path.endsWith(".mp3");
    return route.fulfill({
      contentType: mp3 ? "audio/mpeg" : "video/mp4",
      headers: { "access-control-allow-origin": "*" },
      body:
        path === "/corrupt.mp3"
          ? Buffer.from("ID3FAKE MEDIA")
          : files[mp3 ? "mp3" : "mp4"],
    });
  });
  const response = await page.goto(
    process.env.SNAPLOAD_TEST_URL ?? "http://localhost:3000",
  );
  const policy = response.headers()["content-security-policy"];
  assert.ok(policy.includes("frame-src 'none'"));
  assert.ok(!/instagram|tiktok|youtube/.test(policy));
  const mp4 = page.getByRole("button", { name: "Download MP4", exact: true });
  const mp3 = page.getByRole("button", { name: "Download MP3", exact: true });
  assert.ok(await mp4.isDisabled());
  assert.ok(await mp3.isDisabled());
  assert.equal(
    await page.getByRole("button", { name: "Preview", exact: true }).count(),
    0,
  );
  const check = async (path) => {
    await page.locator("#media-url").fill(`https://media.example.test/${path}`);
    await page
      .getByRole("button", { name: "Check download", exact: true })
      .click();
  };
  await check("slow.mp4");
  await page.getByRole("button", { name: "Cancel transfer" }).waitFor();
  assert.ok(await mp4.isDisabled());
  assert.ok(await mp3.isDisabled());
  release();
  await page.waitForFunction(
    () => !document.querySelector(".download-action").disabled,
  );
  assert.ok(await mp4.isEnabled());
  assert.ok(await mp3.isDisabled());
  for (const [format, control] of [
    ["mp4", mp4],
    ["mp3", mp3],
  ]) {
    if (format === "mp3") {
      await page
        .locator("#media-url")
        .fill("https://media.example.test/file.mp3");
      assert.ok(await mp4.isDisabled());
      assert.ok(await mp3.isDisabled());
      await page
        .getByRole("button", { name: "Check download", exact: true })
        .click();
      await page.waitForFunction(
        () => !document.querySelectorAll(".download-action")[1].disabled,
      );
    }
    assert.ok(await control.isEnabled());
    assert.ok(await (format === "mp4" ? mp3 : mp4).isDisabled());
    const event = page.waitForEvent("download");
    await control.click();
    const downloaded = await event;
    const saved = join(directory, format);
    await downloaded.saveAs(saved);
    assert.equal(
      createHash("sha256")
        .update(await readFile(saved))
        .digest("hex"),
      createHash("sha256").update(files[format]).digest("hex"),
    );
  }
  console.log(
    "PASS download actions disabled until receipt+validation; only source format enables; real saved bytes match",
  );
  await page.locator("#media-url").fill("invalid");
  assert.ok(await mp4.isDisabled());
  assert.ok(await mp3.isDisabled());
  await page
    .getByRole("button", { name: "Check download", exact: true })
    .click();
  await page.locator("#media-error").waitFor();
  assert.ok(await mp4.isDisabled());
  assert.ok(await mp3.isDisabled());
  for (const path of ["corrupt.mp3", "missing.mp4"]) {
    await check(path);
    await page.locator("#media-error").waitFor();
    assert.ok(await mp4.isDisabled());
    assert.ok(await mp3.isDisabled());
  }
  await check("slow.mp4");
  await page.getByRole("button", { name: "Cancel transfer" }).waitFor();
  await page.getByRole("button", { name: "Cancel transfer" }).click();
  await page.getByText("Transfer cancelled. No file was saved.").waitFor();
  assert.ok(await mp4.isDisabled());
  assert.ok(await mp3.isDisabled());
  release();
  console.log(
    "PASS invalid, corrupt, unavailable and cancelled media cannot enable downloading",
  );
  for (const url of [
    "https://www.tiktok.com/@creator/video/6718335390845095173",
    "https://vm.tiktok.com/ABC123/",
    "https://www.instagram.com/reel/ABC123/",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
  ]) {
    await page.locator("#media-url").fill(url);
    await page.locator("#unsupported-link").waitFor();
    assert.match(
      await page.locator("#unsupported-link").innerText(),
      /downloads are unsupported/,
    );
    assert.equal(await page.locator(".download-action").count(), 0);
    assert.equal(await page.locator("iframe").count(), 0);
    assert.equal(await page.locator('script[src*="instagram"]').count(), 0);
  }
  assert.equal(providerRequests, 0);
  console.log(
    "PASS social links show no download actions, iframe/script embeds or provider requests",
  );
  await page.locator("#media-url").fill("");
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth),
      width,
    );
  }
  await page.addScriptTag({ path: "node_modules/axe-core/axe.min.js" });
  const violations = await page.evaluate(async () => {
    const result = await axe.run(document, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"],
      },
    });
    return result.violations.map((item) => ({
      id: item.id,
      impact: item.impact,
    }));
  });
  assert.deepEqual(violations, []);
  await page.getByRole("tab", { name: "Upload a file" }).click();
  assert.equal(await page.locator(".download-action").count(), 0);
  await page
    .locator("#local-file")
    .setInputFiles("tests/fixtures/conversion.mp4");
  assert.ok(
    await page
      .getByRole("button", { name: "Convert to MP3", exact: true })
      .isEnabled(),
  );
  assert.equal(
    await page.getByRole("link", { name: "Download MP3", exact: true }).count(),
    0,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS responsive layout/accessibility and local conversion entry; no output download before conversion",
  );
} finally {
  await browser.close();
  await rm(directory, { recursive: true, force: true });
}
