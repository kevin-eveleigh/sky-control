import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_CONTROL_PORT, identifyDevice } from "@/lib/airco/discovery";
import { isAuthorized } from "@/lib/bridge-auth";
import { normalizeNetworkHost } from "@/lib/network";

export const runtime = "nodejs";

/**
 * Checks a typed-in address before it is saved. This is the add-by-address
 * counterpart of /api/discover: it only asks the unit to identify itself and
 * never opens a control session or sends a command.
 */
export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as
    | { host?: unknown; port?: unknown }
    | null;

  let host: string;
  try {
    host = normalizeNetworkHost(body?.host, "IP address or hostname");
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
  const port = body?.port === undefined ? DEFAULT_CONTROL_PORT : Number(body.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return NextResponse.json({ error: "Port must be between 1 and 65535" }, { status: 400 });
  }

  try {
    const device = await identifyDevice(host, { controlPort: port });
    if (!device) {
      return NextResponse.json(
        { error: `No compatible module answered at ${host}.` },
        { status: 404 },
      );
    }
    return NextResponse.json({ device });
  } catch {
    return NextResponse.json(
      { error: `Could not reach ${host} from the bridge.` },
      { status: 502 },
    );
  }
}
