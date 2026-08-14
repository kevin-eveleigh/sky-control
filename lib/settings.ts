import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getBridgeConfig } from "./bridge/config";

export { MIN_TOKEN_LENGTH } from "./bridge/constants";

type SettingsFile = { version: 1; token: string | null };

function settingsPath(): string {
  return getBridgeConfig().settingsPath;
}

function readSettings(): SettingsFile {
  const target = settingsPath();
  if (!existsSync(target)) return { version: 1, token: null };
  try {
    const parsed = JSON.parse(readFileSync(target, "utf8")) as Partial<SettingsFile>;
    const token =
      typeof parsed.token === "string" && parsed.token.trim()
        ? parsed.token.trim()
        : null;
    return { version: 1, token };
  } catch {
    // A damaged settings file must not lock the interface out of its own
    // configuration, so fall back to no token rather than throwing.
    return { version: 1, token: null };
  }
}

export function saveToken(token: string | null): void {
  const target = settingsPath();
  mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.new`;
  writeFileSync(
    temporary,
    `${JSON.stringify({ version: 1, token } satisfies SettingsFile, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  renameSync(temporary, target);
}

export type TokenSource = "env" | "file" | "none";

/**
 * AIRCO_TOKEN wins when present. An operator who pinned the token in the
 * environment should not have it silently overridden from a web form, so the
 * interface reports that case as read-only instead.
 */
export function effectiveToken(): { token: string | null; source: TokenSource } {
  const fromEnv = getBridgeConfig().token;
  if (fromEnv) return { token: fromEnv, source: "env" };
  const { token } = readSettings();
  return token ? { token, source: "file" } : { token: null, source: "none" };
}
