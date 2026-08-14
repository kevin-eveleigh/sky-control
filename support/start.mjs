import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { isIP } from "node:net";

const host = process.env.SKY_CONTROL_HOST?.trim() || "0.0.0.0";
const port = process.env.SKY_CONTROL_PORT?.trim() || "3000";
const hostname = /^[a-z0-9.-]+$/i.test(host) && !host.startsWith("-") && !host.endsWith("-");
if (!isIP(host) && !hostname) {
  console.error("SKY_CONTROL_HOST must be an IP address or hostname.");
  process.exit(1);
}
if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
  console.error("SKY_CONTROL_PORT must be an integer between 1 and 65535.");
  process.exit(1);
}
if (!existsSync(".next/standalone/server.js")) {
  console.error("Production build not found. Run `npm run build` first.");
  process.exit(1);
}

const child = spawn(
  process.execPath,
  [".next/standalone/server.js"],
  {
    stdio: "inherit",
    env: { ...process.env, HOSTNAME: host, PORT: port },
  },
);
child.once("error", (error) => {
  console.error(`Could not start Sky Control (${error.code || "START_FAILED"}).`);
  process.exit(1);
});
child.once("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
