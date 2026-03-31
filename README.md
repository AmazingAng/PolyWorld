# PolyWorld

Real-time [Polymarket](https://polymarket.com) prediction market visualization dashboard with an interactive world map.

![License](https://img.shields.io/badge/license-MIT-blue)

## Features

- **Interactive World Map** — Browse 500+ prediction markets plotted on a MapLibre GL globe with clustering, category filters, and regional views
- **14 Live Panels** — Markets, Detail, Region, News, Tweets, Live Streams, Watchlist, Leaderboard, Smart Trades, Whale Trades, Order Book, Trader, Sentiment, Price Chart
- **AI-Powered Insights** — Market summaries, news relevance matching, and sentiment analysis via Claude API
- **Smart Money Tracking** — Whale trade monitoring, leaderboard rankings, and wallet-level trade history
- **Real-Time Data** — Auto-refreshing market data (45s), smart money (30s), order book (10s), and news feeds
- **Drag & Resize Layout** — Fully customizable panel grid with drag reordering, column/row span controls, and split bottom/right layout
- **Watchlist & Alerts** — Star markets, set price/volume alerts with browser notifications

## Tech Stack

- **Framework:** Next.js 16 (App Router), React 19
- **State:** Zustand 5
- **Map:** MapLibre GL JS
- **Charts:** lightweight-charts (TradingView)
- **Database:** SQLite (better-sqlite3)
- **AI:** Claude API (@anthropic-ai/sdk)
- **Styling:** Tailwind CSS 4 + CSS custom properties

## Getting Started

### Prerequisites

- Node.js 20+
- npm

### Setup

```bash
# Clone
git clone https://github.com/AmazingAng/PolyWorld.git
cd PolyWorld

# Install dependencies
npm install

# Generate Fumadocs collections
npm run docs:gen

# Configure environment variables
cp .env.example .env
# Edit .env with your API keys / optional data source credentials

# Start dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `AI_BASE_URL` | Yes | Anthropic API base URL |
| `AI_API_KEY` | Yes | Anthropic API key (for summaries, news matching, sentiment) |
| `AI_FALLBACK_BASE_URL` | No | Fallback API base URL |
| `AI_FALLBACK_API_KEY` | No | Fallback API key (used if primary fails) |
| `DATA_DIR` | No | Directory for runtime data and SQLite files |
| `DB_PATH` | No | SQLite database path |
| `POLYGON_RPC_URLS` | No | Comma-separated server-side Polygon RPC endpoints |
| `NEXT_PUBLIC_POLYGON_RPC_URL` | No | Browser-side Polygon RPC endpoint for wagmi |
| `UCDP_TOKEN` | No | Enables UCDP-backed conflict and military overlays |
| `TICKETMASTER_KEY` | No | Enables live sports overlay |
| `CLOUDFLARE_TOKEN` | No | Enables internet outages overlay |
| `ACLED_EMAIL` | No | ACLED OAuth email for protests/unrest overlay |
| `ACLED_PASSWORD` | No | ACLED OAuth password for protests/unrest overlay |

The app works without most optional keys. Missing keys only disable the related AI or overlay features.

### Local Verification

After dependency install, regenerate docs collections before type-checking or building:

```bash
npm run docs:gen
npm run lint
npm run typecheck
npm test
```

## Project Structure

```
src/
├── app/          # Next.js App Router, API routes
├── components/   # 14 panel components + Header, WorldMap, etc.
├── hooks/        # Custom hooks (preferences, watchlist, alerts, drag, resize)
├── lib/          # Data processing, AI clients, news/tweet sources
├── stores/       # Zustand: marketStore, smartMoneyStore, uiStore
└── types/        # TypeScript definitions
```

## Scripts

```bash
npm run docs:gen # Generate Fumadocs collections
npm run dev      # Development server
npm run build    # Production build
npm run start    # Production server
npm run lint     # ESLint
npm run typecheck # TypeScript check
npm test         # Vitest unit tests
npm run test:e2e # Playwright end-to-end tests
```

## Acknowledgements

Inspired by [WorldMonitor](https://worldmonitor.app/).

## License

[MIT](LICENSE)
