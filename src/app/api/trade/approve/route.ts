/**
 * Gasless USDC.e + CTF approval for proxy wallet (Gnosis Safe) via Polymarket relayer.
 *
 * POST /api/trade/approve  { sessionToken, prepare: true } → { hash, safeAddress, nonce }
 *   Server fetches relayer nonce, builds batch approval txns, returns SafeTx struct hash.
 *   Client signs hash with personal_sign (signMessage raw), then calls POST again.
 *
 * POST /api/trade/approve  { sessionToken, signature, nonce } → { transactionId }
 *   Server rebuilds request, attaches signature, submits to relayer with builder HMAC.
 */
import { NextRequest, NextResponse } from "next/server";
import { getTradeSession } from "@/lib/tradeSession";
import {
  encodeFunctionData, maxUint256, hashTypedData, zeroAddress,
  encodePacked, concatHex, size,
} from "viem";
import { buildHmacSignature } from "@polymarket/builder-signing-sdk";

// ── Contract addresses ──────────────────────────────────────────────────────
const USDC_E          = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
const CTF             = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045";
const EXCHANGE        = "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E";
const NEG_RISK_EX     = "0xC5d563A36AE78145C45a50134d48A1215220f80a";
const NEG_RISK_ADAPTER= "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296";

// ── Relayer / Safe infrastructure ───────────────────────────────────────────
const RELAYER_URL     = "https://relayer-v2.polymarket.com";
const CHAIN_ID        = 137;
const SAFE_MULTISEND  = "0xA238CBeb142c10Ef7Ad8442C6D1f9E89e07e7761";

// ── ABIs ────────────────────────────────────────────────────────────────────
const ERC20_ABI = [{
  name: "approve", type: "function", stateMutability: "nonpayable",
  inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
  outputs: [{ type: "bool" }],
}] as const;

const ERC1155_ABI = [{
  name: "setApprovalForAll", type: "function", stateMutability: "nonpayable",
  inputs: [{ name: "operator", type: "address" }, { name: "approved", type: "bool" }],
  outputs: [],
}] as const;

const MULTISEND_ABI = [{
  name: "multiSend", type: "function", stateMutability: "payable",
  inputs: [{ name: "transactions", type: "bytes" }],
  outputs: [],
}] as const;

// ── Helpers ──────────────────────────────────────────────────────────────────


interface SimpleTx { to: `0x${string}`; data: `0x${string}`; value: string; operation: 0 | 1; }

function buildApprovalTxns(): SimpleTx[] {
  const approve = (spender: string) => encodeFunctionData({
    abi: ERC20_ABI, functionName: "approve",
    args: [spender as `0x${string}`, maxUint256],
  });
  const approveAll = (operator: string) => encodeFunctionData({
    abi: ERC1155_ABI, functionName: "setApprovalForAll",
    args: [operator as `0x${string}`, true],
  });
  return [
    // USDC.e → 4 spenders
    { to: USDC_E as `0x${string}`, data: approve(EXCHANGE),         value: "0", operation: 0 },
    { to: USDC_E as `0x${string}`, data: approve(NEG_RISK_EX),      value: "0", operation: 0 },
    { to: USDC_E as `0x${string}`, data: approve(NEG_RISK_ADAPTER), value: "0", operation: 0 },
    { to: USDC_E as `0x${string}`, data: approve(CTF),              value: "0", operation: 0 },
    // CTF ERC-1155 → 3 operators
    { to: CTF as `0x${string}`, data: approveAll(EXCHANGE),         value: "0", operation: 0 },
    { to: CTF as `0x${string}`, data: approveAll(NEG_RISK_EX),      value: "0", operation: 0 },
    { to: CTF as `0x${string}`, data: approveAll(NEG_RISK_ADAPTER), value: "0", operation: 0 },
  ];
}

function buildMultisend(txns: SimpleTx[]): { to: `0x${string}`; data: `0x${string}`; value: string; operation: 1 } {
  const encoded = concatHex(
    txns.map(tx => encodePacked(
      ["uint8", "address", "uint256", "uint256", "bytes"],
      [tx.operation, tx.to, BigInt(tx.value), BigInt(size(tx.data)), tx.data]
    ))
  );
  return {
    to: SAFE_MULTISEND as `0x${string}`,
    data: encodeFunctionData({ abi: MULTISEND_ABI, functionName: "multiSend", args: [encoded] }),
    value: "0",
    operation: 1, // DelegateCall
  };
}

