import { access } from "node:fs/promises";

export function createElectronBridgeLauncher({ utilityProcess, logger }) {
  return {
    async start(configuration) {
      await access(configuration.runtimeScript);
      const child = utilityProcess.fork(configuration.runtimeScript, [], {
        cwd: configuration.appSupportPath,
        env: configuration.bridgeEnvironment,
        stdio: "pipe",
        serviceName: "Sky Control Bridge",
      });
      logger.attach(child.stdout, "BRIDGE");
      logger.attach(child.stderr, "BRIDGE_ERROR");
      return child;
    },
  };
}
