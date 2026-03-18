"use client";

import { WagmiProvider, createConfig, http, fallback } from "wagmi";
import { injected } from "@wagmi/core";
import { polygon } from "wagmi/chains";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactNode, useState } from "react";

// Browser transports must stay public. Keep paid/private RPCs on the server only.
const PUBLIC_POLYGON_RPC_URLS = [
  "https://rpc.ankr.com/polygon",
];

const wagmiConfig = createConfig({
  chains: [polygon],
  transports: {
    [polygon.id]: fallback(
      PUBLIC_POLYGON_RPC_URLS.map((url) => http(url))
    ),
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
