import { isIP } from "node:net";

export function normalizeNetworkHost(value: unknown, label: string): string {
  const host = typeof value === "string" ? value.trim() : "";
  if (!host) throw new Error(`${label} is required`);
  if (host.length > 253 || /[\s/]/.test(host)) {
    throw new Error(`${label} must be an IP address or hostname`);
  }
  if (isIP(host)) return host;
  const labels = host.split(".");
  if (
    labels.some(
      (part) =>
        !part ||
        part.length > 63 ||
        !/^[a-z0-9-]+$/i.test(part) ||
        part.startsWith("-") ||
        part.endsWith("-"),
    )
  ) {
    throw new Error(`${label} must be an IP address or hostname`);
  }
  return host;
}
