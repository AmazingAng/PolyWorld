"use client";

import { WagmiProvider, createConfig, http, fallback } from "wagmi";
import { polygon } from "wagmi/chains";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactNode, useState } from "react";

// NEXT_PUBLIC_POLYGON_RPC_URL: optional, set to a paid/private RPC for reliability.
// Falls back to public RPCs if not configured.
const PUBLIC_POLYGON_RPC_URLS = [
  "https://polygon-rpc.com",
  "https://rpc.ankr.com/polygon",
  "https://polygon.llamarpc.com",
  "https://1rpc.io/matic",
];

const configuredRpc = process.env.NEXT_PUBLIC_POLYGON_RPC_URL;
const rpcTransports = [
  ...(configuredRpc ? [http(configuredRpc)] : []),
  ...PUBLIC_POLYGON_RPC_URLS.map((url) => http(url)),
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
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  );
}
