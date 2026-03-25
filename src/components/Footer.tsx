"use client";

import { useI18n } from "@/i18n";

const LINK_KEYS = [
  { key: "about", href: "/about", external: true },
  { key: "docs", href: "/docs", external: true },
  { key: "github", href: "https://github.com/AmazingAng/polyworld", external: true },
  { key: "x", href: "https://x.com/polyworld_bet", external: true },
];

export default function Footer() {
  const { t } = useI18n();

  const linkLabels: Record<string, string> = {
    about: t("footer.about"),
    docs: t("footer.docs"),
    github: t("footer.github"),
    x: "X",
  };

  return (
    <footer className="flex items-center justify-between px-4 py-2.5 border-t border-[var(--border)] bg-[var(--surface)] font-mono text-[12px] text-[var(--text-dim)] shrink-0">
      <div className="flex items-center gap-1.5">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-[var(--status-live)] shrink-0" aria-hidden="true">
          <polygon points="22,12 17,3.4 7,3.4 2,12 7,20.6 17,20.6" />
          <path d="M2 12h20M12 3.4L16 12l-4 8.6M12 3.4L8 12l4 8.6" />
        </svg>
        <span style={{ fontFamily: "'Inter Tight', sans-serif", fontWeight: 800, letterSpacing: '-0.02em' }} className="text-[13px] text-[var(--text-secondary)]">PolyWorld</span>
      </div>
      <div className="flex items-center gap-5">
        {LINK_KEYS.map(({ key, href, external }) => (
          <a
            key={key}
            href={href}
            {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            className="hover:text-[var(--accent)] transition-colors"
          >
            {linkLabels[key]}
          </a>
        ))}
      </div>
    </footer>
  );
}
