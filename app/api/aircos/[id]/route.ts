import { NextRequest, NextResponse } from "next/server";
import { removeAirco, updateAirco } from "@/lib/airco/config";
import { publicSnapshot, removeRuntime } from "@/lib/airco/store";
import type { AircoInput } from "@/lib/airco/types";
import { isAuthorized } from "@/lib/bridge-auth";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as AircoInput | null;
  if (!body) return NextResponse.json({ error: "Invalid airco" }, { status: 400 });
  try {
    updateAirco(id, body);
    return NextResponse.json(publicSnapshot());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not update airco" },
      { status: 400 },
    );
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await context.params;
  if (!removeAirco(id)) {
    return NextResponse.json({ error: "Airco not found" }, { status: 404 });
  }
  removeRuntime(id);
  return NextResponse.json(publicSnapshot());
}
