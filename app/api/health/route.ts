import { NextResponse } from "next/server";
import { PROJECT } from "@/lib/project";

/** Local readiness only; deliberately performs no discovery or device I/O. */
export function GET() {
  return NextResponse.json(
    { status: "ok", name: PROJECT.name, version: PROJECT.version },
    { headers: { "Cache-Control": "no-store" } },
  );
}
