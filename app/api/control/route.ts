import { NextRequest, NextResponse } from "next/server";
import { findAirco } from "@/lib/airco/config";
import { sendControl } from "@/lib/airco/client";
import { parseControlEnvelope } from "@/lib/airco/control-request";
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

  const body: unknown = await request.json().catch(() => null);
  const envelope = parseControlEnvelope(body);
  if (!envelope) {
    return NextResponse.json({ error: "Invalid control request" }, { status: 400 });
  }
  const airco = findAirco(envelope.aircoId);
  if (!airco) return NextResponse.json({ error: "Airco not found" }, { status: 404 });

  const { control } = envelope;
  addLog(airco.id, "info", `Sending ${control.action} command…`);
  const result = await sendControl(airco.host, airco.port, control);
  updateReachability(airco.id, result.reachable);
  recordDiagnostics(
    airco.id,
    `control:${control.action}`,
    result.summary,
    result.error,
  );

  if (!result.reachable || !result.state) {
    addLog(airco.id, "error", "The unit did not acknowledge the control command.");
    return NextResponse.json(
      { error: "No valid acknowledgement received", snapshot: publicSnapshot() },
      { status: 502 },
    );
  }

  // `confirmed` means the frame arrived after the command was written. An
  // unconfirmed frame is the pre-command echo — storing it would roll the UI
  // back to the values the user just changed.
  if (!result.confirmed) {
    addLog(
      airco.id,
      "warning",
      `${control.action} command sent, but the unit did not report back in time.`,
    );
    return NextResponse.json({ ...publicSnapshot(), confirmed: false });
  }

  updateState(airco.id, result.state);
  addLog(airco.id, "success", `${control.action} command acknowledged.`);
  return NextResponse.json({ ...publicSnapshot(), confirmed: true });
}
