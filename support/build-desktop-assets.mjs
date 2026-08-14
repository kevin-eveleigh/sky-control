import { access } from "node:fs/promises";
import path from "node:path";

const required = [
  path.join("desktop", "assets", "app-icon.png"),
  path.join("desktop", "assets", "trayTemplate.png"),
  path.join("desktop", "assets", "trayTemplate@2x.png"),
];
for (const file of required) await access(file);
console.log("Committed desktop bitmap assets are present.");
