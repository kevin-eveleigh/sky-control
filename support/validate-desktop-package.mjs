import { access, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const dist = path.resolve("dist");

async function findApp(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const item = path.join(directory, entry.name);
    if (entry.isDirectory() && entry.name === "Sky Control.app") return item;
    if (entry.isDirectory()) {
      try {
        const nested = await findApp(item);
        if (nested) return nested;
      } catch {}
    }
  }
  return null;
}

const appPath = process.env.SKY_CONTROL_APP_PATH || (await findApp(dist));
if (!appPath) throw new Error("Packaged Sky Control.app was not found under dist/.");

const contents = path.join(appPath, "Contents");
const required = [
  path.join(contents, "MacOS", "Sky Control"),
  path.join(contents, "Resources", "app.asar"),
  path.join(contents, "Resources", "bridge", "server.js"),
  path.join(contents, "Resources", "bridge", "public"),
  path.join(contents, "Resources", "bridge", ".next", "static"),
  path.join(contents, "Resources", "bridge", "runtime_modules", "next", "package.json"),
  path.join(contents, "Resources", "desktop-assets", "trayTemplate.png"),
  path.join(contents, "Resources", "licenses", "Sky-Control-LICENSE.txt"),
  path.join(contents, "Resources", "licenses", "THIRD_PARTY_NOTICES.md"),
];
for (const item of required) await access(item);

const packagedServer = await readFile(path.join(contents, "Resources", "bridge", "server.js"), "utf8");
if (packagedServer.includes(process.cwd())) {
  throw new Error("Packaged bridge contains the local source-checkout path.");
}

const asarCli = path.join(
  process.cwd(),
  "desktop",
  "tooling",
  "node_modules",
  "@electron",
  "asar",
  "bin",
  "asar.js",
);
const asarList = spawnSync(process.execPath, [asarCli, "list", path.join(contents, "Resources", "app.asar")], {
  encoding: "utf8",
});
if (asarList.status !== 0) throw new Error(asarList.stderr || "Could not inspect the packaged app archive.");
if (asarList.stdout.split("\n").some((entry) => entry.startsWith("/desktop/tooling"))) {
  throw new Error("Packaged application contains desktop build tooling.");
}

async function rejectPersonalPath(directory) {
  const needles = [process.cwd(), os.homedir()].map((item) => Buffer.from(item));
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const item = path.join(directory, entry.name);
    if (entry.isDirectory()) await rejectPersonalPath(item);
    else if (entry.isFile()) {
      const file = await readFile(item);
      if (needles.some((needle) => file.includes(needle))) {
        throw new Error(`Packaged application contains a personal path: ${path.relative(contents, item)}`);
      }
    }
  }
}
await rejectPersonalPath(path.join(contents, "Resources"));

const plist = path.join(contents, "Info.plist");
const result = spawnSync("plutil", ["-extract", "LSUIElement", "raw", "-o", "-", plist], {
  encoding: "utf8",
});
if (result.status !== 0 || result.stdout.trim() !== "true") {
  throw new Error("Packaged application does not declare LSUIElement=true.");
}

async function rejectEnvironmentFile(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".env.local") throw new Error("Packaged application contains .env.local.");
    if (entry.isDirectory()) await rejectEnvironmentFile(path.join(directory, entry.name));
  }
}
await rejectEnvironmentFile(contents);

console.log(`Desktop package validation passed: ${appPath}`);
