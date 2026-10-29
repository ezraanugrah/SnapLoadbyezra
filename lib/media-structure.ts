// Conservative container checks, not a decoder, authenticity check, or malware scanner.
// Metadata and iteration budgets are independent of downloaded payload size.
const MAX_METADATA = 2 * 1024 * 1024;
const MAX_BOXES = 10_000;
const MAX_SAMPLES = 100_000;
const corrupt = () =>
  new Error("Corrupt or incomplete media: the MP3/MP4 structure is invalid.");
const unsupported = () =>
  new Error(
    "Unsupported media structure: use an ordinary, unencrypted MP4 or MPEG Layer III MP3.",
  );
const text = (bytes: Uint8Array, offset: number, count: number) =>
  String.fromCharCode(...bytes.subarray(offset, offset + count));
const view = (bytes: Uint8Array) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

async function validateMp3(blob: Blob, signal?: AbortSignal) {
  let offset = 0;
  let end = blob.size;
  let window = new Uint8Array(0);
  let windowStart = -1;
  async function read(at: number, count: number): Promise<Uint8Array> {
    signal?.throwIfAborted();
    if (at < 0 || at + count > end) throw corrupt();
    if (at < windowStart || at + count > windowStart + window.length) {
      window = new Uint8Array(
        await blob.slice(at, Math.min(end, at + 64 * 1024)).arrayBuffer(),
      );
      windowStart = at;
    }
    return window.subarray(at - windowStart, at - windowStart + count);
  }
  if (blob.size < 8) throw corrupt();
  const head = await read(0, Math.min(10, end));
  if (text(head, 0, 3) === "ID3") {
    if (
      head.length < 10 ||
      ![2, 3, 4].includes(head[3]) ||
      head[4] === 255 ||
      head.subarray(6, 10).some((value) => value > 127)
    )
      throw corrupt();
    const size = head
      .subarray(6, 10)
      .reduce((sum, value) => sum * 128 + value, 0);
    if (size > MAX_METADATA) throw unsupported();
    const footer = head[3] === 4 && (head[5] & 16) !== 0;
    offset = 10 + size + (footer ? 10 : 0);
    if (offset >= end) throw corrupt();
    if (footer && text(await read(offset - 10, 3), 0, 3) !== "3DI")
      throw corrupt();
  }
  if (end >= 128 && text(await read(end - 128, 3), 0, 3) === "TAG") end -= 128;
  let frames = 0;
  let rateVersion = "";
  while (offset < end) {
    const h = await read(offset, 4);
    const version = (h[1] >> 3) & 3;
    const layer = (h[1] >> 1) & 3;
    const bitrateIndex = h[2] >> 4;
    const rateIndex = (h[2] >> 2) & 3;
    if (
      h[0] !== 255 ||
      (h[1] & 224) !== 224 ||
      version === 1 ||
      layer !== 1 ||
      bitrateIndex === 0 ||
      bitrateIndex === 15 ||
      rateIndex === 3 ||
      (h[3] & 3) === 2
    )
      throw corrupt();
    const rate =
      [44100, 48000, 32000][rateIndex] /
      (version === 3 ? 1 : version === 2 ? 2 : 4);
    const kbps = (
      version === 3
        ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
        : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
    )[bitrateIndex];
    const frameLength =
      Math.floor(((version === 3 ? 144000 : 72000) * kbps) / rate) +
      ((h[2] >> 1) & 1);
    const identity = `${version}/${rate}`;
    if (frames && identity !== rateVersion) throw corrupt();
    rateVersion = identity;
    if (offset + frameLength > end || ++frames > MAX_SAMPLES) throw corrupt();
    offset += frameLength;
  }
  if (frames < 2 || offset !== end) throw corrupt();
}

