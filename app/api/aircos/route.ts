import { NextRequest, NextResponse } from "next/server";
import { addAirco } from "@/lib/airco/config";
import { publicSnapshot } from "@/lib/airco/store";
import type { AircoInput } from "@/lib/airco/types";
import { isAuthorized } from "@/lib/bridge-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(publicSnapshot());
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as AircoInput | null;
  if (!body) return NextResponse.json({ error: "Invalid airco" }, { status: 400 });
  try {
    const airco = addAirco(body);
    return NextResponse.json({ ...publicSnapshot(), addedId: airco.id }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not add airco" },
      { status: 400 },
    );
  }
}
