import type { NextConfig } from "next";
import path from "node:path";

const allowedDevOrigins = (process.env.SKY_CONTROL_ALLOWED_DEV_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  output: "standalone",
  // Nothing renders through next/image, so the image optimizer and its native
  // sharp/libvips binaries stay out of the bundle the bridge ships with.
  // sharp is traced for Next's own server rather than for a route; the build
  // applies an exclude there only when its key also matches "next-server",
  // which "**" does along with every route.
  images: { unoptimized: true },
  outputFileTracingExcludes: {
    "**": ["**/node_modules/sharp/**/*", "**/node_modules/@img/**/*"],
  },
  ...(allowedDevOrigins.length ? { allowedDevOrigins } : {}),
  turbopack: {
    root: path.resolve(process.cwd()),
  },
};

export default nextConfig;
