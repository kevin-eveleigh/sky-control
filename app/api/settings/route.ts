import { NextRequest, NextResponse } from "next/server";
import { publicSnapshot } from "@/lib/airco/store";
import { isAuthManagedByEnv, isAuthorized } from "@/lib/bridge-auth";
import { MIN_TOKEN_LENGTH, saveToken } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(publicSnapshot());
}

/**
 * Sets or clears the access token. Note the ordering the client depends on:
 * the caller must be authorised under the *current* token, and only then may
 * it install a new one — so changing the token cannot be used to bypass it.
 */
export async function PUT(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (isAuthManagedByEnv()) {
    return NextResponse.json(
      { error: "The token is pinned by AIRCO_TOKEN and cannot be changed here." },
      { status: 409 },
    );
  }

  const body = (await request.json().catch(() => null)) as { token?: unknown } | null;
  if (!body || !("token" in body)) {
    return NextResponse.json({ error: "A token value is required" }, { status: 400 });
  }
  if (body.token !== null && typeof body.token !== "string") {
    return NextResponse.json({ error: "Invalid token" }, { status: 400 });
  }

  const token = typeof body.token === "string" ? body.token.trim() : null;
  if (token !== null && token.length < MIN_TOKEN_LENGTH) {
    return NextResponse.json(
      { error: `Use at least ${MIN_TOKEN_LENGTH} characters.` },
      { status: 400 },
    );
  }

  saveToken(token);
  return NextResponse.json(publicSnapshot());
}