type Box = { type: string; start: number; data: number; end: number };
async function validateMp4(blob: Blob, signal?: AbortSignal) {
  let boxes = 0;
  let moov: Uint8Array | undefined;
  let ftyp = false;
  const media: { start: number; end: number }[] = [];
  function header(bytes: Uint8Array, start: number, parentEnd: number): Box {
    if (++boxes > MAX_BOXES) throw unsupported();
    if (bytes.length < 8) throw corrupt();
    const data = view(bytes);
    let size = data.getUint32(0);
    let length = 8;
    if (size === 1) {
      if (bytes.length < 16) throw corrupt();
      const high = data.getUint32(8);
      const low = data.getUint32(12);
      size = high * 4294967296 + low;
      length = 16;
    } else if (size === 0) size = parentEnd - start;
    if (
      !Number.isSafeInteger(size) ||
      size < length ||
      start + size > parentEnd
    )
      throw corrupt();
    return {
      type: text(bytes, 4, 4),
      start,
      data: start + length,
      end: start + size,
    };
  }
  for (let offset = 0; offset < blob.size;) {
    signal?.throwIfAborted();
    const b = header(
      new Uint8Array(await blob.slice(offset, offset + 16).arrayBuffer()),
      offset,
      blob.size,
    );
    if (b.type === "moof") throw unsupported();
    if (b.type === "ftyp") {
      if (ftyp || b.end - b.data < 8 || (b.end - b.data) % 4 !== 0)
        throw corrupt();
      ftyp = true;
    }
    if (b.type === "mdat" && b.end > b.data)
      media.push({ start: b.data, end: b.end });
    if (b.type === "moov") {
      if (moov) throw corrupt();
      if (b.end - b.start > MAX_METADATA) throw unsupported();
      moov = new Uint8Array(await blob.slice(b.data, b.end).arrayBuffer());
    }
    offset = b.end;
  }
  if (!ftyp || !moov || !media.length) throw corrupt();
  const metadata = moov;
  const data = view(metadata);
  function children(start: number, end: number): Box[] {
    const result: Box[] = [];
    for (let offset = start; offset < end;) {
      const b = header(
        metadata.subarray(offset, Math.min(end, offset + 16)),
        offset,
        end,
      );
      result.push(b);
      offset = b.end;
    }
    return result;
  }
  function required(list: Box[], type: string): Box {
    const matches = list.filter((box) => box.type === type);
    if (matches.length !== 1) throw corrupt();
    return matches[0];
  }
  function u32(at: number, end: number): number {
    if (at + 4 > end) throw corrupt();
    return data.getUint32(at);
  }
  const top = children(0, metadata.length);
  const movie = required(top, "mvhd");
  if (movie.end - movie.data < 20) throw corrupt();
  const tracks = top.filter((box) => box.type === "trak");
  if (!tracks.length || tracks.length > 16) throw unsupported();
  let sampleBudget = 0;
  let videoTracks = 0;
  for (const track of tracks) {
    signal?.throwIfAborted();
    const mdia = required(children(track.data, track.end), "mdia");
    const mdiaChildren = children(mdia.data, mdia.end);
    const handler = required(mdiaChildren, "hdlr");
    if (handler.end - handler.data < 12) throw corrupt();
    const handlerType = text(metadata, handler.data + 8, 4);
    if (handlerType === "vide") videoTracks++;
    const minf = required(mdiaChildren, "minf");
    const stbl = required(children(minf.data, minf.end), "stbl");
    const tables = children(stbl.data, stbl.end);
    const stsd = required(tables, "stsd");
    const descriptions = u32(stsd.data + 4, stsd.end);
    const entries = children(stsd.data + 8, stsd.end);
    if (descriptions !== entries.length || descriptions === 0) throw corrupt();
    if (entries.some((box) => ["encv", "enca"].includes(box.type)))
      throw unsupported();
    const stsz = required(tables, "stsz");
    const fixed = u32(stsz.data + 4, stsz.end);
    const samples = u32(stsz.data + 8, stsz.end);
    if (!samples || (sampleBudget += samples) > MAX_SAMPLES)
      throw unsupported();
    if (stsz.data + 12 + (fixed ? 0 : samples * 4) !== stsz.end)
      throw corrupt();
    const stts = required(tables, "stts");
    const times = u32(stts.data + 4, stts.end);
    if (!times || times > MAX_SAMPLES || stts.data + 8 + times * 8 !== stts.end)
      throw corrupt();
    let timedSamples = 0;
    for (let i = 0; i < times; i++) {
      timedSamples += u32(stts.data + 8 + i * 8, stts.end);
      if (!u32(stts.data + 12 + i * 8, stts.end)) throw corrupt();
    }
    if (timedSamples !== samples) throw corrupt();
    const offsets = tables.filter(
      (box) => box.type === "stco" || box.type === "co64",
    );
    if (offsets.length !== 1) throw corrupt();
    const offsetsBox = offsets[0];
    const chunks = u32(offsetsBox.data + 4, offsetsBox.end);
    const stride = offsetsBox.type === "co64" ? 8 : 4;
    if (
      !chunks ||
      chunks > MAX_SAMPLES ||
      offsetsBox.data + 8 + chunks * stride !== offsetsBox.end
    )
      throw corrupt();
    const stsc = required(tables, "stsc");
    const mappings = u32(stsc.data + 4, stsc.end);
    if (
      !mappings ||
      mappings > chunks ||
      stsc.data + 8 + mappings * 12 !== stsc.end
    )
      throw corrupt();
    let map = 0;
    let sample = 0;
    let lastFirst = 0;
    for (let i = 0; i < mappings; i++) {
      const first = u32(stsc.data + 8 + i * 12, stsc.end);
      const count = u32(stsc.data + 12 + i * 12, stsc.end);
      const description = u32(stsc.data + 16 + i * 12, stsc.end);
      if (
        first <= lastFirst ||
        first > chunks ||
        (i === 0 && first !== 1) ||
        !count ||
        description < 1 ||
        description > descriptions
      )
        throw corrupt();
      lastFirst = first;
    }
    for (let chunk = 1; chunk <= chunks; chunk++) {
      if (
        map + 1 < mappings &&
        u32(stsc.data + 8 + (map + 1) * 12, stsc.end) === chunk
      )
        map++;
      const count = u32(stsc.data + 12 + map * 12, stsc.end);
      if (sample + count > samples) throw corrupt();
      let length = 0;
      for (let i = 0; i < count; i++) {
        const size = fixed || u32(stsz.data + 12 + sample * 4, stsz.end);
        if (!size) throw corrupt();
        length += size;
        sample++;
      }
      const at = offsetsBox.data + 8 + (chunk - 1) * stride;
      const start =
        stride === 8
          ? u32(at, offsetsBox.end) * 4294967296 + u32(at + 4, offsetsBox.end)
          : u32(at, offsetsBox.end);
      let low = 0,
        high = media.length;
      while (low < high) {
        const mid = (low + high) >>> 1;
        if (media[mid].start <= start) low = mid + 1;
        else high = mid;
      }
      const range = media[low - 1];
      if (
        !Number.isSafeInteger(start) ||
        !range ||
        start < range.start ||
        start + length > range.end
      )
        throw corrupt();
    }
    if (sample !== samples) throw corrupt();
  }
  if (!videoTracks) throw unsupported();
}

export async function validateMediaStructure(
  blob: Blob,
  mime: string,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  if (mime === "audio/mpeg") await validateMp3(blob, signal);
  else if (mime === "video/mp4") await validateMp4(blob, signal);
  else throw unsupported();
  signal?.throwIfAborted();
}
