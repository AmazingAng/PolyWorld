import { NextResponse } from "next/server";
import { readResolutionAlerts, getMonitorStatus } from "@/lib/resolutionSync";
import { apiError } from "@/lib/apiError";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const marketId = searchParams.get("marketId") || undefined;
    const alerts = readResolutionAlerts(marketId);

    const result: Record<string, unknown> = { alerts };
    if (marketId) {
      result.monitor = getMonitorStatus(marketId);
    }

    return NextResponse.json(result);
  } catch (err) {
    return apiError("resolution-alerts", "Failed to read resolution alerts", 500, err);
  }
}
