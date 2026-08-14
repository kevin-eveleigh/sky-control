import { EventEmitter } from "node:events";
import { createServer, connect } from "node:net";
import http from "node:http";

const DEFAULT_READY_TIMEOUT = 20_000;
const DEFAULT_STOP_TIMEOUT = 10_000;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class BridgeLifecycleError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "BridgeLifecycleError";
    this.code = code;
    this.details = details;
  }
}

export function checkHealth(url, timeout = 1_000) {
  return new Promise((resolve) => {
    const request = http.get(`${url}/api/health`, { timeout }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        try {
          const value = JSON.parse(body);
          resolve(response.statusCode === 200 && value.status === "ok");
        } catch {
          resolve(false);
        }
      });
    });
    request.on("timeout", () => request.destroy());
    request.on("error", () => resolve(false));
  });
}

export function isPortAvailable(host, port) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", (error) => {
      if (error.code === "EADDRINUSE") resolve(false);
      else reject(error);
    });
    server.listen({ host, port, exclusive: true }, () => {
      server.close((error) => (error ? reject(error) : resolve(true)));
    });
  });
}

export function canConnect(host, port, timeout = 500) {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    socket.setTimeout(timeout);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

export class BridgeSupervisor extends EventEmitter {
  constructor({
    configuration,
    launcher,
    conflictCheck = async () => [],
    healthCheck = checkHealth,
    portCheck = isPortAvailable,
    forceKill = (pid) => process.kill(pid, "SIGKILL"),
    readyTimeout = DEFAULT_READY_TIMEOUT,
    stopTimeout = DEFAULT_STOP_TIMEOUT,
    pollInterval = 300,
    monitorInterval = 2_000,
    logger = { info() {}, error() {} },
  }) {
    super();
    this.configuration = configuration;
    this.launcher = launcher;
    this.conflictCheck = conflictCheck;
    this.healthCheck = healthCheck;
    this.portCheck = portCheck;
    this.forceKill = forceKill;
    this.readyTimeout = readyTimeout;
    this.stopTimeout = stopTimeout;
    this.pollInterval = pollInterval;
    this.monitorInterval = monitorInterval;
    this.logger = logger;
    this.child = null;
    this.expectedExit = false;
    this.operation = null;
    this.monitorTimer = null;
    this.failedHealthChecks = 0;
    this.current = { status: "stopped", error: null };
  }

  snapshot() {
    return {
      ...this.current,
      address: this.configuration.controllerUrl,
      host: this.configuration.bindHost,
      port: this.configuration.bindPort,
      hasProcess: Boolean(this.child),
      busy: Boolean(this.operation),
    };
  }

  setState(status, error = null) {
    this.current = { status, error };
    this.emit("state", this.snapshot());
  }

  async start() {
    if (this.operation === "start" || this.child) return { started: false, ...this.snapshot() };
    this.operation = "start";
    this.setState("starting");
    try {
      const conflicts = await this.conflictCheck();
      if (conflicts.length) {
        throw new BridgeLifecycleError(
          "LAUNCH_AGENT_CONFLICT",
          "The headless Sky Control service is configured on this address.",
          { conflicts },
        );
      }
      if (!(await this.portCheck(this.configuration.bindHost, this.configuration.bindPort))) {
        throw new BridgeLifecycleError(
          "PORT_IN_USE",
          `Port ${this.configuration.bindPort} is already in use.`,
        );
      }

      this.expectedExit = false;
      const child = await this.launcher.start(this.configuration);
      this.child = child;
      child.once("exit", (code) => this.onChildExit(child, code));
      child.once?.("error", (error) => this.onChildError(child, error));
      this.logger.info("Bridge process started.");

      const deadline = Date.now() + this.readyTimeout;
      while (this.child === child && Date.now() < deadline) {
        if (await this.healthCheck(this.configuration.controllerUrl)) {
          this.failedHealthChecks = 0;
          this.setState("running");
          this.startMonitoring();
          return { started: true, ...this.snapshot() };
        }
        await delay(this.pollInterval);
      }
      if (this.child !== child) throw this.current.error || new Error("Bridge process exited.");
      await this.terminateChild(child);
      throw new BridgeLifecycleError("READY_TIMEOUT", "The bridge did not become ready in time.");
    } catch (error) {
      const lifecycleError = this.toLifecycleError(error);
      const cause = lifecycleError.details?.cause ? ` (${lifecycleError.details.cause})` : "";
      this.logger.error(`${lifecycleError.code}: ${lifecycleError.message}${cause}`);
      this.setState("error", lifecycleError);
      return { started: false, ...this.snapshot() };
    } finally {
      this.operation = null;
      this.emit("state", this.snapshot());
    }
  }

  async stop() {
    if (this.operation === "stop") return { stopped: false, ...this.snapshot() };
    this.operation = "stop";
    this.stopMonitoring();
    try {
      const child = this.child;
      if (child) {
        await this.terminateChild(child);
        this.logger.info("Bridge process stopped.");
      }
      this.setState("stopped");
      return { stopped: true, ...this.snapshot() };
    } catch (error) {
      const lifecycleError = this.toLifecycleError(error, "STOP_FAILED", "The bridge could not be stopped.");
      this.logger.error(`${lifecycleError.code}: ${lifecycleError.message}`);
      this.setState("error", lifecycleError);
      return { stopped: false, ...this.snapshot() };
    } finally {
      this.operation = null;
      this.emit("state", this.snapshot());
    }
  }

  async restart() {
    if (this.operation) return { started: false, ...this.snapshot() };
    const stopped = await this.stop();
    if (!stopped.stopped) return stopped;
    return this.start();
  }

  async terminateChild(child) {
    this.expectedExit = true;
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill();
    await Promise.race([exited, delay(this.stopTimeout)]);
    if (this.child === child && child.pid) {
      this.logger.error("STOP_TIMEOUT: forcing bridge process termination.");
      try {
        this.forceKill(child.pid);
      } catch (error) {
        if (error?.code !== "ESRCH") throw error;
      }
      await Promise.race([exited, delay(1_000)]);
    }
    if (this.child === child) this.child = null;
  }

  onChildExit(child, code) {
    if (this.child !== child) return;
    this.child = null;
    this.stopMonitoring();
    if (this.expectedExit) return;
    const error = new BridgeLifecycleError(
      "UNEXPECTED_EXIT",
      "The bridge stopped unexpectedly.",
      { exitCode: Number.isInteger(code) ? code : null },
    );
    this.logger.error(`${error.code}: exit code ${error.details.exitCode ?? "unknown"}.`);
    this.setState("error", error);
  }

  onChildError(child, cause) {
    if (this.child !== child || this.expectedExit) return;
    const error = new BridgeLifecycleError("PROCESS_ERROR", "The bridge process could not run.", {
      cause: cause?.code || cause?.message || "unknown",
    });
    this.logger.error(`${error.code}: ${error.details.cause}.`);
    this.setState("error", error);
  }

  startMonitoring() {
    this.stopMonitoring();
    this.monitorTimer = setInterval(async () => {
      if (!this.child) return;
      const healthy = await this.healthCheck(this.configuration.controllerUrl);
      if (healthy) {
        this.failedHealthChecks = 0;
        if (this.current.status !== "running") this.setState("running");
        return;
      }
      this.failedHealthChecks += 1;
      if (this.failedHealthChecks >= 3 && this.current.status !== "error") {
        const error = new BridgeLifecycleError("UNHEALTHY", "The bridge is not responding.");
        this.logger.error(`${error.code}: ${error.message}`);
        this.setState("error", error);
      }
    }, this.monitorInterval);
    this.monitorTimer.unref?.();
  }

  stopMonitoring() {
    if (this.monitorTimer) clearInterval(this.monitorTimer);
    this.monitorTimer = null;
    this.failedHealthChecks = 0;
  }

  toLifecycleError(error, fallbackCode = "START_FAILED", fallbackMessage = "The bridge could not start.") {
    if (error instanceof BridgeLifecycleError) return error;
    return new BridgeLifecycleError(fallbackCode, fallbackMessage, {
      cause: error?.code || error?.message || String(error),
    });
  }
}
