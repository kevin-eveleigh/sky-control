import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/bridge-auth";
import { createDiagnosticReport } from "@/lib/diagnostics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const deviceId = request.nextUrl.searchParams.get("aircoId") || undefined;
  const report = createDiagnosticReport(deviceId);
  if (deviceId && report.devices.length === 0) {
    return NextResponse.json({ error: "Airco not found" }, { status: 404 });
  }
  return NextResponse.json(report, {
    headers: { "Content-Disposition": 'attachment; filename="sky-control-diagnostics.json"' },
  });
}
