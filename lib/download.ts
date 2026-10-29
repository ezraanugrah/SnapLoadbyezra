import { normalizeHostname } from "./media.ts";
import { validateMediaStructure } from "./media-structure.ts";
import { downloadByteLimit, DESKTOP_DOWNLOAD_BYTES } from "./device-limits.ts";
export const MAX_DOWNLOAD_BYTES = DESKTOP_DOWNLOAD_BYTES;
export type DownloadProgress = { received: number; total: number | null };
export type DownloadResult = {
  blob: Blob;
  name: string;
  type: string;
  size: number;
};

// No server proxy: every request remains subject to browser CORS policy.
export function validateDirectUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Enter a complete HTTPS media URL.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port)
    throw new Error("Use an HTTPS link without credentials or a custom port.");
  const host = normalizeHostname(url.hostname);
  url.hostname = host;
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "[::1]" ||
    host.includes(":") ||
    /^\d+(\.\d+){3}$/.test(host) ||
    !host.includes(".")
  )
    throw new Error("Use a public media hostname, not a local address.");
  if (
    /(^|\.)(instagram\.com|tiktok\.com|youtube\.com|youtube-nocookie\.com|youtu\.be|googlevideo\.com|cdninstagram\.com|tiktokcdn\.com|fbcdn\.net)$/.test(
      host,
    )
  )
    throw new Error(
      "Social platform downloads are unsupported. Use the platform’s official options.",
    );
  return url;
}

// CORS hides Content-Encoding unless explicitly exposed. Never compare encoded
// Content-Length with browser-decoded bytes unless identity encoding is observable.
export function trustedTransferLength(response: Response): number | null {
  const raw = response.headers.get("content-length");
  const length = raw && /^\d+$/.test(raw) ? Number(raw) : null;
  if (!Number.isSafeInteger(length)) return null;
  const encoding = response.headers
    .get("content-encoding")
    ?.trim()
    .toLowerCase();
  if (encoding === "identity") return length;
  // On same-origin basic responses all encoding headers are visible.
  if (response.type === "basic" && !encoding) return length;
  return null;
}

export async function fetchMedia(
  value: string,
  options: {
    signal: AbortSignal;
    onProgress?: (progress: DownloadProgress) => void;
    fetcher?: typeof fetch;
    maxBytes?: number;
  },
): Promise<DownloadResult> {
  const url = validateDirectUrl(value);
  const maxBytes = Math.min(
    options.maxBytes ?? downloadByteLimit(),
    MAX_DOWNLOAD_BYTES,
  );
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
    throw new Error("Invalid download limit.");
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  options.signal.throwIfAborted();
  options.signal.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 120_000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await (options.fetcher ?? fetch)(url.href, {
      signal: controller.signal,
      mode: "cors",
      credentials: "omit",
      redirect: "manual",
      referrerPolicy: "no-referrer",
      cache: "no-store",
    });
    if (
      response.type === "opaqueredirect" ||
      (response.status >= 300 && response.status < 400)
    )
      throw new Error(
        "Redirected links are unsupported. Paste the final permitted direct media URL.",
      );
    if (response.type === "opaque")
      throw new Error("The source does not allow browser access (CORS).");
    if (response.status !== 200)
      throw new Error(
        `The source did not provide a complete file (HTTP ${response.status}).`,
      );
    const mime =
      response.headers
        .get("content-type")
        ?.split(";")[0]
        .trim()
        .toLowerCase() ?? "";
    if (!["video/mp4", "audio/mpeg"].includes(mime))
      throw new Error(
        "Unsupported media type. The source must serve video/mp4 or audio/mpeg.",
      );
    const total = trustedTransferLength(response);
    const limitError = () =>
      new Error(
        `The file exceeds this device’s ${maxBytes / 1024 / 1024} MB download limit.`,
      );
    if (total !== null && total > maxBytes) throw limitError();
    if (!response.body)
      throw new Error("The source returned no readable file.");
    reader = response.body.getReader();
    const parts: Blob[] = [];
    const buffer = new Uint8Array(64 * 1024);
    let buffered = 0;
    let received = 0;
    options.onProgress?.({ received, total });
    while (true) {
      controller.signal.throwIfAborted();
      const { done, value: chunk } = await reader.read();
      if (done) break;
      received += chunk.byteLength;
      if (received > maxBytes) throw limitError();
      // Fixed-size staging prevents tiny network chunks from creating an
      // unbounded object list; Blob snapshots allow this buffer to be reused.
      for (let offset = 0; offset < chunk.length;) {
        const count = Math.min(buffer.length - buffered, chunk.length - offset);
        buffer.set(chunk.subarray(offset, offset + count), buffered);
        offset += count;
        buffered += count;
        if (buffered === buffer.length) {
          parts.push(new Blob([buffer]));
          buffered = 0;
        }
      }
      options.onProgress?.({ received, total });
    }
    controller.signal.throwIfAborted();
    if (!received) throw new Error("The source returned an empty file.");
    if (total !== null && total !== received)
      throw new Error("The transfer was incomplete. Please try again.");
    if (buffered) parts.push(new Blob([buffer.subarray(0, buffered)]));
    const blob = new Blob(parts, { type: mime });
    parts.length = 0;
    await validateMediaStructure(blob, mime, controller.signal);
    const extension = mime === "video/mp4" ? "mp4" : "mp3";
    const stem =
      url.pathname
        .split("/")
        .pop()
        ?.replace(/\.[^.]*$/, "")
        .replace(/[^a-zA-Z0-9_-]/g, "_")
        .slice(0, 80) || "snapload-media";
    return { blob, name: `${stem}.${extension}`, type: mime, size: received };
  } catch (error) {
    if (timedOut)
      throw new Error(
        "The transfer timed out after two minutes. Try a smaller file.",
      );
    if (options.signal.aborted)
      throw new DOMException("Download cancelled.", "AbortError");
    if (error instanceof TypeError)
      throw new Error(
        "Could not access the file. The source may block CORS, be offline, or have a network/TLS error. No bypass is attempted.",
      );
    throw error;
  } finally {
    await reader?.cancel().catch(() => {});
    controller.abort();
    clearTimeout(timeout);
    options.signal.removeEventListener("abort", abort);
  }
}
