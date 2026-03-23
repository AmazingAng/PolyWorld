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

- Node.js 18+
- npm

### Setup

```bash
# Clone
git clone https://github.com/AmazingAng/PolyWorld.git
cd PolyWorld

# Install dependencies
npm install

# Configure environment variables
cp .env.example .env
# Edit .env with your API keys

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

The app works without AI keys — summaries and sentiment will be disabled, but all market data, charts, and trading features remain functional.

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
npm run dev      # Development server
npm run build    # Production build
npm run start    # Production server
npm run lint     # ESLint
```

## Acknowledgements

Inspired by [WorldMonitor](https://worldmonitor.app/).

## License

[MIT](LICENSE)
