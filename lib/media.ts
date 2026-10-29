export function normalizeHostname(host: string): string {
  return host.toLowerCase().replace(/\.+$/, "");
}
export type Platform = "Instagram" | "TikTok" | "YouTube";
export function detectPlatform(value: string): Platform | null {
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol)) return null;
    const host = normalizeHostname(url.hostname);
    if (host === "instagram.com" || host.endsWith(".instagram.com"))
      return "Instagram";
    if (host === "tiktok.com" || host.endsWith(".tiktok.com")) return "TikTok";
    if (
      host === "youtu.be" ||
      host === "youtube.com" ||
      host === "youtube-nocookie.com" ||
      host.endsWith(".youtube-nocookie.com") ||
      host.endsWith(".youtube.com")
    )
      return "YouTube";
    return null;
  } catch {
    return null;
  }
}
export function validateUrl(value: string): string | null {
  if (!value.trim()) return "Paste a media link to get started.";
  try {
    const url = new URL(value.trim());
    if (!["https:", "http:"].includes(url.protocol))
      return "Use a valid http or https link.";
  } catch {
    return "That link looks incomplete. Include https:// and try again.";
  }
  if (!detectPlatform(value.trim()))
    return "Use an Instagram, TikTok, or YouTube link.";
  const parsed = new URL(value.trim());
  if (parsed.username || parsed.password || parsed.port)
    return "Use a media link without credentials or a custom port.";
  parsed.hostname = normalizeHostname(parsed.hostname);
  const path = parsed.pathname;
  const platform = detectPlatform(value.trim());
  let supported = false;
  if (platform === "Instagram")
    supported = /^\/(?:p|reel|reels|tv)\/[A-Za-z0-9_-]+\/?$/.test(path);
  if (platform === "TikTok")
    supported =
      /^\/@[^/]+\/video\/\d+\/?$/.test(path) ||
      (["vm.tiktok.com", "vt.tiktok.com"].includes(parsed.hostname) &&
        /^\/[A-Za-z0-9]+\/?$/.test(path)) ||
      /^\/t\/[A-Za-z0-9]+\/?$/.test(path);
  if (platform === "YouTube") {
    const id = "[A-Za-z0-9_-]{11}";
    supported =
      parsed.hostname === "youtu.be"
        ? new RegExp(`^/${id}/?$`).test(path)
        : (path === "/watch" &&
            new RegExp(`^${id}$`).test(parsed.searchParams.get("v") ?? "")) ||
          new RegExp(`^/(?:shorts|embed|live)/${id}/?$`).test(path);
  }
  return supported
    ? null
    : "Paste a direct post or video link. Homepages, profiles, and playlists aren’t supported.";
}

// Extension inference is only a preview hint when MIME metadata is absent.
export function inferMediaType(file: {
  name: string;
  type: string;
}): string | null {
  const type = file.type.toLowerCase();
  if (type.startsWith("video/") || type.startsWith("audio/")) return type;
  if (type && type !== "application/octet-stream") return null;
  const extension = file.name.split(".").pop()?.toLowerCase();
  const types: Record<string, string> = {
    mp4: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
    m4v: "video/x-m4v",
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    wav: "audio/wav",
    ogg: "audio/ogg",
    flac: "audio/flac",
  };
  return extension && Object.prototype.hasOwnProperty.call(types, extension)
    ? types[extension]
    : null;
}
