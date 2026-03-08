import { create } from "zustand";
import type { SmartWallet, WhaleTrade } from "@/types";
import type { LeaderboardPeriod } from "@/components/LeaderboardPanel";

interface SmartMoneyState {
  leaderboard: SmartWallet[];
  leaderboardPeriod: LeaderboardPeriod;
  trades: WhaleTrade[];
  smartTrades: WhaleTrade[];
  lastSync: string | null;
  walletFilter: string | null;
  traderPanelWallet: string | null;
  traderWalletName: string | null;
  traderAddrInput: string;
}

interface SmartMoneyActions {
  setLeaderboard: (lb: SmartWallet[]) => void;
  setLeaderboardPeriod: (period: LeaderboardPeriod) => void;
  setTrades: (trades: WhaleTrade[]) => void;
  setSmartTrades: (trades: WhaleTrade[]) => void;
  setLastSync: (time: string | null) => void;
  setWalletFilter: (addr: string | null) => void;
  setTraderPanelWallet: (addr: string | null) => void;
  setTraderWalletName: (name: string | null) => void;
  setTraderAddrInput: (input: string) => void;
  selectWallet: (addr: string, name?: string | null) => void;
}

export const useSmartMoneyStore = create<SmartMoneyState & SmartMoneyActions>((set) => ({
  leaderboard: [],
  leaderboardPeriod: "all",
  trades: [],
  smartTrades: [],
  lastSync: null,
  walletFilter: null,
  traderPanelWallet: null,
  traderWalletName: null,
  traderAddrInput: "",

  setLeaderboard: (leaderboard) => set({ leaderboard }),
  setLeaderboardPeriod: (leaderboardPeriod) => set({ leaderboardPeriod }),
  setTrades: (trades) => set({ trades }),
  setSmartTrades: (smartTrades) => set({ smartTrades }),
  setLastSync: (lastSync) => set({ lastSync }),
  setWalletFilter: (walletFilter) => set({ walletFilter }),
  setTraderPanelWallet: (traderPanelWallet) => set({ traderPanelWallet }),
  setTraderWalletName: (traderWalletName) => set({ traderWalletName }),
  setTraderAddrInput: (traderAddrInput) => set({ traderAddrInput }),
  selectWallet: (addr, name) => set({
    traderPanelWallet: addr,
    traderWalletName: name ?? null,
  }),
}));