function computeSafeTxHash(safeAddress: string, tx: ReturnType<typeof buildMultisend>, nonce: string): `0x${string}` {
  return hashTypedData({
    primaryType: "SafeTx",
    domain: { chainId: CHAIN_ID, verifyingContract: safeAddress as `0x${string}` },
    types: {
      SafeTx: [
        { name: "to",              type: "address" },
        { name: "value",           type: "uint256" },
        { name: "data",            type: "bytes"   },
        { name: "operation",       type: "uint8"   },
        { name: "safeTxGas",       type: "uint256" },
        { name: "baseGas",         type: "uint256" },
        { name: "gasPrice",        type: "uint256" },
        { name: "gasToken",        type: "address" },
        { name: "refundReceiver",  type: "address" },
        { name: "nonce",           type: "uint256" },
      ],
    },
    message: {
      to: tx.to, value: BigInt(tx.value), data: tx.data,
      operation: tx.operation,
      safeTxGas: BigInt(0), baseGas: BigInt(0), gasPrice: BigInt(0),
      gasToken: zeroAddress, refundReceiver: zeroAddress,
      nonce: BigInt(nonce),
    },
  });
}

function splitAndPackSig(sig: string): string {
  // Convert personal_sign v (27/28) to Gnosis Safe eth_sign v (31/32)
  let v = parseInt(sig.slice(-2), 16);
  if (v === 27 || v === 28) v += 4;
  else if (v === 0 || v === 1) v += 31;
  return sig.slice(0, -2) + v.toString(16).padStart(2, "0");
}

async function builderHeaders(method: string, path: string, body?: string): Promise<Record<string, string>> {
  const ts = Math.floor(Date.now() / 1000);
  const sig = buildHmacSignature(process.env.POLY_BUILDER_SECRET!, ts, method, path, body ?? "");
  return {
    "POLY_BUILDER_SIGNATURE": sig,
    "POLY_BUILDER_TIMESTAMP": String(ts),
    "POLY_BUILDER_API_KEY":   process.env.POLY_BUILDER_API_KEY!,
    "POLY_BUILDER_PASSPHRASE":process.env.POLY_BUILDER_PASSPHRASE!,
  };
}

// ── POST: prepare (prepare=true) or submit signed tx to relayer ─────────────

export async function POST(req: NextRequest) {
  const { sessionToken, prepare, signature, nonce } = await req.json();

  // Phase 1: compute SafeTx struct hash (replaces former GET endpoint)
  if (prepare) {
    if (!sessionToken) return NextResponse.json({ error: "sessionToken required" }, { status: 400 });
    const session = getTradeSession(sessionToken);
    if (!session) return NextResponse.json({ error: "invalid or expired session" }, { status: 401 });

    if (session.address.toLowerCase() === session.proxyAddress.toLowerCase()) {
      return NextResponse.json({ error: "EOA accounts do not use Safe approval" }, { status: 400 });
    }

    try {
      const eoa        = session.address;
      const safeAddress = session.proxyAddress; // use the confirmed proxy, not a re-derived guess
      const nonceRes = await fetch(`${RELAYER_URL}/nonce?address=${eoa}&type=SAFE`);
      const { nonce: safeNonce } = await nonceRes.json() as { nonce: string };
      const txns  = buildApprovalTxns();
      const multi = buildMultisend(txns);
      const hash  = computeSafeTxHash(safeAddress, multi, safeNonce);
      return NextResponse.json({ hash, safeAddress, nonce: safeNonce });
    } catch (e) {
      console.error("[approve prepare]", e);
      return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
    }
  }

  // Phase 2: submit signed tx to relayer
  if (!sessionToken || !signature) {
    return NextResponse.json({ error: "sessionToken and signature required" }, { status: 400 });
  }

  const session = getTradeSession(sessionToken);
  if (!session) return NextResponse.json({ error: "invalid or expired session" }, { status: 401 });

  if (session.address.toLowerCase() === session.proxyAddress.toLowerCase()) {
    return NextResponse.json({ error: "EOA accounts do not use Safe approval" }, { status: 400 });
  }

  try {
    const eoa         = session.address;
    const safeAddress = session.proxyAddress; // use the confirmed proxy, not a re-derived guess

    const txns  = buildApprovalTxns();
    const multi = buildMultisend(txns);
    const packedSig = splitAndPackSig(signature);

    const body = JSON.stringify({
      from:        eoa,
      to:          multi.to,
      proxyWallet: safeAddress,
      data:        multi.data,
      nonce,
      signature:   packedSig,
      signatureParams: {
        gasPrice:     "0",
        operation:    `${multi.operation}`,
        safeTxnGas:   "0",
        baseGas:      "0",
        gasToken:     zeroAddress,
        refundReceiver: zeroAddress,
      },
      type: "SAFE",
      metadata: "Approve USDC.e and CTF for Polymarket trading",
    });

    const path = "/submit";
    const headers = await builderHeaders("POST", path, body);
    const res = await fetch(`${RELAYER_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body,
    });

    const data = await res.json() as Record<string, unknown>;
    if (!res.ok) {
      console.error("[approve POST] relayer error:", data);
      return NextResponse.json({ error: JSON.stringify(data) }, { status: res.status });
    }

    return NextResponse.json({ transactionId: data.transactionID ?? data.id, state: data.state });
  } catch (e) {
    console.error("[approve POST]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
