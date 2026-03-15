import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: process.env.NODE_ENV === "production" ? "standalone" : undefined,
  serverExternalPackages: ["better-sqlite3", "@polymarket/clob-client", "ethers", "@polymarket/builder-relayer-client", "@polymarket/builder-signing-sdk"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' wss: ws: https://rpc.ankr.com https://1rpc.io https://polygon-rpc.com https://clob.polymarket.com https://gamma-api.polymarket.com https://data-api.polymarket.com https://newsapi.org https://api.anthropic.com https://relayer-v2.polymarket.com https://safe-transaction-polygon.safe.global;",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
