import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkConversionInput,
  checkProbe,
  mp3Arguments,
  DESKTOP_LIMITS,
  MOBILE_LIMITS,
} from "../lib/conversion.ts";
test("enforces file, bitrate, duration and audio limits", () => {
  for (const bitrate of [128, 192, 320])
    assert.doesNotThrow(() =>
      checkConversionInput(
        { size: 1024, type: "video/mp4" },
        bitrate,
        DESKTOP_LIMITS,
      ),
    );
  for (const file of [
    { size: 0, type: "video/mp4" },
    { size: DESKTOP_LIMITS.bytes + 1, type: "video/mp4" },
    { size: 10, type: "audio/mpeg" },
  ])
    assert.throws(() => checkConversionInput(file, 192, DESKTOP_LIMITS));
  assert.throws(() =>
    checkConversionInput({ size: 10, type: "video/mp4" }, 64, DESKTOP_LIMITS),
  );
  assert.throws(() =>
    checkConversionInput(
      { size: MOBILE_LIMITS.bytes + 1, type: "video/mp4" },
      192,
      MOBILE_LIMITS,
    ),
  );
  const probe = (duration) =>
    JSON.stringify({
      format: { duration },
      streams: [{ codec_type: "audio" }],
    });
  assert.equal(checkProbe(probe(300), DESKTOP_LIMITS), 300);
  for (const duration of [301, 0, -1, "NaN", null])
    assert.throws(() => checkProbe(probe(duration), DESKTOP_LIMITS));
  assert.throws(() => checkProbe(probe(121), MOBILE_LIMITS));
  assert.throws(
    () =>
      checkProbe(
        JSON.stringify({ format: { duration: 1 }, streams: [] }),
        DESKTOP_LIMITS,
      ),
    /audio/,
  );
  assert.throws(() => checkProbe("broken", DESKTOP_LIMITS));
});
test("encoding commands constrain output and never fetch external input", () => {
  for (const bitrate of [128, 192, 320]) {
    const args = mp3Arguments(bitrate, 300);
    assert.equal(args[args.indexOf("-b:a") + 1], `${bitrate}k`);
    assert.equal(args[args.indexOf("-t") + 1], "300");
    assert.equal(args[args.indexOf("-protocol_whitelist") + 1], "file,pipe");
    assert.ok(args.includes("libmp3lame"));
  }
});
