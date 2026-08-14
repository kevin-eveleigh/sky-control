import { appendFile, mkdir, rename, stat } from "node:fs/promises";
import path from "node:path";

const MAX_LOG_BYTES = 5 * 1024 * 1024;

function safeMessage(value) {
  return String(value)
    .replace(/(authorization:\s*bearer\s+)[^\s]+/gi, "$1<redacted>")
    .replace(/(airco_token\s*[=:]\s*)[^\s]+/gi, "$1<redacted>")
    .replace(/[\r\n]+$/g, "");
}

export class FileLogger {
  constructor(filePath) {
    this.filePath = filePath;
    this.queue = Promise.resolve();
  }

  async initialize() {
    await mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    try {
      if ((await stat(this.filePath)).size >= MAX_LOG_BYTES) {
        await rename(this.filePath, `${this.filePath}.1`);
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }

  write(level, message) {
    const line = `${new Date().toISOString()} ${level} ${safeMessage(message)}\n`;
    this.queue = this.queue
      .then(() => appendFile(this.filePath, line, { encoding: "utf8", mode: 0o600 }))
      .catch(() => {});
    return this.queue;
  }

  info(message) {
    return this.write("INFO", message);
  }

  error(message) {
    return this.write("ERROR", message);
  }

  attach(stream, level) {
    if (!stream) return;
    stream.on("data", (chunk) => this.write(level, chunk.toString("utf8")));
  }

  flush() {
    return this.queue;
  }
}
