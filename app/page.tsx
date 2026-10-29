import { Downloader } from "@/components/downloader";
import {
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  Link2,
  MousePointer2,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";
export default function Home() {
  return (
    <>
      <header className="header page-width">
        <a href="#" className="brand" aria-label="SnapLoad home">
          <span className="brand-icon">
            <ArrowDownToLine size={23} strokeWidth={2.8} />
          </span>
          snapload<span className="brand-dot">.</span>
        </a>
        <nav aria-label="Main navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#good-to-know">
            Good to know <ArrowUpRight size={14} />
          </a>
        </nav>
        <span className="header-badge">
          <span /> Simple by design
        </span>
      </header>
      <main>
        <section className="hero page-width">
          <div className="eyebrow">
            <span /> LESS FRICTION. MORE CREATING.
          </div>
          <h1>
            A little link.
            <br />A lot of{" "}
            <span className="highlight">
              possibilities.
              <svg
                viewBox="0 0 500 18"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <path d="M3 11 Q230 -2 496 8 M38 16 Q250 4 465 13" />
              </svg>
            </span>
          </h1>
          <p className="hero-copy">
            Download your media. Keep it simple.
            <br className="desktop-break" /> Save a verified MP4 or MP3, or
            convert your own video to audio.
          </p>
          <Downloader />
          <div className="trust-row">
            <span>
              <ShieldCheck size={15} /> No sign-up
            </span>
            <span>
              <Zap size={15} /> Made for simplicity
            </span>
            <span>
              <Check size={15} /> Your files stay yours
            </span>
          </div>
          <span className="hero-spark" aria-hidden="true">
            ✳
          </span>
        </section>
        <section id="how-it-works" className="how-section">
          <div className="page-width">
            <div className="section-top">
              <div>
                <span className="eyebrow">SMALL STEPS. BIG POSSIBILITIES.</span>
                <h2>Three steps. That’s it.</h2>
              </div>
              <p>
                No complicated tools.
                <br />
                Just a smoother way to get started.
              </p>
            </div>
            <div className="steps">
              {[
                {
                  icon: Link2,
                  title: "Drop your link",
                  text: "Paste a permitted direct MP4 or MP3 URL. Or select a local video to convert.",
                },
                {
                  icon: MousePointer2,
                  title: "Check your file",
                  text: "We receive and check the file before enabling its actual download format.",
                },
                {
                  icon: ArrowDownToLine,
                  title: "Download your media",
                  text: "Save a permitted direct MP4 or MP3 file. Or convert your own local video to MP3. Social platform downloads are not supported.",
                },
              ].map(({ icon: Icon, title, text }, i) => (
                <article className="step" key={title}>
                  <div className="step-top">
                    <span className="step-icon">
                      <Icon size={23} />
                    </span>
                    <span className="step-number">0{i + 1}</span>
                  </div>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
        <section id="good-to-know" className="responsible page-width">
          <div className="responsible-icon">
            <ShieldCheck size={28} />
          </div>
          <div>
            <h3>Good tools. Good intentions.</h3>
            <p>
              Only use media you own or have permission to download. We don’t
              remove watermarks or bypass platform restrictions.
            </p>
          </div>
          <span className="responsible-label">
            <Sparkles size={14} /> CREATE RESPONSIBLY
          </span>
        </section>
      </main>
      <footer className="page-width">
        <a className="brand footer-brand" href="#">
          snapload<span className="brand-dot">.</span>
        </a>
        <p>Less friction. More possibilities.</p>
        <span>
          Built by ezra <span className="footer-star">✳</span> ©{" "}
          {new Date().getFullYear()} SnapLoad
        </span>
      </footer>
    </>
  );
}
