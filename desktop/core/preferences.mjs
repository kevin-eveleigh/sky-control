import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const PREFERENCES_FILE = "preferences.json";
const DEFAULTS = { preventSleep: false };

function normalize(values) {
  return { preventSleep: values?.preventSleep === true };
}

/** Missing or unreadable preferences are not an error worth surfacing: the
 *  defaults are the safe state, and the next save rewrites the file. */
export async function loadPreferences(appSupportPath) {
  try {
    const text = await readFile(path.join(appSupportPath, PREFERENCES_FILE), "utf8");
    return normalize(JSON.parse(text));
  } catch {
    return { ...DEFAULTS };
  }
}

export async function savePreferences(appSupportPath, preferences) {
  const merged = normalize(preferences);
  await mkdir(appSupportPath, { recursive: true, mode: 0o700 });
  await writeFile(
    path.join(appSupportPath, PREFERENCES_FILE),
    `${JSON.stringify(merged, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  return merged;
}
