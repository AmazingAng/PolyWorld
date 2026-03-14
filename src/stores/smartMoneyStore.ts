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
}

export const useSmartMoneyStore = create<SmartMoneyState & SmartMoneyActions>((set) => ({
  leaderboard: [],
  leaderboardPeriod: "all",
  trades: [],
  smartTrades: [],
  lastSync: null,
  walletFilter: null,
  traderPanelWallet: typeof window !== "undefined" ? localStorage.getItem("pw:traderWallet") : null,
  traderWalletName: typeof window !== "undefined" ? localStorage.getItem("pw:traderWalletName") : null,
  traderAddrInput: "",

  setLeaderboard: (leaderboard) => set({ leaderboard }),
  setLeaderboardPeriod: (leaderboardPeriod) => set({ leaderboardPeriod }),
  setTrades: (trades) => set({ trades }),
  setSmartTrades: (smartTrades) => set({ smartTrades }),
  setLastSync: (lastSync) => set({ lastSync }),
  setWalletFilter: (walletFilter) => set({ walletFilter }),
  setTraderPanelWallet: (traderPanelWallet) => {
    set({ traderPanelWallet });
    try {
      if (traderPanelWallet) localStorage.setItem("pw:traderWallet", traderPanelWallet);
      else localStorage.removeItem("pw:traderWallet");
    } catch {}
  },
  setTraderWalletName: (traderWalletName) => {
    set({ traderWalletName });
    try {
      if (traderWalletName) localStorage.setItem("pw:traderWalletName", traderWalletName);
      else localStorage.removeItem("pw:traderWalletName");
    } catch {}
  },
  setTraderAddrInput: (traderAddrInput) => set({ traderAddrInput }),
}));
