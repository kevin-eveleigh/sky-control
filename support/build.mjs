import { cpSync, existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const result = spawnSync(
  process.execPath,
  ["node_modules/next/dist/bin/next", "build", "--webpack"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      // Runtime configuration is supplied when the standalone server starts.
      // Neutral build-time values prevent a developer's .env.local household
      // details from being serialized into distributable Next.js output.
      AIRCO_TOKEN: "",
      AIRCO_HOST: "",
      AIRCO_PORT: "1998",
      AIRCO_CONFIG_PATH: "data/aircos.json",
      AIRCO_SETTINGS_PATH: "data/settings.json",
      SKY_CONTROL_HOST: "0.0.0.0",
      SKY_CONTROL_PORT: "3000",
      SKY_CONTROL_ALLOWED_DEV_ORIGINS: "",
    },
  },
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

// electron-builder deliberately filters directories named node_modules from
// extraResources. Keep the ordinary standalone folder for the LaunchAgent and
// create an equivalent desktop payload under a neutral traced-module name.
const desktopStandalone = ".next/desktop-standalone";
cpSync(standalone, desktopStandalone, { recursive: true, force: true });
renameSync(`${desktopStandalone}/node_modules`, `${desktopStandalone}/runtime_modules`);
const desktopServer = `${desktopStandalone}/server.js`;
const desktopServerSource = readFileSync(desktopServer, "utf8");
const requireDeclaration = "const require = module.createRequire(import.meta.url)";
if (!desktopServerSource.includes(requireDeclaration)) {
  console.error("Next.js standalone server structure changed; desktop module resolution patch was not applied.");
  process.exit(1);
}
writeFileSync(
  desktopServer,
  desktopServerSource.replace(requireDeclaration, `module._initPaths()\n${requireDeclaration}`),
);

// Next.js serializes build roots and resolved source filenames into generated
// server chunks and manifests. They are not needed at runtime and would expose
// the builder's personal checkout path in a distributed app.
const textExtensions = new Set([".body", ".html", ".js", ".json", ".map", ".rsc", ".txt"]);
const checkoutPaths = new Set([
  process.cwd(),
  JSON.stringify(process.cwd()).slice(1, -1),
]);
function scrubCheckoutPaths(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const item = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      scrubCheckoutPaths(item);
      continue;
    }
    if (!entry.isFile() || !textExtensions.has(entry.name.slice(entry.name.lastIndexOf(".")))) continue;
    const source = readFileSync(item, "utf8");
    let sanitized = source;
    for (const checkoutPath of checkoutPaths) sanitized = sanitized.replaceAll(checkoutPath, ".");
    if (sanitized !== source) writeFileSync(item, sanitized);
  }
}
scrubCheckoutPaths(desktopStandalone);
