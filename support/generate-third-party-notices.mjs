import { access, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const runtimeModules = path.join(root, ".next", "desktop-standalone", "runtime_modules");
const destination = path.join(root, "THIRD_PARTY_NOTICES.md");
const checkOnly = process.argv.includes("--check");
const lockfile = JSON.parse(await readFile(path.join(root, "package-lock.json"), "utf8"));

function lockedPackage(packageName) {
  const entry = lockfile.packages[`node_modules/${packageName}`];
  if (!entry) throw new Error(`${packageName} is missing from package-lock.json.`);
  return entry;
}

// npm only installs the prebuilt binaries that match the build host, so tracing them from
// runtime_modules would make the notices differ on every platform. They are listed from the
// lockfile instead, using the macOS variants the desktop bundle can actually ship.
function isPlatformBinary(packageName) {
  const entry = lockfile.packages[`node_modules/${packageName}`];
  return Boolean(entry?.os || entry?.cpu);
}

function usableOnMacos(entry) {
  if (entry.os && !entry.os.includes("darwin")) return false;
  if (entry.cpu && !entry.cpu.includes("arm64") && !entry.cpu.includes("x64")) return false;
  return true;
}

function resolveDependency(fromKey, name) {
  let scope = fromKey;
  for (;;) {
    const candidate = scope ? `${scope}/node_modules/${name}` : `node_modules/${name}`;
    if (lockfile.packages[candidate]) return candidate;
    if (!scope) return undefined;
    const parent = scope.lastIndexOf("/node_modules/");
    scope = parent === -1 ? "" : scope.slice(0, parent);
  }
}

// npm 10 also installs the dependencies of optional packages it skipped for the host
// platform, which npm 11 prunes, so a traced bundle can carry wasm-only fallbacks that
// macOS never loads. Listing only what a macOS install can reach keeps the notices the
// same whichever npm version built the bundle.
function macosReachableNames() {
  const dependencyNames = (entry) => [
    ...Object.keys(entry.dependencies || {}),
    ...Object.keys(entry.optionalDependencies || {}),
    ...Object.keys(entry.peerDependencies || {}),
    ...Object.keys(entry.devDependencies || {}),
  ];
  const queue = dependencyNames(lockfile.packages[""]).map((name) => resolveDependency("", name));
  const visited = new Set();
  while (queue.length > 0) {
    const key = queue.pop();
    if (!key || visited.has(key)) continue;
    const entry = lockfile.packages[key];
    if (!entry || !usableOnMacos(entry)) continue;
    visited.add(key);
    for (const name of dependencyNames(entry)) queue.push(resolveDependency(key, name));
  }
  return new Set(
    [...visited].map((key) => key.slice(key.lastIndexOf("node_modules/") + "node_modules/".length)),
  );
}

function macosBinaryNames() {
  return Object.keys(lockfile.packages)
    .filter((key) => key.startsWith("node_modules/@img/"))
    .map((key) => key.slice("node_modules/".length))
    .filter((name) => {
      const entry = lockedPackage(name);
      return entry.os?.length === 1 && entry.os[0] === "darwin";
    });
}

function bundledLicenseName(packageName) {
  return packageName.startsWith("@img/sharp-libvips-") ? "LGPL-3.0-or-later" : "Apache-2.0";
}

function normalizeLicenseText(text) {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

async function packageDirectories(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const item = path.join(directory, entry.name);
    if (entry.name.startsWith("@")) result.push(...(await packageDirectories(item)));
    else {
      try {
        await access(path.join(item, "package.json"));
        result.push(item);
      } catch {}
    }
  }
  return result;
}

async function firstLicenseFile(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /^licen[cs]e(?:[._-].*)?$/i.test(entry.name))
    .map((entry) => path.join(directory, entry.name))
    .sort()[0];
}

async function licensePath(packageName, sourceDirectory) {
  const own = await firstLicenseFile(sourceDirectory);
  if (own) return own;
  if (packageName === "@next/env") return path.join(root, "node_modules", "next", "license.md");
  if (packageName === "client-only") return path.join(root, "node_modules", "react", "LICENSE");
  throw new Error(`No distributable license text was found for ${packageName}.`);
}

async function packageNotice(runtimeDirectory) {
  const runtimePackage = JSON.parse(await readFile(path.join(runtimeDirectory, "package.json"), "utf8"));
  const sourceDirectory = path.join(root, "node_modules", ...runtimePackage.name.split("/"));
  const sourcePackage = JSON.parse(await readFile(path.join(sourceDirectory, "package.json"), "utf8"));
  const licenseFile = await licensePath(runtimePackage.name, sourceDirectory);
  const licenseText = normalizeLicenseText(await readFile(licenseFile, "utf8"));
  return {
    name: runtimePackage.name,
    version: runtimePackage.version,
    license: sourcePackage.license || "See included license text",
    licenseText,
  };
}

