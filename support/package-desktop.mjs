import { spawnSync } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function run(command, args, environment = process.env) {
  const result = spawnSync(command, args, { cwd: root, env: environment, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(npmCommand, ["run", "build"]);
run(process.execPath, [path.join("support", "generate-third-party-notices.mjs")]);
run(process.execPath, [path.join("support", "build-desktop-assets.mjs")]);
run(process.execPath, [path.join("support", "check-desktop.mjs")]);
run(
  process.execPath,
  [
    path.join("desktop", "tooling", "node_modules", "electron-builder", "out", "cli", "cli.js"),
    "--mac",
    "dmg",
    "zip",
  ],
  { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false" },
);
run(process.execPath, [path.join("support", "validate-desktop-package.mjs")]);
