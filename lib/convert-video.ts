import { validateMediaStructure } from "./media-structure.ts";
import {
  checkConversionInput,
  checkProbe,
  mp3Arguments,
  type Bitrate,
  type ConversionLimits,
} from "./conversion";
import type { FFmpeg } from "@ffmpeg/ffmpeg";

export async function convertVideo(
  file: File,
  bitrate: Bitrate,
  limits: ConversionLimits,
  signal: AbortSignal,
  update: (message: string, percent: number | null) => void,
): Promise<Blob> {
  checkConversionInput(file, bitrate, limits);
  if (typeof Worker === "undefined" || typeof WebAssembly === "undefined")
    throw new Error(
      "This browser cannot run local conversion. Try a current desktop browser.",
    );
  signal.throwIfAborted();
  let engine: FFmpeg | undefined;
  let timedOut = false;
  let rejectStop: (reason: Error) => void = () => {};
  const stopped = new Promise<never>((_, reject) => {
    rejectStop = reject;
  });
  const stop = () => {
    engine?.terminate();
    rejectStop(new DOMException("Conversion cancelled.", "AbortError"));
  };
  signal.addEventListener("abort", stop, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    engine?.terminate();
    rejectStop(
      new Error(
        "Conversion exceeded the three-minute processing limit. Try a smaller video.",
      ),
    );
  }, 180_000);
  try {
    return await Promise.race([
      stopped,
      (async () => {
        update("Loading local conversion engine (~31 MB on first use)…", null);
        const { FFmpeg, FFFSType } = await import("@ffmpeg/ffmpeg");
        signal.throwIfAborted();
        if (timedOut) throw new Error("Conversion timed out.");
        engine = new FFmpeg();
        const base = new URL("/ffmpeg/", window.location.origin).href;
        await engine.load({
          classWorkerURL: `${base}worker.js`,
          coreURL: `${base}ffmpeg-core.js`,
          wasmURL: `${base}ffmpeg-core.wasm`,
        });
        signal.throwIfAborted();
        update("Reading local video…", null);
        // WORKERFS reads Blob ranges on demand instead of copying the entire
        // input into JS and then again into the WASM MEMFS heap.
        await engine.createDir("/input");
        await engine.mount(
          FFFSType.WORKERFS,
          { blobs: [{ name: "source", data: file }] },
          "/input",
        );
        signal.throwIfAborted();
        update("Checking duration and audio track…", null);
        const probeCode = await engine.ffprobe(
          [
            "-v",
            "error",
            "-protocol_whitelist",
            "file,pipe",
            "-show_entries",
            "format=duration:stream=codec_type",
            "-of",
            "json",
            "-o",
            "probe.json",
            "/input/source",
          ],
          20_000,
        );
        // This core reports -1 on successful ffprobe; require valid JSON output below.
        if (probeCode !== 0 && probeCode !== -1)
          throw new Error(
            "Cannot read this video. It may be damaged or use an unsupported codec.",
          );
        let probe: string;
        try {
          probe = String(await engine.readFile("probe.json", "utf8"));
          JSON.parse(probe);
        } catch {
          throw new Error(
            "Cannot read this video. It may be damaged or use an unsupported codec.",
          );
        }
        const duration = checkProbe(probe, limits);
        engine.on("progress", ({ time }) =>
          update(
            "Converting audio locally…",
            Math.max(0, Math.min(99, (time / 1_000_000 / duration) * 100)),
          ),
        );
        update("Converting audio locally…", 0);
        const code = await engine.exec(
          mp3Arguments(bitrate, limits.seconds),
          150_000,
        );
        signal.throwIfAborted();
        if (code !== 0)
          throw new Error(
            "Conversion failed. The codec may be unsupported or browser memory may be exhausted. Try a smaller MP4 video.",
          );
        const output = await engine.readFile("output.mp3");
        if (
          typeof output === "string" ||
          output.length < 4 ||
          output.length > 13 * 1024 * 1024
        )
          throw new Error(
            "Conversion produced an invalid or oversized output.",
          );
        const blob = new Blob([output as Uint8Array<ArrayBuffer>], {
          type: "audio/mpeg",
        });
        await validateMediaStructure(blob, "audio/mpeg", signal);
        update("MP3 ready.", 100);
        return blob;
      })(),
    ]);
  } catch (error) {
    if (signal.aborted)
      throw new DOMException("Conversion cancelled.", "AbortError");
    if (timedOut) throw new Error("Conversion timed out. Try a smaller video.");
    throw error instanceof Error
      ? error
      : new Error(
          "Conversion engine failed. Try a smaller video in a current desktop browser.",
        );
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", stop);
    // One isolated engine per job: terminating frees its entire WASM filesystem and heap.
    engine?.terminate();
  }
}