await access(runtimeModules);
const reachable = macosReachableNames();
const tracedDirectories = [];
for (const directory of await packageDirectories(runtimeModules)) {
  const traced = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"));
  if (isPlatformBinary(traced.name)) continue;
  if (lockfile.packages[`node_modules/${traced.name}`] && !reachable.has(traced.name)) continue;
  tracedDirectories.push(directory);
}
const notices = await Promise.all(tracedDirectories.map(packageNotice));
for (const name of macosBinaryNames()) {
  const locked = lockedPackage(name);
  notices.push({
    name,
    version: locked.version,
    license: locked.license || "See included license text",
    licenseText: normalizeLicenseText(
      await readFile(
        path.join(root, "support", "licenses", `${bundledLicenseName(name)}.txt`),
        "utf8",
      ),
    ),
  });
}
const desktopTooling = JSON.parse(
  await readFile(path.join(root, "desktop", "tooling", "package.json"), "utf8"),
);
notices.push({
  name: "electron",
  version: desktopTooling.devDependencies.electron,
  license: "MIT",
  licenseText: normalizeLicenseText(
    await readFile(path.join(root, "support", "licenses", "Electron-LICENSE.txt"), "utf8"),
  ),
});
notices.sort((left, right) =>
  `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`),
);

const body = [
  "# Third-party notices",
  "",
  "<!-- Generated by support/generate-third-party-notices.mjs. Do not edit manually. -->",
  "",
  "Sky Control is distributed under the MIT License. The desktop bundle also",
  "contains the runtime packages listed below. Each package's distributed license",
  "text is reproduced with its declared package version and licence ID. The macOS",
  "prebuilt image binaries are listed for both Apple silicon and Intel so that this",
  "file stays identical whichever machine produced the build.",
  "Electron additionally ships its Chromium and Node.js notices inside the app",
  "bundle as `LICENSES.chromium.html` and related runtime licence files.",
  "",
  // The icon artwork is not an npm package, so it cannot be traced from the bundle. It is
  // listed here by hand because the app, tray, and favicon assets built from it do ship.
  "## Icon artwork",
  "",
  "Declared license: CC Attribution",
  "",
  "```text",
  "Snow Snowflake Winter SVG Vector icon by Ruslan Mullakaev",
  "(https://dribbble.com/ruslan_design) in CC Attribution License",
  "via SVG Repo (https://www.svgrepo.com/).",
  "",
  "Used for the Sky Control app icon, menu-bar tray icon, and favicon.",
  "```",
  "",
  ...notices.flatMap((notice) => [
    `## ${notice.name} ${notice.version}`,
    "",
    `Declared license: ${notice.license}`,
    "",
    "```text",
    notice.licenseText,
    "```",
    "",
  ]),
].join("\n");

function packageHeadings(text) {
  const headings = [];
  let insideFence = false;
  for (const line of text.split("\n")) {
    if (line.startsWith("```")) insideFence = !insideFence;
    else if (!insideFence && line.startsWith("## ")) headings.push(line.slice(3));
  }
  return headings;
}

function firstDifference(current, generated) {
  const currentLines = current.split("\n");
  const generatedLines = generated.split("\n");
  for (let index = 0; index < Math.max(currentLines.length, generatedLines.length); index += 1) {
    if (currentLines[index] === generatedLines[index]) continue;
    return [
      `First difference at line ${index + 1}:`,
      `  committed: ${JSON.stringify(currentLines[index] ?? "<end of file>")}`,
      `  generated: ${JSON.stringify(generatedLines[index] ?? "<end of file>")}`,
    ].join("\n");
  }
  return "";
}

if (checkOnly) {
  const current = await readFile(destination, "utf8").catch(() => "");
  if (current !== body) {
    const committed = packageHeadings(current);
    const generated = packageHeadings(body);
    const details = [
      `Packaged runtime on ${process.platform}-${process.arch}, Node ${process.versions.node}.`,
      `Added by this build: ${generated.filter((item) => !committed.includes(item)).join(", ") || "none"}`,
      `Absent from this build: ${committed.filter((item) => !generated.includes(item)).join(", ") || "none"}`,
      firstDifference(current, body),
    ].filter(Boolean);
    throw new Error(
      ["THIRD_PARTY_NOTICES.md is stale. Run npm run desktop:notices after building.", ...details].join("\n"),
    );
  }
  console.log("Third-party notices match the packaged runtime.");
} else {
  await writeFile(destination, body, "utf8");
  console.log(`Generated notices for ${notices.length} packaged runtime dependencies.`);
}
