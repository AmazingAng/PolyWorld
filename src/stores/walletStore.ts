import { create } from "zustand";

interface TradeSession {
  sessionToken: string;
  proxyAddress: string;
}

interface WalletState {
  address: string | null;         // EOA wallet address
  proxyAddress: string | null;    // Polymarket proxy wallet address
  chainId: number | null;
  tradeSession: TradeSession | null;
  isConnected: boolean;
  setWallet: (address: string, chainId: number) => void;
  setProxyAddress: (proxy: string) => void;
  setTradeSession: (session: TradeSession) => void;
  clearTradeSession: () => void;
  clearWallet: () => void;
}

// Pure in-memory store — never persisted to localStorage (prevents API key leakage)
export const useWalletStore = create<WalletState>((set) => ({
  address: null,
  proxyAddress: null,
  chainId: null,
  tradeSession: null,
  isConnected: false,
  setWallet: (address, chainId) => set((state) => {
    const sameAddress = state.address?.toLowerCase() === address.toLowerCase();
    return {
      address,
      chainId,
      isConnected: true,
      proxyAddress: sameAddress ? state.proxyAddress : null,
      tradeSession: sameAddress ? state.tradeSession : null,
    };
  }),
  setProxyAddress: (proxy) => set({ proxyAddress: proxy }),
  setTradeSession: (session) => set({ tradeSession: session, proxyAddress: session.proxyAddress }),
  clearTradeSession: () => set({ tradeSession: null, proxyAddress: null }),
  clearWallet: () => set({ address: null, proxyAddress: null, chainId: null, tradeSession: null, isConnected: false }),
}));
