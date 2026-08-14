import { NextRequest, NextResponse } from "next/server";
import { getAircos, refreshKnownDevices } from "@/lib/airco/config";
import { discoverDevices } from "@/lib/airco/discovery";
import {
  addLog,
  publicSnapshot,
  recordDiagnostics,
  updateReachability,
} from "@/lib/airco/store";
import { isAuthorized } from "@/lib/bridge-auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const configured = getAircos();
    configured.forEach((airco) => addLog(airco.id, "info", "Scanning the local network…"));
    const devices = await discoverDevices();
    const updated = refreshKnownDevices(devices);
    updated.forEach((airco) => {
      recordDiagnostics(airco.id, "discovery", null);
      const found = devices.some(
        (device) =>
          device.host === airco.host ||
          (airco.mac && device.mac?.toLowerCase() === airco.mac.toLowerCase()),
      );
      if (found) {
        updateReachability(airco.id, true);
        addLog(airco.id, "success", "Found a compatible module.");
      }
    });
    return NextResponse.json({ ...publicSnapshot(), discovered: devices });
  } catch {
    getAircos().forEach((airco) =>
      recordDiagnostics(airco.id, "discovery", null, "DISCOVERY_FAILED"),
    );
    return NextResponse.json({ error: "Discovery failed on this network" }, { status: 500 });
  }
}
