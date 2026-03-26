"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useI18n } from "@/i18n";
import { useWalletStore } from "@/stores/walletStore";
import type { ProcessedMarket } from "@/types";
import {
  fetchOpenOrders,
  cancelOpenOrder,
  cancelAllOpenOrders,
  buildTokenIndex,
  type OpenOrder,
} from "@/lib/openOrders";

interface OpenOrdersPanelProps {
  markets: ProcessedMarket[];
  onSelectMarket?: (slug: string) => void;
}

export default function OpenOrdersPanel({ markets, onSelectMarket }: OpenOrdersPanelProps) {
  const { t } = useI18n();
  const tradeSession = useWalletStore((s) => s.tradeSession);
  const [orders, setOrders] = useState<OpenOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [cancellingIds, setCancellingIds] = useState<Set<string>>(new Set());
  const [cancellingAll, setCancellingAll] = useState(false);
  const sessionTokenRef = useRef(tradeSession?.sessionToken);
  sessionTokenRef.current = tradeSession?.sessionToken;

  const refresh = async () => {
    const token = sessionTokenRef.current;
    if (!token) return;
    setLoading(true);
    try {
      const result = await fetchOpenOrders(token);
      setOrders(result);
    } catch { /* ignore */ }
    setLoading(false);
  };
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  // Poll every 15s
  useEffect(() => {
    if (!tradeSession?.sessionToken) { setOrders([]); return; }
    void refreshRef.current();
    const iv = setInterval(() => { void refreshRef.current(); }, 15_000);
    return () => clearInterval(iv);
  }, [tradeSession?.sessionToken]);

  // Listen for order-placed events
  useEffect(() => {
    const handler = () => { void refreshRef.current(); };
    window.addEventListener("polyworld:order-placed", handler);
    return () => window.removeEventListener("polyworld:order-placed", handler);
  }, []);

  const handleCancel = async (orderId: string) => {
    const token = sessionTokenRef.current;
    if (!token) return;
    setCancellingIds((s) => new Set(s).add(orderId));
    try {
      await cancelOpenOrder(orderId, token);
      setOrders((prev) => prev.filter((o) => o.id !== orderId));
    } catch { /* ignore */ }
    setCancellingIds((s) => { const n = new Set(s); n.delete(orderId); return n; });
  };

  const handleCancelAll = async () => {
    const token = sessionTokenRef.current;
    if (!token || orders.length === 0) return;
    setCancellingAll(true);
    await cancelAllOpenOrders(orders.map((o) => o.id), token);
    await refreshRef.current();
    setCancellingAll(false);
  };

  const tokenIndex = useMemo(() => buildTokenIndex(markets), [markets]);
  const resolved = useMemo(
    () => orders.map((o) => ({ order: o, market: tokenIndex.get(String(o.asset_id)) ?? null })),
    [orders, tokenIndex],
  );

  if (!tradeSession) {
    return (
      <div className="text-[11px] text-[var(--text-faint)] font-mono px-1">
        {t("openOrders.connectToView")}
      </div>
    );
  }

  if (loading && orders.length === 0) {
    return (
      <div className="text-[11px] text-[var(--text-ghost)] font-mono px-1">{t("common.loading")}</div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="text-[11px] text-[var(--text-faint)] font-mono px-1">{t("openOrders.noOpenOrders")}</div>
    );
  }

  return (
    <div className="font-mono text-[11px]">
      {/* Header */}
      <div className="flex items-center justify-between px-1 pb-2">
        <span className="text-[var(--text-faint)] tabular-nums">{orders.length === 1 ? t("openOrders.orderCount", { count: orders.length }) : t("openOrders.orderCountPlural", { count: orders.length })}</span>
        <button
          onClick={handleCancelAll}
          disabled={cancellingAll}
          className="text-[10px] px-1.5 py-0.5 border border-[#ff4444]/30 text-[#ff4444]/70 hover:text-[#ff4444] hover:border-[#ff4444]/50 transition-colors disabled:opacity-40"
        >
          {cancellingAll ? t("openOrders.cancellingAll") : t("openOrders.cancelAll")}
        </button>
      </div>

      {/* Orders */}
      <div className="space-y-0">
        {resolved.map(({ order, market }) => {
          const price = parseFloat(order.price) || 0;
          const total = parseFloat(order.original_size) || 0;
          const matched = parseFloat(order.size_matched) || 0;
          const totalUsdc = total * price;
          const isCancelling = cancellingIds.has(order.id);
          const isBuy = order.side === "BUY";
          const title = market?.title || `${order.asset_id.slice(0, 12)}…`;
          const image = market?.image;

          return (
            <div
              key={order.id}
              className="px-1 py-2 border-t border-[var(--border-subtle)] hover:bg-[var(--border-subtle)]/30 transition-colors group"
            >
              <div className="flex items-start gap-2">
                {image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={image} alt="" width={28} height={28} className="rounded shrink-0 mt-0.5 object-cover" />
                ) : (
                  <div className="w-7 h-7 rounded shrink-0 mt-0.5 bg-[var(--border-subtle)] flex items-center justify-center text-[10px] text-[var(--text-ghost)]">
                    {title.slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  {/* Title row */}
                  <div className="flex items-center justify-between gap-1">
                    {market ? (
                      <button
                        onClick={() => onSelectMarket?.(market.slug)}
                        className="flex-1 min-w-0 text-[11px] text-[var(--text-muted)] group-hover:text-[var(--text)] transition-colors truncate block text-left"
                        title={market.title}
                      >
                        {market.title}
                      </button>
                    ) : (
                      <span className="flex-1 min-w-0 text-[11px] text-[var(--text-ghost)] truncate">{title}</span>
                    )}
                    <button
                      onClick={() => handleCancel(order.id)}
                      disabled={isCancelling}
                      className="shrink-0 text-[10px] px-1.5 py-0.5 border border-[var(--border)] text-[var(--text-ghost)] hover:text-[#ff4444] hover:border-[#ff4444]/40 transition-colors disabled:opacity-40"
                    >
                      {isCancelling ? "…" : t("common.cancel")}
                    </button>
                  </div>
                  {/* Side + outcome + price */}
                  <div className="flex items-center justify-between mt-0.5">
                    <span className="flex items-center gap-1.5 text-[10px] tabular-nums">
                      <span className={`font-bold ${isBuy ? "text-[#22c55e]" : "text-[#ff4444]"}`}>
                        {order.side} {market?.outcome}
                      </span>
                      <span className="text-[var(--text-faint)]">{(price * 100).toFixed(1)}¢</span>
                    </span>
                    <span className="text-[10px] tabular-nums text-[var(--text-faint)]">
                      ${totalUsdc.toFixed(2)}
                    </span>
                  </div>
                  {/* Filled progress */}
                  <div className="flex items-center justify-between mt-0.5 text-[10px] tabular-nums text-[var(--text-faint)]">
                    <span>{t("trade.filled", { matched: matched.toFixed(0), total: total.toFixed(0) })}</span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
