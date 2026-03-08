import { NextResponse } from "next/server";

/**
 * Standardized API error response with logging.
 * All API routes should use this for consistent error handling.
 */
export function apiError(route: string, message: string, status = 500, err?: unknown) {
  if (err) {
    console.error(`[api/${route}] ${message}:`, err);
  } else {
    console.error(`[api/${route}] ${message}`);
  }
  return NextResponse.json({ error: message }, { status });
}
