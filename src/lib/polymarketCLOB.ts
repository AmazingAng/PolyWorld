/**
 * Server-side Polymarket CLOB client utilities.
 * Only import this in API routes (Node.js runtime).
 */

import {
  ClobClient,
  Chain,
  SignatureType,
} from "@polymarket/clob-client";

const CLOB_HOST = "https://clob.polymarket.com";
const CHAIN_ID = Chain.POLYGON;

export interface L2Creds {
  apiKey: string;
  secret: string;
  passphrase: string;
}

/**
 * Derive L2 API credentials using a pre-computed EIP-712 ClobAuth signature.
 *
 * The frontend signs:
 *   domain: { name: "ClobAuthDomain", version: "1", chainId: 137 }
 *   types:  ClobAuth { address, timestamp, nonce, message }
 * and sends { signature, timestamp } here.
 * We build a stub signer whose _signTypedData returns that pre-computed signature,
 * then pass the same timestamp to createL1Headers so the headers match.
 */
export async function deriveL2Creds(
  signerAddress: string,   // EOA address (wallet)
  proxyAddress: string,    // Proxy wallet address (where Polymarket balance lives)
  nonce: number,
  l1Signature: string,
  timestamp: number
): Promise<L2Creds> {
  // POLY_ADDRESS header = getAddress() = signerAddress (EOA)
  // Server verifies: ecrecover(sig) == POLY_ADDRESS == EOA ✓
  // proxy wallet is used only as funderAddress in order creation
  const stubSigner = {
    address: signerAddress,
    getAddress: async () => signerAddress,
    _signTypedData: async () => l1Signature,
  };

  // Pass timestamp so createL1Headers uses the same ts the frontend signed
  // createOrDeriveApiKey(nonce) calls createApiKey which calls createL1Headers(signer, chainId, nonce, useServerTime ? serverTs : undefined)
  // We need to intercept the timestamp — use useServerTime=false (default) and pass ts via a workaround:
  // Override the internal createL1Headers call by using the lower-level approach.
  const { createL1Headers } = await import("@polymarket/clob-client");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const headers = await (createL1Headers as any)(stubSigner, CHAIN_ID, nonce, timestamp);

  // Call CLOB REST API directly with our pre-built headers
  const tryCreate = await fetch(`${CLOB_HOST}/auth/api-key`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
  });
  const createBody = await tryCreate.json();

  let creds;
  if (createBody?.apiKey) {
    creds = createBody;
  } else {
    // Fall back to derive
    const deriveRes = await fetch(`${CLOB_HOST}/auth/derive-api-key`, {
      method: "GET",
      headers,
    });
    creds = await deriveRes.json();
  }

  if (!creds?.apiKey) {
    throw new Error(creds?.error ?? "failed to derive API key");
  }

  return {
    apiKey: creds.apiKey,
    secret: creds.secret,
    passphrase: creds.passphrase,
  };
}

/**
 * Create a ClobClient authenticated with L2 creds (for order operations).
 * proxyAddress: the Polymarket proxy wallet address (used as POLY_ADDRESS header).
 */
export function createAuthenticatedClient(
  creds: L2Creds,
  proxyAddress: string,
  signerAddress: string
): ClobClient {
  // POLY_ADDRESS in L2 HMAC headers must match the address used to derive the API key (EOA).
  // proxyAddress goes only as funderAddress (6th param) so orders use proxy as maker.
  const stub = {
    address: signerAddress,
    getAddress: async () => signerAddress,
    _signTypedData: async () => { throw new Error("L1 sign not available"); },
  };
  return new ClobClient(
    CLOB_HOST,
    CHAIN_ID,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    stub as any,
    {
      key: creds.apiKey,
      secret: creds.secret,
      passphrase: creds.passphrase,
    },
    signerAddress.toLowerCase() === proxyAddress.toLowerCase()
      ? SignatureType.EOA
      : SignatureType.POLY_GNOSIS_SAFE,
    proxyAddress  // funderAddress: order maker = proxy wallet
  );
}

/**
 * Cancel an open order.
 */
export async function cancelOrder(
  creds: L2Creds,
  proxyAddress: string,
  signerAddress: string,
  orderId: string
): Promise<void> {
  const client = createAuthenticatedClient(creds, proxyAddress, signerAddress);
  await client.cancelOrder({ orderID: orderId });
}

/**
 * Fetch open orders for the authenticated user.
 */
export async function getOpenOrders(
  creds: L2Creds,
  proxyAddress: string,
  signerAddress: string
): Promise<unknown[]> {
  const client = createAuthenticatedClient(creds, proxyAddress, signerAddress);
  const orders = await client.getOpenOrders();
  return Array.isArray(orders) ? orders : [];
}

/**
 * Fetch the user's available USDC balance in the Polymarket CLOB system.
 * Returns amount in dollars (already divided by 1e6).
 */
export async function getBalance(creds: L2Creds & { proxyAddress?: string }): Promise<number> {
  const client = createAuthenticatedClient(creds, creds.proxyAddress!, creds.proxyAddress!);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resp = await (client as any).getBalanceAllowance({ asset_type: "COLLATERAL" });
  console.log("[getBalance] full response:", JSON.stringify(resp));
  const raw = resp?.balance ?? "0";
  return Number(raw) / 1e6;
}
