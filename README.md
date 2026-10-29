# SnapLoad

SnapLoadbyezra uses Next.js App Router, TypeScript, Tailwind CSS, and Lucide React.

## Development and checks

```sh
npm install
npm run dev
npm run lint
npm run typecheck
npm test
npm run build
```

Tests require Node.js 22.18+ (native TypeScript stripping) and permission to bind a loopback port for the integration fixture server. No packages or external media services are needed for tests. Checked-in tiny fixtures were generated with FFmpeg (yellow video and a synthesized tone).

## Direct downloads

Paste a permitted public HTTPS URL serving `video/mp4` or `audio/mpeg`. The browser fetches the entire original file, checks its MIME and bounded MP4/MP3 structure, and then offers a local blob preview and download. The original bytes are saved without conversion. Structural checks are not full codec validation or malware scanning. Browser codec support determines playback.

Requests omit credentials and referrer, use CORS, and reject redirects, partial responses, unsupported content, empty files, known incomplete transfers, and files above device-aware limits (32 MB desktop; 8 MB on mobile, low-memory, or unknown-memory devices). Local/IP-address URLs are rejected; no server proxy, scraping, authentication, API keys, or download API exists. Browser security policies remain in force. Hostname checks do not resolve DNS or establish ownership/permission; users must have permission to save the media.

Progress measures bytes received, with a total only when identity transfer encoding can be established. Transfers may be cancelled and time out after two minutes. Files are sealed into immutable Blob batches through a reusable 64 KB buffer. Files remain browser-managed; total process memory is not hard-capped. Saving uses the browser's download UI; save completion and filesystem progress cannot be observed. No automatic retry or resume.

CORS must be enabled by the source. Browser errors cannot reliably distinguish CORS from TLS/network failures, so the UI reports that limitation without bypassing it. Signed URLs may work if no credentials, redirects, or prohibited hostnames are required. A redirected source must provide its final permitted URL directly.

Instagram, TikTok, and YouTube detection remains available, but platform downloads are explicitly unsupported. Known platform media hostnames are also rejected. Local video uploads can be converted to MP3 as described below; local audio uploads remain previews.

## Integrity verification

Integration tests transfer real generated MP4/MP3 fixture bytes over a loopback HTTP server using a test-only transport adapter. They compare received blob SHA-256 hashes, sizes, and progress against originals. Production only accepts public HTTPS URLs; there is no production loopback exception. These tests do not emulate browser CORS enforcement or prove that third-party sources permit downloads. FFmpeg can independently decode both checked-in fixtures:

```sh
ffmpeg -v error -i tests/fixtures/sample.mp4 -f null -
ffmpeg -v error -i tests/fixtures/sample.mp3 -f null -
```

## Local video-to-MP3 conversion (Phase 3)

Local videos can be converted to MP3 at 128, 192, or 320 kbps. FFmpeg WASM runs single-threaded in an isolated worker, without SharedArrayBuffer or cross-origin isolation requirements. The core (~31 MB) is served from this app; media is never uploaded. `predev` and `prebuild` copy installed package assets into ignored `public/ffmpeg/` so Vercel can serve them as static files.

Conversion limits: 24 MB and 5 minutes on desktop; 8 MB and 2 minutes on mobile, devices reporting <=4 GB memory, or devices with unknown memory. Every job has a 3-minute wall-clock deadline, a 20-second probe deadline, and a 150-second encode deadline. Input metadata must contain a finite duration and an audio stream. Encoding is duration-capped, outputs stereo 44.1 kHz MP3, and rejects output over 13 MB. Size/duration limits reduce risk but cannot guarantee a fixed browser heap ceiling. WASM memory can be hundreds of MB; mobile Safari and low-memory devices may fail or close the tab. Try a shorter file in a current desktop browser. Reported progress is approximate; loading/probing is indeterminate.

Each job terminates its worker on success, error, timeout, cancellation, tab switch, preview close, or component unmount. This releases the WASM filesystem and memory; converted preview blob URLs are revoked on replacement/unmount. Cancelling cannot undo an MP3 already saved through the browser. Unsupported/damaged codecs, missing audio, and unknown or excessive durations produce errors. Higher bitrates cannot improve the source audio quality.

`npm run test:browser` tests actual WASM conversion and browser downloads using installed Chrome, then validates output with locally installed FFmpeg. Run against `npm start` (or set `SNAPLOAD_TEST_URL`). Chrome and FFmpeg paths currently target this macOS workspace and can be edited for other test machines. Unit/download regressions remain in `npm test`.

