"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowDownToLine, Music2 } from "lucide-react";
import { convertVideo } from "@/lib/convert-video";
import { currentDeviceHints, isConservativeDevice } from "@/lib/device-limits";
import { DESKTOP_LIMITS, MOBILE_LIMITS, type Bitrate } from "@/lib/conversion";
export function Converter({ file }: { file: File }) {
  const [bitrate, setBitrate] = useState<Bitrate>(192);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [output, setOutput] = useState<string | null>(null);
  const convertButton = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (!busy && restoreFocus.current) {
      restoreFocus.current = false;
      convertButton.current?.focus();
    }
  }, [busy]);
  const operation = useRef<AbortController | null>(null);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
      operation.current?.abort();
    },
    [],
  );
  useEffect(
    () => () => {
      if (output) URL.revokeObjectURL(output);
    },
    [output],
  );
  async function convert() {
    const id = ++generation.current;
    operation.current?.abort();
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError("");
    setOutput(null);
    setProgress(null);
    const limits = isConservativeDevice(currentDeviceHints())
      ? MOBILE_LIMITS
      : DESKTOP_LIMITS;
    try {
      const blob = await convertVideo(
        file,
        bitrate,
        limits,
        controller.signal,
        (message, percent) => {
          if (id === generation.current) {
            setStatus(message);
            setProgress(percent);
          }
        },
      );
      if (id === generation.current) setOutput(URL.createObjectURL(blob));
    } catch (error) {
      if (id !== generation.current) return;
      if (controller.signal.aborted) {
        restoreFocus.current = true;
        setStatus("Conversion cancelled. No output saved.");
      } else {
        setStatus("");
        setError(error instanceof Error ? error.message : "Conversion failed.");
      }
    } finally {
      if (id === generation.current) setBusy(false);
    }
  }
  const name =
    (file.name
      .replace(/\.[^.]*$/, "")
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .slice(0, 80) || "snapload-audio") + ".mp3";
  return (
    <div className="converter">
      <label htmlFor="audio-bitrate">MP3 audio bitrate</label>
      <select
        id="audio-bitrate"
        value={bitrate}
        disabled={busy}
        onChange={(e) => {
          setBitrate(Number(e.target.value) as Bitrate);
          setOutput(null);
          setStatus("");
        }}
      >
        {[128, 192, 320].map((value) => (
          <option key={value} value={value}>
            {value} kbps
          </option>
        ))}
      </select>
      <p className="demo-notice">
        Local conversion only. Desktop: 24 MB / 5 min. Mobile, unknown, or
        low-memory devices: 8 MB / 2 min. Processing stops after 3 min. Memory
        limits vary by browser; smaller files work best.
      </p>
      {busy ? (
        <div className="transfer-progress">
          <progress
            aria-label="MP3 conversion progress"
            max={100}
            value={progress ?? undefined}
          />
          <button onClick={() => operation.current?.abort()}>
            Cancel conversion
          </button>
        </div>
      ) : (
        <button ref={convertButton} className="demo-download" onClick={convert}>
          <Music2 size={17} />
          {output ? "Convert again" : "Convert to MP3"}
        </button>
      )}
      {status && (
        <p role="status" className="demo-notice">
          {status}
          {busy && progress !== null ? ` ${Math.floor(progress)}%` : ""}
        </p>
      )}
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {output && (
        <div className="conversion-output">
          <audio src={output} controls aria-label="Converted MP3 preview" />
          <a className="demo-download" href={output} download={name}>
            <ArrowDownToLine size={17} />
            Download MP3
          </a>
        </div>
      )}
    </div>
  );
}
