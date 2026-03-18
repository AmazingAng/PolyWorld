import Link from "next/link";
import Footer from "@/components/Footer";

const FEATURES = [
  {
    icon: "🗺️",
    title: "World Map View",
    desc: "See prediction markets plotted by geographic relevance. Zoom, click, and explore real-time data on an interactive global map.",
  },
  {
    icon: "🐋",
    title: "Smart Money Tracking",
    desc: "Follow whale trades, smart wallet clusters, and money flow in real time. Know what the top traders are buying before the crowd.",
  },
  {
    icon: "⚡",
    title: "Signal Engine",
    desc: "7 signal types detect momentum shifts, accumulation patterns, news catalysts, and top-wallet entries across all markets.",
  },
  {
    icon: "📊",
    title: "Trade Directly",
    desc: "Connect your wallet to buy and sell Polymarket positions without leaving the map. Full CLOB orderbook support.",
  },
];

export default function AboutPage() {
  return (
    <div className="flex flex-col min-h-screen bg-[var(--bg)] text-[var(--text)] font-mono">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
        <Link href="/" className="flex items-center gap-2">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-[var(--status-live)]" aria-hidden="true">
            <polygon points="22,12 17,3.4 7,3.4 2,12 7,20.6 17,20.6" />
            <path d="M2 12h20M12 3.4L16 12l-4 8.6M12 3.4L8 12l4 8.6" />
          </svg>
          <span style={{ fontFamily: "'Inter Tight', sans-serif", fontWeight: 800, letterSpacing: "-0.02em" }} className="text-[15px] text-[var(--text)]">
            PolyWorld
          </span>
        </Link>
        <Link href="/" className="text-[12px] text-[var(--text-dim)] hover:text-[var(--accent)] transition-colors">
          &larr; Back to Dashboard
        </Link>
      </nav>

      {/* Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-12">
          {/* Hero */}
          <h1 className="text-[28px] font-bold mb-2" style={{ fontFamily: "'Inter Tight', sans-serif", fontWeight: 800 }}>
            About PolyWorld
          </h1>
          <p className="text-[14px] text-[var(--text-secondary)] leading-relaxed mb-10">
            Prediction market intelligence on a world map. Track what the smart money is doing, catch signals before the crowd, and trade directly — all from one interface.
          </p>

          {/* Feature cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-12">
            {FEATURES.map(({ icon, title, desc }) => (
              <div key={title} className="border border-[var(--border)] bg-[var(--surface)] rounded-md p-5">
                <div className="text-[20px] mb-2">{icon}</div>
                <h3 className="text-[13px] font-bold text-[var(--text)] mb-1">{title}</h3>
                <p className="text-[12px] text-[var(--text-dim)] leading-[1.5]">{desc}</p>
              </div>
            ))}
          </div>

          {/* Tech */}
          <h2 className="text-[16px] font-bold text-[var(--text)] mb-3">Built With</h2>
          <p className="text-[12px] text-[var(--text-dim)] leading-[1.6] mb-8">
            PolyWorld is built on the Polymarket CLOB API for real-time market data and trading. The interactive map uses MapLibre GL JS. A custom signal engine processes whale trades, smart wallet clusters, and news events to generate actionable alerts. The frontend is a Next.js app with Zustand state management, styled with Tailwind CSS in a dark monospace theme.
          </p>

          {/* Links */}
          <div className="flex gap-4">
            <a
              href="https://github.com/polyworld"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-[12px] text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" /></svg>
              GitHub
            </a>
            <a
              href="https://x.com/polyworld_app"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-[12px] text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
              X
            </a>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
