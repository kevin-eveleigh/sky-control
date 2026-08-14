import { access, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const metadata = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const required = [
  metadata.main,
  "desktop/assets/app-icon.png",
  "desktop/assets/trayTemplate.png",
  "THIRD_PARTY_NOTICES.md",
  ".next/desktop-standalone/server.js",
  ".next/desktop-standalone/public",
  ".next/desktop-standalone/.next/static",
  ".next/desktop-standalone/runtime_modules/next/package.json",
];
for (const item of required) await access(path.join(root, item));

const desktopServer = await readFile(path.join(root, ".next/desktop-standalone/server.js"), "utf8");
if (desktopServer.includes(root)) {
  throw new Error("Desktop standalone server contains the local source-checkout path.");
}

const desktopMain = await readFile(path.join(root, metadata.main), "utf8");
if (!desktopMain.includes('!app.isPackaged && process.env.SKY_CONTROL_DESKTOP_TEST_MODE === "1"')) {
  throw new Error("Desktop test hooks must be disabled in packaged applications.");
}

async function rejectPersonalPath(directory) {
  const needles = [root, os.homedir()].map((item) => Buffer.from(item));
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const item = path.join(directory, entry.name);
    if (entry.isDirectory()) await rejectPersonalPath(item);
    else if (entry.isFile()) {
      const contents = await readFile(item);
      if (needles.some((needle) => contents.includes(needle))) {
        throw new Error(`Desktop standalone payload contains a personal path: ${path.relative(root, item)}`);
      }
    }
  }
}
await rejectPersonalPath(path.join(root, ".next", "desktop-standalone"));

if (metadata.build?.mac?.extendInfo?.LSUIElement !== true) {
  throw new Error("Desktop packaging must set LSUIElement so no Dock icon is shown.");
}
if (metadata.build?.mac?.identity !== null) {
  throw new Error("Private beta packaging must not discover or use a signing identity.");
}
if (JSON.stringify(metadata.build?.extraResources || []).includes(".env.local")) {
  throw new Error("Desktop packaging must never include .env.local.");
}

async function modules(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const item = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await modules(item)));
    else if (entry.name.endsWith(".mjs")) result.push(item);
  }
  return result;
}

for (const modulePath of await modules(path.join(root, "desktop"))) {
  const result = spawnSync(process.execPath, ["--check", modulePath], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || `Syntax check failed: ${modulePath}`);
}

console.log("Desktop source and standalone bundle checks passed.");
