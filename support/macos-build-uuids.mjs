import { randomUUID } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

// Electron ships prebuilt executables. Renaming their bundles leaves LC_UUID
// shared with other Electron apps, confusing macOS Local Network attribution.
// Change only executable UUIDs, before signing. See Apple technote TN3178.
export function executableUuidOffsets(buffer) {
  const offsets = [];
  function thin(start, size) {
    const end = start + size;
    if (size < 32 || end > buffer.length || buffer.readUInt32LE(start) !== 0xfeedfacf) {
      throw new Error("Expected a 64-bit little-endian Mach-O executable.");
    }
    if (buffer.readUInt32LE(start + 12) !== 2) throw new Error("Expected MH_EXECUTE.");
    const count = buffer.readUInt32LE(start + 16);
    const commandsEnd = start + 32 + buffer.readUInt32LE(start + 20);
    if (commandsEnd > end) throw new Error("Truncated Mach-O load commands.");
    let cursor = start + 32;
    let uuidCount = 0;
    for (let index = 0; index < count; index++) {
      if (cursor + 8 > commandsEnd) throw new Error("Truncated Mach-O load command.");
      const command = buffer.readUInt32LE(cursor);
      const length = buffer.readUInt32LE(cursor + 4);
      if (length < 8 || cursor + length > commandsEnd) throw new Error("Invalid Mach-O load command size.");
      if (command === 0x1b) {
        if (length !== 24) throw new Error("Invalid LC_UUID size.");
        offsets.push(cursor + 8);
        uuidCount++;
      }
      cursor += length;
    }
    if (uuidCount !== 1 || cursor !== commandsEnd) throw new Error("Expected exactly one LC_UUID per architecture.");
  }
  if (buffer.length < 8) throw new Error("Truncated Mach-O header.");
  if (buffer.readUInt32BE(0) === 0xcafebabe) {
    const count = buffer.readUInt32BE(4);
    if (!count || 8 + count * 20 > buffer.length) throw new Error("Invalid universal Mach-O header.");
    for (let index = 0; index < count; index++) {
      const cursor = 8 + index * 20;
      thin(buffer.readUInt32BE(cursor + 8), buffer.readUInt32BE(cursor + 12));
    }
  } else {
    thin(0, buffer.length);
  }
  return offsets;
}

export async function appExecutables(appPath) {
  const bundles = [appPath];
  const frameworks = path.join(appPath, "Contents", "Frameworks");
  for (const entry of await readdir(frameworks, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.endsWith(".app")) bundles.push(path.join(frameworks, entry.name));
  }
  const executables = [];
  for (const bundle of bundles) {
    const directory = path.join(bundle, "Contents", "MacOS");
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isFile()) executables.push(path.join(directory, entry.name));
    }
  }
  return executables;
}

export async function assignBuildUuids(appPath) {
  for (const executable of await appExecutables(appPath)) {
    const buffer = await readFile(executable);
    for (const offset of executableUuidOffsets(buffer)) {
      Buffer.from(randomUUID().replaceAll("-", ""), "hex").copy(buffer, offset);
    }
    await writeFile(executable, buffer);
  }
}

export default async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  await assignBuildUuids(path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`));
}
