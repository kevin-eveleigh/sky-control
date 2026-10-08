import os from "node:os";

/**
 * Byte strings that must never appear in a packaged payload, because they
 * would reveal who built it and where.
 *
 * The checkout path is always checked. The home folder is checked everywhere
 * except on GitHub-hosted runners: there it is the shared `runner` account, not
 * a person, and prebuilt third-party binaries were compiled on those same
 * runners. sharp's libvips, for example, legitimately contains
 * `/Users/runner/work/sharp-libvips/...`, which would otherwise fail every CI
 * package build without anything personal being present.
 */
export function personalPathNeedles(checkout, env = process.env, home = os.homedir()) {
  const paths = env.GITHUB_ACTIONS === "true" ? [checkout] : [checkout, home];
  return paths.map((item) => Buffer.from(item));
}
