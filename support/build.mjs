import { cpSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const result = spawnSync(
  process.execPath,
  ["node_modules/next/dist/bin/next", "build", "--webpack"],
  { stdio: "inherit", env: process.env },
);
if (result.error) {
  console.error(`Could not run the Next.js build (${result.error.code || "BUILD_FAILED"}).`);
  process.exit(1);
}
if (result.status !== 0) process.exit(result.status ?? 1);

const standalone = ".next/standalone";
if (!existsSync(`${standalone}/server.js`)) {
  console.error("Next.js did not create the expected standalone server.");
  process.exit(1);
}
cpSync("public", `${standalone}/public`, { recursive: true, force: true });
cpSync(".next/static", `${standalone}/.next/static`, { recursive: true, force: true });
