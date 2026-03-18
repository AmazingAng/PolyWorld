"use client";

import { useState, useSyncExternalStore } from "react";

const STORAGE_KEY = "polyworld_onboarded";

interface OnboardingModalProps {
  onConnectWallet?: () => void;
}

export default function OnboardingModal({ onConnectWallet }: OnboardingModalProps) {
  const visible = useSyncExternalStore(
    () => () => {},
    () => {
      if (typeof window === "undefined") return false;
      return !localStorage.getItem(STORAGE_KEY);
    },
    () => false,
  );
  const [dismissed, setDismissed] = useState(false);

  if (!visible || dismissed) return null;

  const dismiss = () => {
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, "1");
    }
    setDismissed(true);
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div
        className="relative w-[420px] max-w-[92vw] bg-[#111] border border-[#2a2a2a] rounded-md p-6 font-mono shadow-2xl"
      >
        {/* Close button */}
        <button
          onClick={dismiss}
          className="absolute top-3 right-3 text-[var(--text-faint)] hover:text-[var(--text)] text-sm"
        >
          &times;
        </button>

        {/* Title */}
        <h2 className="text-[16px] font-bold text-[var(--text)] mb-1">
          Welcome to PolyWorld
        </h2>
        <p className="text-[12px] text-[var(--text-muted)] mb-4">
          Prediction market intelligence on a world map
        </p>

        {/* Features */}
        <div className="space-y-2.5 mb-5">
          {FEATURES.map(({ icon, title, desc }) => (
            <div key={title} className="flex items-start gap-2.5">
              <span className="text-[16px] shrink-0 mt-0.5">{icon}</span>
              <div>
                <div className="text-[12px] text-[var(--text)] font-medium">{title}</div>
                <div className="text-[11px] text-[var(--text-dim)] leading-[1.4]">{desc}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          {onConnectWallet && (
            <button
              onClick={() => { dismiss(); onConnectWallet(); }}
              className="flex-1 py-2 text-[11px] font-bold border border-[#22c55e]/50 text-[#22c55e] hover:bg-[#22c55e]/10 transition-colors"
            >
              Connect Wallet to Trade
            </button>
          )}
          <button
            onClick={dismiss}
            className={`${onConnectWallet ? "" : "flex-1 "}py-2 px-4 text-[11px] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--border-active)] transition-colors`}
          >
            Explore First
          </button>
        </div>

        <p className="text-[9px] text-[var(--text-ghost)] mt-3 text-center">
          No wallet needed to browse markets, signals, and data.
        </p>
      </div>
    </div>
  );
}

const FEATURES = [
  {
    icon: "🗺️",
    title: "World Map View",
    desc: "See prediction markets plotted by geographic relevance. Zoom, click, and explore.",
  },
  {
    icon: "🐋",
    title: "Smart Money Tracking",
    desc: "Follow whale trades, smart wallet clusters, and money flow in real time.",
  },
  {
    icon: "⚡",
    title: "Signal Engine",
    desc: "7 signal types detect momentum shifts, accumulation patterns, and news catalysts.",
  },
  {
    icon: "📊",
    title: "Trade Directly",
    desc: "Connect your wallet to buy and sell Polymarket positions without leaving the map.",
  },
];
