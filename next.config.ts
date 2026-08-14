import type { NextConfig } from "next";
import path from "node:path";

const allowedDevOrigins = (process.env.SKY_CONTROL_ALLOWED_DEV_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  output: "standalone",
  ...(allowedDevOrigins.length ? { allowedDevOrigins } : {}),
  turbopack: {
    root: path.resolve(process.cwd()),
  },
};

export default nextConfig;
