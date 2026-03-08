# PolyWorld

Polymarket prediction market visualization dashboard — real-time global data on a 14-panel grid with an interactive world map.

## Tech Stack

- **Framework:** Next.js 16 (App Router), React 19
- **State:** Zustand 5 (3 stores)
- **Map:** MapLibre GL JS
- **Database:** SQLite (better-sqlite3) — local cache of Polymarket data
- **AI:** Claude API (@anthropic-ai/sdk) — news/sentiment summarization
- **Styling:** Tailwind CSS 4 + CSS custom properties, dark-only theme, monospace font

## Directory Structure

```
src/
├── app/          # Next.js App Router (page.tsx, layout.tsx, API routes in api/)
├── components/   # 14 panel components + Header, Panel, WorldMap, SettingsModal, etc.
├── hooks/        # Custom hooks (usePreferences, useWatchlist, useAlerts, usePanelColSpans, usePanelRowSpans, usePanelDrag, useBrowserNotifications)
├── lib/          # Data processing (polymarket.ts), news/tweet sources, chart constants
├── stores/       # Zustand stores: marketStore, smartMoneyStore, uiStore
└── types/        # TypeScript type definitions (index.ts)
```

## Architecture

- **14 Panels:** markets, detail, country, news, tweets, live, watchlist, leaderboard, smartMoney, whaleTrades, orderbook, trader, sentiment, chart
- **3 Stores:** `marketStore` (market data, selection), `smartMoneyStore` (whale trades, leaderboard, trader panel), `uiStore` (layout, preferences, UI state)
- **Pull-based refresh:** 45s for market data, 30s for smart money, panels self-refresh (news 120s, tweets 90s, sentiment 45s, orderbook 10s)
- **Panel grid:** Drag-reorderable, resizable (col/row span), split between right sidebar and bottom strip
- Panels identified via `data-panel` attribute on DOM

## Commands

```bash
npm run dev      # Start dev server
npm run build    # Production build
npm run start    # Start production server
```

## Conventions

- Dark theme only — all colors via CSS variables in `globals.css` (:root)
- Text hierarchy: `--text` > `--text-secondary` > `--text-dim` > `--text-muted` > `--text-faint` > `--text-ghost`
- Monospace font throughout (JetBrains Mono / SF Mono)
- Panel components receive `selectedMarket` prop for contextual data
- Zustand actions accessed via `useXStore.getState()` in callbacks to avoid stale closures
