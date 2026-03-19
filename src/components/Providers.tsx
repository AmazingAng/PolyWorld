"use client";

import { WagmiProvider, createConfig, http, fallback } from "wagmi";
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
  // No connectors declared — wagmi auto-discovers wallets via EIP-6963.
  // All installed browser wallets (MetaMask, OKX, Rabby, Coinbase, etc.)
  // will appear automatically with their real icons and names.
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
