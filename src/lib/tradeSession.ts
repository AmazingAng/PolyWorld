import { randomUUID } from "crypto";
import type { L2Creds } from "@/lib/polymarketCLOB";

export interface TradeSession {
  sessionToken: string;
  address: string;
  proxyAddress: string;
}

interface TradeSessionRecord extends TradeSession {
  creds: L2Creds;
  createdAt: number;
  lastAccessedAt: number;
  expiresAt: number;
}

const SESSION_IDLE_TTL_MS = 30 * 60_000; // 30 minutes idle timeout
const SESSION_ABSOLUTE_TTL_MS = 8 * 60 * 60_000; // 8 hours absolute max lifetime

// Survive Next.js hot reloads by storing on globalThis
declare global { var _tradeSessions: Map<string, TradeSessionRecord> | undefined; }
const sessions: Map<string, TradeSessionRecord> =
  globalThis._tradeSessions ?? (globalThis._tradeSessions = new Map());

function cleanupExpiredSessions(now: number) {
  for (const [token, session] of sessions) {
    const absoluteExpiresAt = session.createdAt + SESSION_ABSOLUTE_TTL_MS;
    if (session.expiresAt <= now || absoluteExpiresAt <= now) {
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
    createdAt: now,
    lastAccessedAt: now,
    expiresAt: now + SESSION_IDLE_TTL_MS,
  });

  return {
    sessionToken,
    address: input.address,
    proxyAddress: input.proxyAddress,
  };
}

export function getTradeSession(
  sessionToken: string,
  options?: { extend?: boolean }
): TradeSessionRecord | null {
  const now = Date.now();
  cleanupExpiredSessions(now);

  const session = sessions.get(sessionToken);
  if (!session) return null;
  const absoluteExpiresAt = session.createdAt + SESSION_ABSOLUTE_TTL_MS;
  if (session.expiresAt <= now || absoluteExpiresAt <= now) {
    sessions.delete(sessionToken);
    return null;
  }

  session.lastAccessedAt = now;
  if (options?.extend) {
    session.expiresAt = Math.min(
      session.createdAt + SESSION_ABSOLUTE_TTL_MS,
      now + SESSION_IDLE_TTL_MS
    );
  }
  return session;
}

export function deleteTradeSession(sessionToken: string): void {
  sessions.delete(sessionToken);
}
