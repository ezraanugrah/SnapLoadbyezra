const MB = 1024 * 1024;
export const DESKTOP_DOWNLOAD_BYTES = 32 * MB;
export const CONSERVATIVE_DOWNLOAD_BYTES = 8 * MB;
export type DeviceHints = {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
  deviceMemory?: number;
};
export function isConservativeDevice(device: DeviceHints): boolean {
  return (
    /Android|iPhone|iPad|iPod/i.test(device.userAgent ?? "") ||
    ((device.maxTouchPoints ?? 0) > 1 && /Mac/.test(device.platform ?? "")) ||
    device.deviceMemory === undefined ||
    device.deviceMemory <= 4
  );
}
export function currentDeviceHints(): DeviceHints {
  return typeof navigator === "undefined"
    ? {}
    : (navigator as Navigator & { deviceMemory?: number });
}
export function downloadByteLimit(
  device: DeviceHints = currentDeviceHints(),
): number {
  return isConservativeDevice(device)
    ? CONSERVATIVE_DOWNLOAD_BYTES
    : DESKTOP_DOWNLOAD_BYTES;
}
