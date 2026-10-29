export type Bitrate = 128 | 192 | 320;
export type ConversionLimits = { bytes: number; seconds: number };
export const DESKTOP_LIMITS: ConversionLimits = {
  bytes: 24 * 1024 * 1024,
  seconds: 300,
};
export const MOBILE_LIMITS: ConversionLimits = {
  bytes: 8 * 1024 * 1024,
  seconds: 120,
};
export function checkConversionInput(
  file: { size: number; type: string },
  bitrate: number,
  limits: ConversionLimits,
) {
  if (![128, 192, 320].includes(bitrate))
    throw new Error("Choose 128, 192, or 320 kbps.");
  if (!file.type.startsWith("video/"))
    throw new Error("Choose a local video to convert.");
  if (!file.size || file.size > limits.bytes)
    throw new Error(
      `Choose a non-empty video under ${limits.bytes / 1024 / 1024} MB.`,
    );
}
export function checkProbe(value: string, limits: ConversionLimits): number {
  const info = JSON.parse(value);
  const duration = Number(info.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0 || duration > limits.seconds)
    throw new Error(
      `Video duration must be known and no longer than ${limits.seconds / 60} minutes.`,
    );
  if (
    !info.streams?.some(
      (stream: { codec_type: string }) => stream.codec_type === "audio",
    )
  )
    throw new Error("This video has no supported audio track.");
  return duration;
}
export function mp3Arguments(bitrate: Bitrate, maxSeconds: number): string[] {
  return [
    "-nostdin",
    "-protocol_whitelist",
    "file,pipe",
    "-i",
    "/input/source",
    "-map",
    "0:a:0",
    "-vn",
    "-t",
    String(maxSeconds),
    "-c:a",
    "libmp3lame",
    "-b:a",
    `${bitrate}k`,
    "-ar",
    "44100",
    "-ac",
    "2",
    "-map_metadata",
    "-1",
    "-y",
    "output.mp3",
  ];
}
