"use client";

import { useState, useSyncExternalStore } from "react";
import { useI18n } from "@/i18n";

const STORAGE_KEY = "polyworld_onboarded";

interface OnboardingModalProps {
  onConnectWallet?: () => void;
}

export default function OnboardingModal({ onConnectWallet }: OnboardingModalProps) {
  const { t } = useI18n();
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
          {t("onboarding.welcome")}
        </h2>
        <p className="text-[12px] text-[var(--text-muted)] mb-4">
          {t("onboarding.subtitle")}
        </p>

        {/* Features */}
        <div className="space-y-2.5 mb-5">
          {FEATURE_KEYS.map(({ icon, titleKey, descKey }) => (
            <div key={titleKey} className="flex items-start gap-2.5">
              <span className="text-[16px] shrink-0 mt-0.5">{icon}</span>
              <div>
                <div className="text-[12px] text-[var(--text)] font-medium">{t(titleKey)}</div>
                <div className="text-[11px] text-[var(--text-dim)] leading-[1.4]">{t(descKey)}</div>
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
              {t("onboarding.connectWallet")}
            </button>
          )}
          <button
            onClick={dismiss}
            className={`${onConnectWallet ? "" : "flex-1 "}py-2 px-4 text-[11px] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--border-active)] transition-colors`}
          >
            {t("onboarding.exploreFirst")}
          </button>
        </div>

        <p className="text-[10px] text-[var(--text-ghost)] mt-3 text-center">
          {t("onboarding.noWalletNeeded")}
        </p>
      </div>
    </div>
  );
}

const FEATURE_KEYS = [
  { icon: "🗺️", titleKey: "onboarding.featureMap", descKey: "onboarding.featureMapDesc" },
  { icon: "🐋", titleKey: "onboarding.featureSmartMoney", descKey: "onboarding.featureSmartMoneyDesc" },
  { icon: "⚡", titleKey: "onboarding.featureSignals", descKey: "onboarding.featureSignalsDesc" },
  { icon: "📊", titleKey: "onboarding.featureTrade", descKey: "onboarding.featureTradeDesc" },
];
