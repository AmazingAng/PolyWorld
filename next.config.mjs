import { createMDX } from 'fumadocs-mdx/next';

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: process.env.NODE_ENV === 'production' ? 'standalone' : undefined,
  serverExternalPackages: ['better-sqlite3', '@polymarket/clob-client', 'ethers', '@polymarket/builder-relayer-client', '@polymarket/builder-signing-sdk'],
  turbopack: {},
};

const withMDX = createMDX();
export default withMDX(nextConfig);
