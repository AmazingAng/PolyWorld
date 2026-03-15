import { randomUUID } from "crypto";
import type { L2Creds } from "@/lib/polymarketCLOB";

export interface TradeSession {
  sessionToken: string;
  address: string;
  proxyAddress: string;
}

interface TradeSessionRecord extends TradeSession {
  creds: L2Creds;
  expiresAt: number;
}

const SESSION_TTL_MS = 30 * 60_000;

// Survive Next.js hot reloads by storing on globalThis
declare global { var _tradeSessions: Map<string, TradeSessionRecord> | undefined; }
const sessions: Map<string, TradeSessionRecord> =
  globalThis._tradeSessions ?? (globalThis._tradeSessions = new Map());

function cleanupExpiredSessions(now: number) {
  for (const [token, session] of sessions) {
    if (session.expiresAt <= now) {
      sessions.delete(token);
    }
  }
}

export function createTradeSession(input: {
  address: string;
  proxyAddress: string;
  creds: L2Creds;
}): TradeSession {
  const now = Date.now();
  cleanupExpiredSessions(now);

  const sessionToken = randomUUID();
  sessions.set(sessionToken, {
    sessionToken,
    address: input.address,
    proxyAddress: input.proxyAddress,
    creds: input.creds,
    expiresAt: now + SESSION_TTL_MS,
  });

  return {
    sessionToken,
    address: input.address,
    proxyAddress: input.proxyAddress,
  };
}

export function getTradeSession(sessionToken: string): TradeSessionRecord | null {
  const now = Date.now();
  cleanupExpiredSessions(now);

  const session = sessions.get(sessionToken);
  if (!session) return null;
  if (session.expiresAt <= now) {
    sessions.delete(sessionToken);
    return null;
  }

  session.expiresAt = now + SESSION_TTL_MS;
  return session;
}

export function deleteTradeSession(sessionToken: string): void {
  sessions.delete(sessionToken);
}
