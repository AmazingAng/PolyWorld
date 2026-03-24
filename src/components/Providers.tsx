"use client";

import { WagmiProvider, createConfig, http, fallback } from "wagmi";
import { polygon } from "wagmi/chains";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactNode, useState } from "react";
import { I18nProvider } from "@/i18n";

// Primary: publicnode (same as Betmoar). Fallbacks: other free RPCs.
// NEXT_PUBLIC_POLYGON_RPC_URL overrides the primary if set.
const configuredRpc = process.env.NEXT_PUBLIC_POLYGON_RPC_URL;

const rpcTransports = [
  http(configuredRpc || "https://polygon-bor-rpc.publicnode.com"),
  http("https://polygon-rpc.com"),
  http("https://1rpc.io/matic"),
  http("https://rpc.ankr.com/polygon"),
];

const wagmiConfig = createConfig({
  chains: [polygon],
  transports: {
    [polygon.id]: fallback(rpcTransports),
  },
  // No connectors declared — wagmi auto-discovers wallets via EIP-6963.
  // All installed browser wallets (MetaMask, OKX, Rabby, Coinbase, etc.)
  // will appear automatically with their real icons and names.
});

export default function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <I18nProvider>
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      </WagmiProvider>
    </I18nProvider>
  );
}
