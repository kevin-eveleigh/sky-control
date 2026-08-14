export type AircoMode = "auto" | "cool" | "dry" | "fan" | "heat";
export type AircoFan =
  | "auto"
  | "gear-1"
  | "gear-2"
  | "gear-3"
  | "gear-4"
  | "gear-5"
  | "variable";
export type SwingMode = "off" | "vertical" | "horizontal" | "both";

export type AircoState = {
  power?: boolean;
  targetTemperature?: number;
  indoorTemperature?: number;
  mode?: AircoMode;
  fan?: AircoFan;
  swing?: SwingMode;
  sleep?: boolean;
  quiet?: boolean;
  light?: boolean;
  /** Ioniser / air purification, the remote's "Health" button. */
  health?: boolean;
  /** Reduced-power mode, the remote's "Eco" button. */
  eco?: boolean;
};

export type DeviceInfo = {
  host: string;
  port: number;
  mac?: string;
  name?: string;
  model?: string;
  protocol?: string;
};

export type AircoConfig = {
  id: string;
  displayName: string;
  location: string;
  host: string;
  port: number;
  mac?: string;
  deviceName?: string;
  model?: string;
  protocol?: string;
};

export type AircoInput = Omit<AircoConfig, "id">;

export type LogEntry = {
  at: string;
  level: "info" | "success" | "warning" | "error";
  message: string;
};

export type ProtocolSummary = {
  receivedBytes: number;
  validFrames: number;
  stateFrameReceived: boolean;
};

export type RuntimeDiagnostics = {
  operation: string | null;
  normalizedError: string | null;
  protocol: ProtocolSummary | null;
};

export type AircoSnapshot = AircoConfig & {
  reachable: boolean | null;
  lastSeen: string | null;
  lastState: AircoState | null;
  logs: LogEntry[];
};

export type BridgeSnapshot = {
  aircos: AircoSnapshot[];
  /** True when a token is configured and the API expects a bearer token. */
  authRequired: boolean;
  /** True when AIRCO_TOKEN pins it, so the interface cannot change it. */
  authManagedByEnv: boolean;
};
