import { execFile as execFileCallback } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, rename } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { parseEnvText, validateDesktopPort } from "./configuration.mjs";

const execFile = promisify(execFileCallback);

export function launchAgentDefinitions({ homeDirectory, username }) {
  const normalized = username.toLowerCase();
  return [
    {
      kind: "current",
      label: `com.${normalized}.sky-control`,
      plistPath: path.join(homeDirectory, "Library", "LaunchAgents", `com.${normalized}.sky-control.plist`),
      supportPath: path.join(homeDirectory, "Library", "Application Support", "Sky Control"),
    },
    {
      kind: "legacy",
      label: `com.${normalized}.sky-local`,
      plistPath: path.join(homeDirectory, "Library", "LaunchAgents", `com.${normalized}.sky-local.plist`),
      supportPath: path.join(homeDirectory, "Library", "Application Support", "Sky Local"),
    },
  ];
}

async function agentPort(definition) {
  try {
    const environment = parseEnvText(
      await readFile(path.join(definition.supportPath, ".env.local"), "utf8"),
    );
    return validateDesktopPort(environment.SKY_CONTROL_PORT);
  } catch (error) {
    if (error?.code === "ENOENT") return 3000;
    return null;
  }
}

async function isLoaded(label, userId, runExecFile) {
  try {
    await runExecFile("launchctl", ["print", `gui/${userId}/${label}`]);
    return true;
  } catch {
    return false;
  }
}

export async function inspectLaunchAgents({
  homeDirectory,
  username,
  userId,
  fileExists = existsSync,
  runExecFile = execFile,
}) {
  const definitions = launchAgentDefinitions({ homeDirectory, username });
  return Promise.all(
    definitions.map(async (definition) => ({
      ...definition,
      installed: fileExists(definition.plistPath),
      running: await isLoaded(definition.label, userId, runExecFile),
      port: await agentPort(definition),
    })),
  );
}

export function conflictingLaunchAgents(agents, port) {
  return agents.filter(
    (agent) => (agent.installed || agent.running) && (agent.port === null || agent.port === port),
  );
}

/** Explicit migration action only: unload and retain the plist as a recoverable backup. */
export async function disableLaunchAgent(agent, userId, runExecFile = execFile) {
  try {
    await runExecFile("launchctl", ["bootout", `gui/${userId}/${agent.label}`]);
  } catch {
    // An installed but unloaded agent is still disabled below by moving its plist.
  }
  if (!existsSync(agent.plistPath)) return null;
  const backupBase = `${agent.plistPath}.menu-bar-disabled`;
  let backupPath = backupBase;
  let suffix = 1;
  while (existsSync(backupPath)) {
    backupPath = `${backupBase}-${suffix++}`;
  }
  await rename(agent.plistPath, backupPath);
  return backupPath;
}