FFmpeg packages retain their upstream licensing: `@ffmpeg/ffmpeg` (MIT) and `@ffmpeg/core` (GPL-2.0-or-later), with bundled library licenses. Source/build information: https://github.com/ffmpegwasm/ffmpeg.wasm and https://github.com/ffmpegwasm/ffmpeg.wasm/tree/main/build/ffmpeg . No deployment has been performed.

## Phase 4.1 security controls

Hostnames are lowercased and stripped of trailing dots before platform/local-host restrictions and before fetching. DNS resolution is still the browser’s responsibility: this does not verify ownership, permissions, or public IP resolution behind arbitrary aliases. There is no server fetch proxy.

MP3 validation walks complete MPEG Layer III frame boundaries, checks frame lengths and sampling-rate consistency, and bounds ID3 metadata. MP4 validation bounds top-level boxes and metadata, requires a video track and essential sample tables, checks sample/chunk counts, and verifies sample ranges lie within media data. Budgets: 2 MB metadata, 10,000 boxes, 100,000 samples/frames, and 16 MP4 tracks. Fragmented/encrypted or unusually complex containers may be rejected as unsupported. These checks detect structural corruption and truncation; they do not decode every compressed frame or prove a file harmless.

Browser Fetch decodes compressed transfers. CORS can hide Content-Encoding, so Content-Length is not compared against decoded bytes unless identity encoding is observable (or the response is same-origin with visible encoding headers). Unknown-length transfers still enforce the decoded-byte device cap and structural validation; progress reports received bytes. Native network read failures are still errors.

Conversion mounts the selected Blob read-only using WORKERFS, avoiding a full main-thread input read and a duplicate input file in WASM memory. The engine terminates after each job. Downloads use a fixed 64 KB staging buffer instead of retaining every raw network chunk. Limits reduce resource use but cannot prevent all browser out-of-memory failures or vulnerabilities in media decoders. UI and worker/blob cleanup tests do not prove an exact process memory ceiling.

Next.js security headers cover all paths: CSP, X-Frame-Options DENY, nosniff, and no-referrer. CSP limits workers/media to this origin and local media Blobs, disables objects, base URLs, framing, and inline event attributes. HTTPS connections remain allowed for user-provided direct media under normal CORS rules. Static Next.js hydration needs inline scripts, so script-src retains unsafe-inline; production allows wasm-unsafe-eval but not general unsafe-eval. This is a compatible static-page policy, not a strict nonce-based CSP. Development additionally permits eval and WebSockets for Next.js tooling.

`npm run test:security` tests real browser CORS/gzip transfers, corrupt/unsupported inputs, exact 32 MB download integrity, 24 MB on-demand conversion, oversized mobile input, and CSP. It uses a temporary loopback HTTPS fixture server with test-only hostname mapping and a certificate exception, and requires OpenSSL, installed Chrome, and FFmpeg. `npm run test:browser` checks all three conversion bitrates, cancellation focus, workers, object URLs, and absence of CSP violations. Run both against a production `npm start` using SNAPLOAD_TEST_URL if needed. Unit stress tests additionally cover tiny chunks, streamed overflow, metadata/box budgets, and recovery. Physical mobile memory stress and Safari/Firefox execution remain unverified.

## Download-first interface

Paste a permitted direct MP4/MP3 URL and choose **Check download**. The complete file must be received and pass MIME/structural checks before **Download MP4** or **Download MP3** enables. Only the original source format is enabled: remote MP4 links do not offer MP3 conversion. Both actions are disabled for unverified, loading, failed, corrupt, or cancelled transfers. Editing the URL invalidates the previous ready file.

TikTok (including short links), Instagram Reels/posts, YouTube, and YouTube privacy-enhanced embed URLs are explicitly unsupported for downloading. They display an explanation without file-download controls. No provider preview, iframe, third-party embed script, or extraction request is made. CSP now uses frame-src 'none' and has no social-provider script permissions. Direct downloads, bounded structural validation, device limits, worker security, and other headers are unchanged.

Local video-to-MP3 conversion retains bitrate selection, progress, cancellation, preview playback, validated MP3 output, and real browser downloads. Local-file selection does not expose remote-download actions. Existing direct/local media playback remains available as supporting file information.

Verification: `npm test`, `npm run test:download-ui`, `npm run test:browser`, and `npm run test:security`. Run browser suites against a production `npm start` server; SNAPLOAD_TEST_URL selects a different local address. The UI suite checks disabled/ready/mismatched formats, state invalidation, failures/cancellation, unsupported social links without provider requests, responsive widths, accessibility, and saved-file hashes. The security suite tests real controlled HTTPS files, compression, corruption, browser saves/FFmpeg decoding, and limits; the conversion suite checks every bitrate and worker/blob cleanup. No credentials, keys, backend service, or social extractor are required.
