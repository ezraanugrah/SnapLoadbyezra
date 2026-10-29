"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  CircleAlert,
  Clipboard,
  FileVideo,
  Camera,
  Link2,
  LoaderCircle,
  Music2,
  Upload,
  X,
  Video,
} from "lucide-react";
import { detectPlatform, inferMediaType, type Platform } from "@/lib/media";
import { downloadByteLimit } from "@/lib/device-limits";
import { Converter } from "@/components/converter";
import { fetchMedia, type DownloadProgress } from "@/lib/download";
type Preview = {
  kind: "remote" | "local";
  name: string;
  url: string;
  type: string;
  size: number;
  file?: File;
};
const platformIcons = { Instagram: Camera, TikTok: Music2, YouTube: Video };
export function Downloader() {
  const [tab, setTab] = useState<"url" | "upload">("url");
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [notice, setNotice] = useState("");
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const controller = useRef<AbortController | null>(null);
  const request = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const urlInput = useRef<HTMLInputElement>(null);
  const uploadButton = useRef<HTMLButtonElement>(null);
  const tabButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const platform = detectPlatform(url.trim());
  function changeTab(next: "url" | "upload") {
    if (next === tab) return;
    reset();
    setTab(next);
  }
  function navigateTabs(event: React.KeyboardEvent, index: number) {
    let next: number;
    if (event.key === "ArrowRight") next = (index + 1) % 2;
    else if (event.key === "ArrowLeft") next = (index + 1) % 2;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = 1;
    else return;
    event.preventDefault();
    changeTab(next === 0 ? "url" : "upload");
    tabButtons.current[next]?.focus();
  }
  function closePreview() {
    reset();
    if (tab === "url") urlInput.current?.focus();
    else uploadButton.current?.focus();
  }
  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );
  useEffect(() => {
    if (preview) return () => URL.revokeObjectURL(preview.url);
  }, [preview]);
  function reset() {
    request.current++;
    controller.current?.abort();
    setLoading(false);
    setProgress(null);
    setError("");
    setPreview(null);
    setNotice("");
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    reset();
    if (platform) {
      setError(
        `${platform} links are unsupported for downloading. Use a permitted direct MP4/MP3 URL or select your authorized local video.`,
      );
      return;
    }
    const id = request.current;
    const operation = new AbortController();
    controller.current = operation;
    setLoading(true);
    try {
      const media = await fetchMedia(url, {
        signal: operation.signal,
        onProgress: (next) => {
          if (id === request.current) setProgress(next);
        },
      });
      if (id !== request.current) return;
      setPreview({
        kind: "remote",
        name: media.name,
        type: media.type,
        size: media.size,
        url: URL.createObjectURL(media.blob),
      });
      setNotice(
        "File received and container structure checked. Use the enabled download button above. Playback depends on your browser’s codec support.",
      );
    } catch (error) {
      if (id !== request.current) return;
      if (operation.signal.aborted)
        setNotice("Transfer cancelled. No file was saved.");
      else
        setError(
          error instanceof Error ? error.message : "Unable to load this file.",
        );
    } finally {
      if (id === request.current) {
        setLoading(false);
        setProgress(null);
      }
    }
  }
  function saveDownload(format: "MP4" | "MP3") {
    const mime = format === "MP4" ? "video/mp4" : "audio/mpeg";
    if (
      loading ||
      platform ||
      tab !== "url" ||
      !preview ||
      preview.kind !== "remote" ||
      preview.type !== mime
    )
      return;
    const link = document.createElement("a");
    link.href = preview.url;
    link.download = preview.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setNotice(
      "Save requested. Your browser controls the save location and completion.",
    );
  }
  function selectFile(file?: File) {
    reset();
    if (!file) return;
    const mediaType = inferMediaType(file);
    if (!mediaType) {
      setError(
        "Choose a video or audio file. Images and other files aren’t supported.",
      );
      return;
    }
    if (file.size > downloadByteLimit()) {
      setError(
        `Choose a file under this device’s ${downloadByteLimit() / 1024 / 1024} MB preview limit. Conversion has stricter limits.`,
      );
      return;
    }
    setPreview({
      kind: "local",
      file: new File([file], file.name, { type: mediaType }),
      name: file.name,
      url: URL.createObjectURL(file),
      type: mediaType,
      size: file.size,
    });
  }
  return (
    <div className="workspace" id="workspace">
      <div className="workspace-tabs" role="tablist" aria-label="Media source">
        <button
          ref={(element) => {
            tabButtons.current[0] = element;
          }}
          tabIndex={tab === "url" ? 0 : -1}
          onKeyDown={(event) => navigateTabs(event, 0)}
          id="url-tab"
          role="tab"
          aria-selected={tab === "url"}
          aria-controls="source-panel"
          className={tab === "url" ? "active" : ""}
          onClick={() => changeTab("url")}
        >
          <Link2 size={17} /> Paste a link
        </button>
        <button
          ref={(element) => {
            tabButtons.current[1] = element;
          }}
          tabIndex={tab === "upload" ? 0 : -1}
          onKeyDown={(event) => navigateTabs(event, 1)}
          id="upload-tab"
          role="tab"
          aria-selected={tab === "upload"}
          aria-controls="source-panel"
          className={tab === "upload" ? "active" : ""}
          onClick={() => changeTab("upload")}
        >
          <Upload size={17} /> Upload a file
        </button>
        <span className="demo-tag">DIRECT MEDIA</span>
      </div>
      <div
        className="workspace-body"
        id="source-panel"
        role="tabpanel"
        aria-labelledby={tab === "url" ? "url-tab" : "upload-tab"}
      >
        {tab === "url" ? (
          <form onSubmit={submit} noValidate>
            <label htmlFor="media-url">One link. Start here.</label>
            <div className={`input-row ${error ? "invalid" : ""}`}>
              <Link2 size={21} className="input-icon" />
              <input
                ref={urlInput}
                id="media-url"
                type="url"
                value={url}
                onChange={(e) => {
                  reset();
                  setUrl(e.target.value);
                }}
                placeholder="Paste a direct MP4 or MP3 URL…"
                aria-invalid={!!error}
                aria-describedby={
                  error
                    ? "media-error"
                    : platform
                      ? "unsupported-link"
                      : "link-help"
                }
              />
              <button
                className="paste-button"
                type="button"
                aria-label="Paste link from clipboard"
                onClick={async () => {
                  try {
                    const text = await navigator.clipboard.readText();
                    reset();
                    setUrl(text);
                  } catch {
                    setError(
                      "Clipboard access is unavailable. Paste your link into the field.",
                    );
                  }
                }}
              >
                <Clipboard size={18} />
              </button>
              <button
                className="primary-button"
                type="submit"
                disabled={loading || !!platform}
              >
                {loading ? (
                  <>
                    <LoaderCircle size={18} className="spin" /> Checking
                  </>
                ) : (
                  <>
                    Check download <ArrowRight size={18} />
                  </>
                )}
              </button>
            </div>
            <div className="supported" id="link-help">
              {platform ? (
                <span className="detected">
                  <Check size={14} /> {platform} · unsupported for downloads
                </span>
              ) : (
                <span>Social downloads unsupported:</span>
              )}
              <div>
                {(Object.keys(platformIcons) as Platform[]).map((name) => {
                  const Icon = platformIcons[name];
                  return (
                    <span
                      key={name}
                      className={platform === name ? "selected-platform" : ""}
                    >
                      <Icon size={15} />
                      {name}
                    </span>
                  );
                })}
              </div>
            </div>
          </form>
        ) : (
          <div>
            <label htmlFor="local-file">Bring your own media.</label>
            <input
              ref={fileInput}
              id="local-file"
              hidden
              type="file"
              accept="video/*,audio/*,.mp4,.webm,.mov,.m4v,.mp3,.m4a,.wav,.ogg,.flac"
              onChange={(e) => {
                selectFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <button
              ref={uploadButton}
              aria-describedby={error ? "media-error" : undefined}
              className="upload-area"
              onClick={() => fileInput.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                selectFile(e.dataTransfer.files[0]);
              }}
            >
              <Upload size={26} />
              <strong>Drop a file or click to browse</strong>
              <span>
                Video or audio · Up to 32 MB; 8 MB on constrained devices ·
                Stays on your device
              </span>
            </button>
          </div>
        )}
        {tab === "url" && platform ? (
          <p
            className="unsupported-message"
            id="unsupported-link"
            role="status"
          >
            {platform} downloads are unsupported. SnapLoad cannot extract files
            from social links. Use the platform’s permitted download options or
            bring your authorized original file.
          </p>
        ) : tab === "url" ? (
          <div className="download-section">
            <div
              className="download-actions"
              role="group"
              aria-label="Verified file downloads"
            >
              {(["MP4", "MP3"] as const).map((format) => {
                const mime = format === "MP4" ? "video/mp4" : "audio/mpeg";
                const available =
                  !loading &&
                  preview?.kind === "remote" &&
                  preview.type === mime;
                return (
                  <button
                    key={format}
                    className="download-action"
                    disabled={!available}
                    aria-describedby="download-help"
                    onClick={() => saveDownload(format)}
                  >
                    <ArrowDownToLine size={19} /> Download {format}
                  </button>
                );
              })}
            </div>
            <p className="download-help" id="download-help" role="status">
              {loading
                ? "Receiving and verifying the file before enabling download…"
                : preview?.kind === "remote"
                  ? `${preview.type === "video/mp4" ? "MP4" : "MP3"} received and structurally verified. Only the original format is available; remote files are not converted.`
                  : "Check a direct media link to enable its matching download format."}
            </p>
          </div>
        ) : null}
        {error && (
          <p className="error-message" role="alert" id="media-error">
            <CircleAlert size={16} />
            {error}
          </p>
        )}
        {loading && (
          <p className="loading-message" role="status">
            Receiving and checking the original file…
          </p>
        )}
        {loading && (
          <div className="transfer-progress">
            <progress
              aria-label="File transfer progress"
              value={progress?.total ? progress.received : undefined}
              max={progress?.total ?? undefined}
            />
            <span role="status">
              {progress
                ? `${(progress.received / 1024 / 1024).toFixed(1)} MB received${progress.total ? ` of ${(progress.total / 1024 / 1024).toFixed(1)} MB` : " · total unknown"}`
                : "Connecting…"}
            </span>
            <button onClick={() => controller.current?.abort()}>
              Cancel transfer
            </button>
          </div>
        )}
        {!preview && notice && (
          <p className="demo-notice" role="status">
            {notice}
          </p>
        )}
        {preview && (
          <div className="preview-panel">
            <div className="preview-heading">
              <span>
                {preview.kind === "remote"
                  ? "Download ready · structure checked"
                  : "Local file preview"}
              </span>
              <button aria-label="Close preview" onClick={closePreview}>
                <X size={17} />
              </button>
            </div>
            <div className="preview-content">
              {preview.type.startsWith("video/") ? (
                <video
                  className="local-preview"
                  src={preview.url}
                  controls
                  onError={() =>
                    setError(
                      "Your browser cannot preview this codec. Try an MP4 video or MP3 audio file.",
                    )
                  }
                />
              ) : (
                <audio
                  src={preview.url}
                  controls
                  onError={() =>
                    setError("Your browser cannot preview this audio codec.")
                  }
                />
              )}
              <div className="preview-details">
                <strong>{preview.name}</strong>
                <p>
                  {(preview.size / 1024 / 1024).toFixed(2)} MB · {preview.type}{" "}
                  ·{" "}
                  {preview.kind === "remote" ? "Original file" : "Local media"}
                </p>
                <div
                  className="formats"
                  role="group"
                  aria-label="Original file format"
                >
                  <span className="file-format">
                    {preview.type === "video/mp4" ? (
                      <>
                        <FileVideo size={15} /> MP4
                      </>
                    ) : preview.type === "audio/mpeg" ? (
                      <>
                        <Music2 size={15} /> MP3
                      </>
                    ) : (
                      "Original format"
                    )}
                  </span>
                </div>
              </div>
            </div>
            {preview.kind === "local" &&
            preview.file &&
            preview.type.startsWith("video/") ? (
              <Converter key={preview.url} file={preview.file} />
            ) : preview.kind === "local" ? (
              <p className="demo-notice">
                Local audio playback only. Choose a video to convert to MP3.
              </p>
            ) : null}
            {notice && (
              <p className="demo-notice" role="status">
                {notice}
              </p>
            )}
          </div>
        )}
        <p className="workspace-note">
          <span /> Only download media you own or have permission to save.
          Direct MP4/MP3 downloads · 32 MB desktop / 8 MB constrained limit ·
          Local video-to-MP3 conversion.
        </p>
      </div>
    </div>
  );
}
