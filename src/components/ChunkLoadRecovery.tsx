"use client";

import { useEffect } from "react";

const SESSION_KEY = "polyworld:chunk-reload-once";

/** One auto-reload per tab session when lazy chunks fail (deploy mismatch or flaky network). */
export default function ChunkLoadRecovery() {
  useEffect(() => {
    const reloadOnce = () => {
      if (sessionStorage.getItem(SESSION_KEY)) return;
      sessionStorage.setItem(SESSION_KEY, "1");
      window.location.reload();
    };

    const isChunkFailure = (msg: string) =>
      /ChunkLoadError|Loading chunk \d+|Failed to load chunk|Importing a module script failed/i.test(
        msg,
      );

    const onUnhandledRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason;
      const msg = typeof r?.message === "string" ? r.message : String(r ?? "");
      if (isChunkFailure(msg)) reloadOnce();
    };

    const onError = (e: ErrorEvent) => {
      const msg = e.message ?? "";
      if (isChunkFailure(msg)) reloadOnce();
    };

    window.addEventListener("unhandledrejection", onUnhandledRejection);
    window.addEventListener("error", onError);
    return () => {
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
      window.removeEventListener("error", onError);
    };
  }, []);

  return null;
}
