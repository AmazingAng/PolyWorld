"use client";

import { WagmiProvider, createConfig, http, fallback } from "wagmi";
import { polygon } from "wagmi/chains";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { injected } from "wagmi/connectors";
import { ReactNode, useState } from "react";

const wagmiConfig = createConfig({
  chains: [polygon],
  transports: {
    [polygon.id]: fallback([
      http("https://rpc.ankr.com/polygon"),          // Ankr — reliable, no key required
      http("https://1rpc.io/matic"),                  // 1RPC — privacy-focused fallback
      http("https://polygon-rpc.com"),                // Polygon official fallback
    ]),
  },
  connectors: [
    injected(),                                        // MetaMask / Rabby / generic EIP-1193
    injected({ target: "okxWallet" }),                 // OKX Wallet (window.okxwallet)
  ],
});

export default function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  );
}
