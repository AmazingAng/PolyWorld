"use client";

import { useState } from "react";
import { ProcessedMarket, Category } from "@/types";
import CategoryFilter from "./CategoryFilter";
import MarketCard from "./MarketCard";

interface SidePanelProps {
  mapped: ProcessedMarket[];
  unmapped: ProcessedMarket[];
  activeCategories: Set<Category>;
  onToggleCategory: (category: Category) => void;
  onFlyTo: (coords: [number, number], marketId: string) => void;
}

const NEW_THRESHOLD_MS = 6 * 60 * 60 * 1000; // 6 hours

export default function SidePanel({
  mapped,
  unmapped,
  activeCategories,
  onToggleCategory,
  onFlyTo,
}: SidePanelProps) {
  const [renderNow] = useState(() => Date.now());
  const all = [...mapped, ...unmapped];
  const filtered = all.filter((m) => activeCategories.has(m.category));

  const newMarkets = filtered
    .filter((m) => m.createdAt && renderNow - new Date(m.createdAt).getTime() < NEW_THRESHOLD_MS)
    .sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime())
    .slice(0, 10);

  const movers = filtered
    .filter((i) => i.change !== null && !isNaN(i.change!))
    .sort((a, b) => Math.abs(b.change!) - Math.abs(a.change!))
    .slice(0, 10);

  const trending = [...filtered]
    .sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0))
    .slice(0, 10);

  const global = [...unmapped]
    .filter((m) => activeCategories.has(m.category))
    .sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0))
    .slice(0, 8);

  return (
    <aside className="w-[370px] bg-[#0a0a0a] border-l border-[#1a1a1a] overflow-y-auto shrink-0 hidden md:block scrollbar-thin">
      <CategoryFilter
        active={activeCategories}
        onToggle={onToggleCategory}
      />

      {newMarkets.length > 0 && (
        <Section title="NEW_MARKETS">
          {newMarkets.map((m) => (
            <MarketCard
              key={m.id}
              market={m}
              onClick={() =>
                m.coords
                  ? onFlyTo(m.coords, m.id)
                  : window.open(
                      `https://polymarket.com/event/${encodeURIComponent(m.slug)}?via=pw`,
                      "_blank",
                      "noopener,noreferrer"
                    )
              }
            />
          ))}
        </Section>
      )}

      <Section title="MOVERS_24H">
        {movers.length === 0 ? (
          <EmptyState />
        ) : (
          movers.map((m) => (
            <MarketCard
              key={m.id}
              market={m}
              showChange
              onClick={() =>
                m.coords
                  ? onFlyTo(m.coords, m.id)
                  : window.open(
                      `https://polymarket.com/event/${encodeURIComponent(m.slug)}?via=pw`,
                      "_blank",
                      "noopener,noreferrer"
                    )
              }
            />
          ))
        )}
      </Section>

      <Section title="TRENDING_VOL">
        {trending.length === 0 ? (
          <EmptyState />
        ) : (
          trending.map((m) => (
            <MarketCard
              key={m.id}
              market={m}
              onClick={() =>
                m.coords
                  ? onFlyTo(m.coords, m.id)
                  : window.open(
                      `https://polymarket.com/event/${encodeURIComponent(m.slug)}?via=pw`,
                      "_blank",
                      "noopener,noreferrer"
                    )
              }
            />
          ))
        )}
      </Section>

      <Section title="GLOBAL_MKT">
        {global.length === 0 ? (
          <EmptyState text="all markets geolocated" />
        ) : (
          global.map((m) => (
            <MarketCard
              key={m.id}
              market={m}
              onClick={() =>
                window.open(
                  `https://polymarket.com/event/${encodeURIComponent(m.slug)}?via=pw`,
                  "_blank",
                  "noopener,noreferrer"
                )
              }
            />
          ))
        )}
      </Section>
    </aside>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="p-3 border-b border-[#1a1a1a]">
      <h3 className="text-[13px] font-mono uppercase tracking-[0.15em] text-[#777] mb-2">
        {title}
      </h3>
      {children}
    </div>
  );
}

function EmptyState({ text = "no data" }: { text?: string }) {
  return (
    <div className="text-[12px] text-[#8a8a8a] py-2 font-mono">{text}</div>
  );
}
