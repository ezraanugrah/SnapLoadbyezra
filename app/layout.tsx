import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "SnapLoad — A little link. A lot of possibilities.",
  description:
    "Download permitted direct MP4/MP3 files and convert your local videos to MP3.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
