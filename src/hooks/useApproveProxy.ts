"use client";

import { useCallback, useState } from "react";
import { useSignMessage } from "wagmi";
import { setApprovedFlag } from "@/lib/tradeAuth";

export type ApproveStatus = "idle" | "preparing" | "signing" | "submitting" | "done" | "error";

export function useApproveProxy() {
  const { signMessageAsync } = useSignMessage();
  const [status, setStatus] = useState<ApproveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [txId, setTxId] = useState<string | null>(null);

  // Call this when we know on a page load that approval is already done
  const markDone = useCallback(() => setStatus("done"), []);

  const approve = useCallback(async (sessionToken: string, proxyAddress: string) => {
    setStatus("preparing");
    setError(null);

    try {
      // Step 1: server computes SafeTx hash
      const prepRes = await fetch("/api/trade/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionToken, prepare: true }),
      });
      const prepData = await prepRes.json() as { hash: `0x${string}`; nonce: string; error?: string };
      if (!prepRes.ok || prepData.error) throw new Error(prepData.error ?? "prepare failed");

      // Step 2: user signs the struct hash (personal_sign / eth_sign)
      setStatus("signing");
      const signature = await signMessageAsync({ message: { raw: prepData.hash } });

      // Step 3: server submits to relayer
      setStatus("submitting");
      const submitRes = await fetch("/api/trade/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionToken, signature, nonce: prepData.nonce }),
      });
      const submitData = await submitRes.json() as { transactionId?: string; state?: string; error?: string };
      if (!submitRes.ok || submitData.error) throw new Error(submitData.error ?? "submit failed");

      setTxId(submitData.transactionId ?? null);
      setStatus("done");
      setApprovedFlag(proxyAddress); // persist so we skip the button on next page load
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : "approval failed");
    }
  }, [signMessageAsync]);

  return { approve, status, error, txId, markDone };
}
