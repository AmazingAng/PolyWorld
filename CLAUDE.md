# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 技术栈

- **框架：** Next.js 16 (App Router)，React 19
- **状态：** Zustand 5（3 个 store）
- **地图：** MapLibre GL JS（客户端动态加载，SSR 禁用）
- **数据库：** SQLite（better-sqlite3）— Polymarket 数据本地缓存
- **AI：** Claude API（@anthropic-ai/sdk）— 新闻匹配、地理编码、情绪摘要
- **样式：** Tailwind CSS 4 + CSS 自定义变量，纯暗色主题，等宽字体

## 常用命令

```bash
npm run dev      # 启动开发服务器
npm run build    # 生产构建（TypeScript 类型检查）
npm run start    # 启动生产服务器
npm run lint     # ESLint
npm run test     # 运行所有单元测试（vitest）
npm run test:watch  # 监视模式
```

单个测试文件：`npx vitest run src/__tests__/keywords.test.ts`

## 架构概览

### 数据流

```
Polymarket Gamma API → fetchEventsFromAPI() → processEvents() → SQLite events 表
                                                                      ↓
                                                         readMarketsFromDb() (10s 缓存)
                                                                      ↓
                                                         /api/markets → 前端 45s 轮询
```

**5 个后台同步循环**（`src/instrumentation.ts` 启动，仅 Node.js 运行时）：

| 循环 | 文件 | 间隔 |
|------|------|------|
| 市场数据 | `src/lib/sync.ts` | 30s |
| 新闻 | `src/lib/newsSync.ts` | 5min |
| Smart money | `src/lib/smartMoneySync.ts` | 30s |
| 推文 | `src/lib/tweetsSync.ts` | 3min |
| Resolution 监控 | `src/lib/resolutionSync.ts` | 2min |

### 3 个 Zustand Store

- **`marketStore`**：市场数据（mapped/unmapped）、选中市场、选中国家、新市场 ID 集合
- **`smartMoneyStore`**：鲸鱼交易、排行榜、Trader 面板钱包、钱包过滤器
- **`uiStore`**：面板可见性/顺序、布局状态、类别过滤、时间范围

在回调中用 `useXStore.getState()` 访问 action，避免 stale closure。

### 面板系统（当前 19 个面板）

注册一个新面板需要同步修改 **6 处**：

1. `src/stores/uiStore.ts` — `DEFAULT_PANEL_VISIBILITY`、`DEFAULT_PANEL_ORDER`、`hydrateFromPrefs` 迁移
2. `src/components/SettingsModal.tsx` — `PanelVisibility` 接口 + `PANEL_LABELS`
3. `src/hooks/usePreferences.ts` — `DEFAULT_PREFERENCES` 中的默认值和 `panelOrder`
4. `src/app/page.tsx` — import、`DEFAULT_COL_SPANS`、`panelHandlers` ids 数组、`renderPanel` switch case

面板通过 DOM 上的 `data-panel` 属性识别，用于拖拽排序。布局分为右侧边栏（最大 2 列）和底部条（最大 3 列）。

### SQLite 数据库

- 路径：`src/lib/db.ts`，单例，通过 `getDb()` 访问
- 列添加用 `migrate()` 中的 `ALTER TABLE ADD COLUMN`（条件判断，幂等）
- 主要表：`events`、`price_snapshots`、`whale_trades`、`smart_wallets`、`news_items`、`news_market_matches`、`resolution_monitors`、`resolution_alerts`
- `readMarketsFromDb()` 有 10s 结果缓存、2min 异常检测缓存

### 信号系统

- `src/lib/smartSignals.ts` — 4 种基础信号（whale_accumulation、smart_divergence、cluster_activity、momentum_shift）
- `src/lib/signalEngine.ts` — 统一信号引擎，7 种类型，加入 top_wallet_entry、top_cluster、news_catalyst
- `src/components/SignalPanel.tsx` — 调用 `generateSignals()`，自行拉取新闻数据
- `src/hooks/useAlerts.ts` — 告警配置（price_cross、new_market、smart_signal），5min 防抖，存 localStorage

### Polymarket API

- **Gamma API**（`https://gamma-api.polymarket.com`）— 市场事件数据，`src/lib/polymarket.ts`
- **Data API**（`https://data-api.polymarket.com`）— 排行榜、鲸鱼交易、持仓，`src/lib/smartMoney.ts`
- `negRisk: true` 表示互斥结局（选举、冠军赛），是套利检测的判断依据；已持久化到 DB 的 `neg_risk` 列

## 约定

- **颜色变量层级：** `--text` > `--text-secondary` > `--text-dim` > `--text-muted` > `--text-faint` > `--text-ghost`
- **useLocalStorage 约束：** 泛型参数必须满足 `{ version: number }`；存储简单字符串时直接用 `localStorage` API
- **避免 stale closure：** 在 `useCallback`/`useEffect` 中通过 `useXStore.getState()` 调用 action
- **面板组件模式：** 通过 `selectedMarket` prop 接收上下文数据；市场选择用 `handleSelectMarketFromPanel`
- **AI 成本敏感：** 新闻/推文的 AI 匹配是主要费用来源（~$5/hr）。每批限 50 条，匹配完成后标记 `ai_match_done=1` 防止重复
