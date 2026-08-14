import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { effectiveToken } from "./settings";

/**
 * The access token is opt-in. Sky Control is meant to be installable on a home
 * machine without any setup ceremony, so with no token configured the API is
 * open to whoever can already reach the port. A token can be set from the
 * interface, or pinned with AIRCO_TOKEN.
 *
 * This is deliberately a LAN-trust model: the server binds to the local
 * network and must not be exposed to the internet without a token.
 */
export function isAuthRequired(): boolean {
  return effectiveToken().token !== null;
}

/** True when AIRCO_TOKEN pins the token, making it read-only in the interface. */
export function isAuthManagedByEnv(): boolean {
  return effectiveToken().source === "env";
}

export function isAuthorized(request: NextRequest): boolean {
  const { token } = effectiveToken();
  if (!token) return true;

  const supplied =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  const expectedBuffer = Buffer.from(token);
  const suppliedBuffer = Buffer.from(supplied);

  return (
    expectedBuffer.length === suppliedBuffer.length &&
    timingSafeEqual(expectedBuffer, suppliedBuffer)
  );
}
