import { NextRequest, NextResponse } from "next/server";
import { findAirco } from "@/lib/airco/config";
import { probeStatus } from "@/lib/airco/client";
import {
  addLog,
  publicSnapshot,
  recordDiagnostics,
  updateReachability,
  updateState,
} from "@/lib/airco/store";
import { isAuthorized } from "@/lib/bridge-auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as
    | { aircoId?: unknown; background?: unknown }
    | null;
  if (!body || typeof body.aircoId !== "string") {
    return NextResponse.json({ error: "Airco is required" }, { status: 400 });
  }
  const airco = findAirco(body.aircoId);
  if (!airco) return NextResponse.json({ error: "Airco not found" }, { status: 404 });

  // The UI polls this endpoint continuously. A background poll only writes to
  // the log when something actually changed, so the activity feed stays a
  // record of events rather than a tick of identical status reads.
  const background = body.background === true;
  if (!background) addLog(airco.id, "info", "Reading device status…");

  const result = await probeStatus(airco.host, airco.port);
  const reachabilityChanged = updateReachability(airco.id, result.reachable);
  recordDiagnostics(airco.id, "status", result.summary, result.error);

  if (result.state) {
    updateState(airco.id, result.state);
    if (!background) addLog(airco.id, "success", "Status updated.");
    else if (reachabilityChanged) addLog(airco.id, "success", "Back online.");
  } else if (result.reachable) {
    if (!background || reachabilityChanged) {
      addLog(airco.id, "warning", "Connected, but no status frame was returned.");
    }
  } else if (!background || reachabilityChanged) {
    addLog(
      airco.id,
      "error",
      `Could not reach the unit${result.error ? ` (${result.error})` : "."}`,
    );
  }

  return NextResponse.json(publicSnapshot());
}
