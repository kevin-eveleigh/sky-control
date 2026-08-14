import { existsSync, readFileSync } from "node:fs";

const envFile = new URL(".env.local", import.meta.url);
const envText = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
for (const rawLine of envText.split(/\r?\n/)) {
  const line = rawLine.trim();
  if (!line || line.startsWith("#")) continue;
  const separator = line.indexOf("=");
  if (separator < 1) continue;
  const key = line.slice(0, separator).trim();
  const value = line.slice(separator + 1).trim();
  if (!(key in process.env)) process.env[key] = value;
}

process.env.NODE_ENV = "production";
process.env.HOSTNAME = process.env.SKY_CONTROL_HOST || process.env.HOSTNAME || "0.0.0.0";
process.env.PORT = process.env.SKY_CONTROL_PORT || process.env.PORT || "3000";

await import("./server.js");
