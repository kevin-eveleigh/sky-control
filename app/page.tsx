"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type {
  AircoConfig,
  AircoFan,
  AircoInput,
  AircoMode,
  AircoSnapshot,
  AircoState,
  BridgeSnapshot,
  DeviceInfo,
  SwingMode,
} from "@/lib/airco/types";
import { PROJECT, PROJECT_DISCLAIMER } from "@/lib/project";
import { MIN_TOKEN_LENGTH } from "@/lib/bridge/constants";

const TOKEN_KEY = "sky-control-token";
const SELECTED_KEY = "sky-control-selected-airco";

/**
 * The project was called Sky Local before it grew past a single airco brand.
 * Carry the old keys over once so an existing phone stays signed in and keeps
 * its selected unit instead of being bounced to the token screen.
 */
const RENAMED_KEYS: Array<[string, string]> = [
  ["sky-local-token", TOKEN_KEY],
  ["sky-local-selected-airco", SELECTED_KEY],
];

function adoptRenamedKeys() {
  for (const [previous, current] of RENAMED_KEYS) {
    const value = window.localStorage.getItem(previous);
    if (value === null) continue;
    if (window.localStorage.getItem(current) === null) {
      window.localStorage.setItem(current, value);
    }
    window.localStorage.removeItem(previous);
  }
}

// Runs on the client as the module loads, before anything reads storage during
// render — so the migration never happens inside a render pass.
if (typeof window !== "undefined") adoptRenamedKeys();

const MIN_TEMPERATURE = 16;
const MAX_TEMPERATURE = 30;
/** How often the selected unit is actually asked for its state. */
const PROBE_INTERVAL_MS = 20_000;
/** How often the airco list itself is refreshed (cheap, no device traffic). */
const LIST_INTERVAL_MS = 60_000;
/** Temperature taps are collapsed into one command after this quiet period. */
const TEMPERATURE_COMMIT_MS = 550;
/** A follow-up probe settles the display shortly after any command. */
const SETTLE_PROBE_MS = 1_400;
/** An optimistic value the unit never confirms is dropped after this long. */
const PENDING_TTL_MS = 12_000;

// `tone` colours the button for that mode when it is the selected one. Auto
// has none, so it keeps the interface's own accent.
const MODES: Array<{ value: AircoMode; label: string; icon: IconName; tone?: string }> = [
  { value: "auto", label: "Auto", icon: "auto" },
  { value: "cool", label: "Cool", icon: "snow", tone: "cool" },
  { value: "dry", label: "Dry", icon: "drop", tone: "dry" },
  { value: "fan", label: "Fan", icon: "wind", tone: "fan" },
  { value: "heat", label: "Heat", icon: "sun", tone: "heat" },
];
const FANS: Array<{ value: AircoFan; label: string; short: string }> = [
  { value: "auto", label: "Auto", short: "Auto" },
  { value: "gear-1", label: "Speed 1", short: "1" },
  { value: "gear-2", label: "Speed 2", short: "2" },
  { value: "gear-3", label: "Speed 3", short: "3" },
  { value: "gear-4", label: "Speed 4", short: "4" },
  { value: "gear-5", label: "Speed 5", short: "5" },
  { value: "variable", label: "Variable", short: "Var" },
];
// `short` keeps four options inside a narrow phone; the full `label` is what
// the row header and the accessible name use.
const SWINGS: Array<{ value: SwingMode; label: string; short: string; icon: IconName }> = [
  { value: "off", label: "Off", short: "Off", icon: "swingOff" },
  { value: "vertical", label: "Up & down", short: "Up", icon: "swingVertical" },
  { value: "horizontal", label: "Left & right", short: "Side", icon: "swingHorizontal" },
  { value: "both", label: "Both", short: "Both", icon: "swingBoth" },
];

/** Maps a control action onto the state field it settles against. */
const STATE_KEY = {
  power: "power",
  temperature: "targetTemperature",
  mode: "mode",
  fan: "fan",
  swing: "swing",
  quiet: "quiet",
  sleep: "sleep",
  health: "health",
  eco: "eco",
  light: "light",
} as const satisfies Record<string, keyof AircoState>;

type ControlAction = keyof typeof STATE_KEY;
type PendingMap = Partial<Record<ControlAction, unknown>>;
type BridgeResponse = BridgeSnapshot & {
  addedId?: string;
  device?: DeviceInfo;
  discovered?: DeviceInfo[];
  confirmed?: boolean;
};

const blankAirco = (): AircoInput => ({
  displayName: "",
  location: "",
  host: "",
  port: 1998,
});

/**
 * The token lives in localStorage, which the server cannot see. Reading it
 * through an external store keeps hydration honest — the server renders the
 * signed-out shell, the client swaps in the stored value on its first paint —
 * and keeps every open tab in step when the token is changed or cleared.
 */
const tokenListeners = new Set<() => void>();

function notifyTokenChange() {
  for (const listener of tokenListeners) listener();
}

function subscribeToToken(listener: () => void) {
  tokenListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    tokenListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

const readToken = () => window.localStorage.getItem(TOKEN_KEY) || "";
const noToken = () => "";

function storeToken(value: string) {
  if (value) window.localStorage.setItem(TOKEN_KEY, value);
  else window.localStorage.removeItem(TOKEN_KEY);
  notifyTokenChange();
}

/**
 * Clipboard.writeText is restricted to secure contexts in some browsers. Sky
 * Control normally runs over plain HTTP on a trusted LAN, so keep a user-gesture
 * fallback for those browsers instead of silently losing the generated token.
 */
async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall through to the selection-based copy path below.
  }

  const temporary = document.createElement("textarea");
  temporary.value = value;
  temporary.setAttribute("readonly", "");
  temporary.style.position = "fixed";
  temporary.style.opacity = "0";
  temporary.style.pointerEvents = "none";
  document.body.appendChild(temporary);
  temporary.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  temporary.remove();
  return copied;
}

/** Server renders `false`, the client renders `true` from its first paint. */
const subscribeNever = () => () => {};
const isHydrated = () => true;
const notHydrated = () => false;

type IconName =
  | "power"
  | "snow"
  | "sun"
  | "drop"
  | "wind"
  | "auto"
  | "swingOff"
  | "swingVertical"
  | "swingHorizontal"
  | "swingBoth"
  | "quiet"
  | "moon"
  | "leaf"
  | "health"
  | "bulb"
  | "scan"
  | "plus"
  | "minus"
  | "settings"
  | "close"
  | "sync"
  | "chevron";

const ICONS: Record<IconName, React.ReactNode> = {
  power: (
    <>
      <path d="M12 3v9" />
      <path d="M6.8 6.4a8 8 0 1 0 10.4 0" />
    </>
  ),
  snow: (
    <>
      <path d="M12 2v20M4 7l16 10M4 17 20 7" />
      <path d="m9 4 3 3 3-3M9 20l3-3 3 3M4.5 10l4.1-1.1-1.1-4M19.5 14l-4.1 1.1 1.1 4M4.5 14l4.1 1.1-1.1 4M19.5 10l-4.1-1.1 1.1-4" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
    </>
  ),
  drop: <path d="M12 3s6 6.3 6 10a6 6 0 0 1-12 0c0-3.7 6-10 6-10Z" />,
  wind: (
    <>
      <path d="M3 8h11a3 3 0 1 0-3-3" />
      <path d="M3 12h16a2 2 0 1 1-2 2" />
      <path d="M3 16h8" />
    </>
  ),
  auto: (
    <>
      <path d="M5 19 12 5l7 14" />
      <path d="M8 14h8" />
    </>
  ),
  swingOff: (
    <>
      <path d="M4 7h16" />
      <path d="M8 12h8" />
    </>
  ),
  swingVertical: (
    <>
      <path d="M4 6h16" />
      <path d="M12 10v8" />
      <path d="m9 15 3 3 3-3" />
    </>
  ),
  swingHorizontal: (
    <>
      <path d="M4 6h16" />
      <path d="M6 14h12" />
      <path d="m9 11-3 3 3 3M15 11l3 3-3 3" />
    </>
  ),
  swingBoth: (
    <>
      <path d="M4 5h16" />
      <path d="M12 9v9" />
      <path d="m9 15 3 3 3-3" />
      <path d="M6 12h12" />
      <path d="m8 10-2 2 2 2M16 10l2 2-2 2" />
    </>
  ),
  quiet: (
    <>
      <path d="M11 5 6.8 9H3v6h3.8l4.2 4V5Z" />
      <path d="m16 9 5 6M21 9l-5 6" />
    </>
  ),
  moon: <path d="M20.5 14.2A8 8 0 0 1 9.8 3.5 9 9 0 1 0 20.5 14.2Z" />,
  leaf: (
    <>
      <path d="M4 20c0-8.8 6.7-15.2 16-16 .5 9.6-5.6 16-16 16Z" />
      <path d="M9.5 14.6c1.6-2.9 3.9-4.9 6.5-6" />
    </>
  ),
  health: (
    <>
      <path d="m12 3 1.5 4.3L18 8.8l-4.5 1.5L12 14.6l-1.5-4.3L6 8.8l4.5-1.5L12 3Z" />
      <path d="m18 15.4.9 2.4 2.4.9-2.4.9-.9 2.4-.9-2.4-2.4-.9 2.4-.9.9-2.4Z" />
    </>
  ),
  bulb: (
    <>
      <path d="M9.2 16a6 6 0 1 1 5.6 0" />
      <path d="M9.5 19h5M10.5 21.5h3" />
    </>
  ),
  scan: (
    <>
      <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" />
      <path d="M7 12h10" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.09A1.7 1.7 0 0 0 9 19.36a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.63 15 1.7 1.7 0 0 0 3.07 14H3v-4h.09A1.7 1.7 0 0 0 4.64 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.63 1.7 1.7 0 0 0 10 3.07V3h4v.09A1.7 1.7 0 0 0 15 4.64a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.37 9 1.7 1.7 0 0 0 20.93 10H21v4h-.09A1.7 1.7 0 0 0 19.4 15Z" />
    </>
  ),
  close: <path d="m6 6 12 12M18 6 6 18" />,
  sync: (
    <>
      <path d="M20.5 12a8.5 8.5 0 0 1-14.8 5.7" />
      <path d="M3.5 12a8.5 8.5 0 0 1 14.8-5.7" />
      <path d="M18.3 2.8v3.5h-3.5M5.7 21.2v-3.5h3.5" />
    </>
  ),
  chevron: <path d="m9 6 6 6-6 6" />,
};

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {ICONS[name]}
    </svg>
  );
}

// The Sky Control brand snowflake. Filled artwork, so it does not go through
// Icon (which is stroke-only) and keeps its own 512 viewBox.
function BrandMark({ size = 20 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 512 512"
      fill="currentColor"
    >
      <path d="M350,245.2l-10-17.4l-12.3-21.3l-0.1-0.1l-15.1-26.2c-3.9-6.7-11-10.8-18.7-10.8h-20.2h-34.6h-20.2c-7.7,0-14.9,4.1-18.7,10.8l-9.8,17L181,213l-18.6,32.2c-3.9,6.7-3.9,14.9,0,21.6l9.9,17.1l9.2,15.8l18.5,32.1c3.9,6.7,11,10.8,18.7,10.8h19.9h19.8h35.4c7.7,0,14.9-4.1,18.7-10.8l10-17.3v0l8.4-14.5l1-1.7l18.2-31.5C353.9,260.1,353.9,251.9,350,245.2z M282,300.6h-51.5L204.7,256l25.8-44.6H282l25.8,44.6L282,300.6z" />
      <path d="M231.7,114.7l7.2,7.2v33.5h34.6v-33.5l41.9-41.9c3.4-3.4,5.1-7.8,5.1-12.3c0-4.4-1.7-8.9-5.1-12.2c-6.8-6.8-17.7-6.8-24.5,0l-17.4,17.4V36c0-4.8-1.9-9.1-5.1-12.2c-3.1-3.1-7.5-5.1-12.3-5.1c-9.6,0-17.3,7.8-17.3,17.3v36.9l-17.5-17.5c-6.8-6.8-17.7-6.8-24.5,0c-3.4,3.4-5.1,7.8-5.1,12.2c0,4.4,1.7,8.9,5.1,12.3L231.7,114.7z" />
      <path d="M381.1,204.1l9.8,2.6l47.5,12.8c4.6,1.3,9.3,0.5,13.1-1.7c3.8-2.2,6.8-5.9,8.1-10.5c2.5-9.2-3-18.8-12.2-21.2l-23.8-6.4l32-18.4c4.1-2.4,6.9-6.2,8.1-10.5c1.2-4.3,0.7-9-1.7-13.2c-4.8-8.3-15.4-11.1-23.6-6.4l-32,18.4l6.4-23.8c2.5-9.2-3-18.7-12.2-21.2c-4.6-1.2-9.3-0.5-13.1,1.7c-3.8,2.2-6.8,5.9-8.1,10.5l-12.8,47.5l-2.6,9.8l-29,16.7l17.3,30L381.1,204.1z" />
      <path d="M455.2,351.5L423.2,333l23.9-6.3c9.2-2.4,14.8-11.9,12.3-21.2c-1.2-4.6-4.2-8.3-8-10.5c-3.8-2.2-8.5-3-13.1-1.8l-47.5,12.6l-9.8,2.6l-29-16.8l-17.3,30l28.9,16.8l2.6,9.8l12.6,47.5c1.2,4.6,4.2,8.3,8.1,10.5c3.8,2.2,8.5,3,13.1,1.8c9.3-2.4,14.8-11.9,12.3-21.2l-6.3-23.8l31.9,18.5c4.1,2.4,8.9,2.9,13.1,1.8c4.3-1.1,8.1-3.9,10.5-8C466.2,366.9,463.4,356.3,455.2,351.5z" />
      <path d="M280.1,397.4l-7.1-7.2l0.1-33.5h-34.6l-0.1,33.4l-7.2,7.2l-34.9,34.6c-3.4,3.4-5.1,7.8-5.1,12.2c0,4.4,1.7,8.9,5,12.3c6.7,6.8,17.7,6.8,24.5,0.1l17.5-17.4l-0.1,36.9c0,4.8,1.9,9.1,5,12.3c3.1,3.1,7.4,5.1,12.2,5.1c9.6,0,17.3-7.7,17.4-17.3l0.1-36.9l17.4,17.5c6.7,6.8,17.7,6.8,24.5,0.1c3.4-3.4,5.1-7.8,5.1-12.2c0-4.4-1.7-8.9-5-12.3L280.1,397.4z" />
      <path d="M131.1,307.4l-9.8-2.7l-47.4-13c-4.6-1.3-9.3-0.5-13.2,1.7c-3.9,2.2-6.9,5.9-8.1,10.5c-2.5,9.2,2.9,18.8,12.1,21.3l23.8,6.5L56.5,350c-4.2,2.4-7,6.2-8.1,10.5c-1.2,4.3-0.7,9,1.7,13.2c4.7,8.3,15.3,11.2,23.6,6.4l32.1-18.3l-6.5,23.8c-2.5,9.2,2.9,18.7,12.1,21.3c4.6,1.3,9.3,0.5,13.1-1.7c3.9-2.2,6.9-5.9,8.1-10.5l13-47.4l2.7-9.8l29.2-16.6l-17.3-30L131.1,307.4z" />
      <path d="M57.6,159.7l31.9,18.7l-23.9,6.2c-9.3,2.4-14.8,11.9-12.4,21.1c1.2,4.6,4.2,8.3,8,10.6c3.8,2.3,8.5,3,13.1,1.8l47.6-12.4l9.8-2.6l29,17l17.3-30l-28.8-16.9l-2.6-9.8l-12.4-47.6c-1.2-4.6-4.2-8.3-8-10.6c-3.8-2.2-8.5-3-13.1-1.8c-9.3,2.4-14.8,11.9-12.4,21.1l6.2,23.9l-31.8-18.7c-4.1-2.4-8.8-2.9-13.1-1.8c-4.3,1.1-8.1,3.9-10.6,8C46.6,144.2,49.4,154.8,57.6,159.7z" />
    </svg>
  );
}

function labelFor<T extends string>(
  options: Array<{ value: T; label: string }>,
  value?: T,
) {
  return options.find((option) => option.value === value)?.label;
}

function timeLabel(value: string | null | undefined) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function relativeLabel(value: string | null | undefined) {
  if (!value) return "never";
  const seconds = Math.round((Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}

function messageOf(cause: unknown, fallback: string) {
  return cause instanceof Error ? cause.message : fallback;
}

class UnauthorizedError extends Error {
  constructor() {
    super("That token was not accepted.");
  }
}

/** A labelled row of mutually exclusive choices. */
function SegmentedRow<T extends string>({
  label,
  options,
  value,
  disabled,
  scroll,
  onSelect,
}: {
  label: string;
  options: Array<{
    value: T;
    label: string;
    short?: string;
    icon?: IconName;
    /** Opts this option into its own accent colour when selected. */
    tone?: string;
  }>;
  value: T | undefined;
  disabled: boolean;
  scroll?: boolean;
  onSelect: (value: T) => void;
}) {
  return (
    <div className="segment-block">
      <div className="segment-label">
        <span>{label}</span>
        <strong>{labelFor(options, value) ?? "Unknown"}</strong>
      </div>
      <div
        className={`segment-row ${scroll ? "scroll" : ""}`}
        role="radiogroup"
        aria-label={label}
      >
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            aria-label={option.label}
            data-tone={option.tone}
            className={value === option.value ? "active" : ""}
            disabled={disabled}
            onClick={() => onSelect(option.value)}
          >
            {option.icon && <Icon name={option.icon} size={18} />}
            <span>{option.short ?? option.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ToggleTile({
  icon,
  label,
  on,
  disabled,
  onToggle,
}: {
  icon: IconName;
  label: string;
  on: boolean | undefined;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={`toggle-tile ${on ? "on" : ""}`}
      aria-pressed={Boolean(on)}
      disabled={disabled}
      onClick={onToggle}
    >
      <Icon name={icon} size={19} />
      <span>{label}</span>
      <em>{on === undefined ? "—" : on ? "On" : "Off"}</em>
    </button>
  );
}

export default function Home() {
  const hydrated = useSyncExternalStore(subscribeNever, isHydrated, notHydrated);
  const token = useSyncExternalStore(subscribeToToken, readToken, noToken);
  const [draftToken, setDraftToken] = useState("");
  const [snapshot, setSnapshot] = useState<BridgeSnapshot | null>(null);
  // Only shown once the API actually rejects us, so an install without a token
  // never sees a login screen at all.
  const [needsToken, setNeedsToken] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [showTime, setShowTime] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tokenDraft, setTokenDraft] = useState("");
  const [tokenCopyMessage, setTokenCopyMessage] = useState("");
  const [tokenWanted, setTokenWanted] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [pending, setPending] = useState<PendingMap>({});
  const [inflight, setInflight] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<AircoConfig | null | undefined>(undefined);
  const [form, setForm] = useState<AircoInput>(blankAirco);
  const [discovered, setDiscovered] = useState<DeviceInfo[]>([]);
  const [addressCheck, setAddressCheck] = useState<{ found: boolean; message: string } | null>(
    null,
  );

  const selectedIdRef = useRef("");
  const temperatureRef = useRef<number | null>(null);
  const temperatureTimer = useRef<number | null>(null);
  const settleTimer = useRef<number | null>(null);
  const revealTimer = useRef<number | null>(null);
  const expiryTimers = useRef(new Map<ControlAction, number>());

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const dropPending = useCallback((action: ControlAction) => {
    const timer = expiryTimers.current.get(action);
    if (timer) {
      window.clearTimeout(timer);
      expiryTimers.current.delete(action);
    }
    setPending((current) => {
      if (!(action in current)) return current;
      const next = { ...current };
      delete next[action];
      return next;
    });
  }, []);

  /**
   * Shows the user's intent straight away. The value is dropped once the unit
   * reports the same thing, and expires on its own if it never does — so a
   * command that quietly failed can't leave the display lying indefinitely.
   */
  const markPending = useCallback(
    (action: ControlAction, value: unknown) => {
      setPending((current) => ({ ...current, [action]: value }));
      const existing = expiryTimers.current.get(action);
      if (existing) window.clearTimeout(existing);
      expiryTimers.current.set(
        action,
        window.setTimeout(() => dropPending(action), PENDING_TTL_MS),
      );
    },
    [dropPending],
  );

  const clearAllPending = useCallback(() => {
    for (const timer of expiryTimers.current.values()) window.clearTimeout(timer);
    expiryTimers.current.clear();
    setPending({});
  }, []);

  const request = useCallback(
    async (path: string, method = "GET", body?: unknown) => {
      const response = await fetch(path, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 401) throw new UnauthorizedError();
      if (!response.ok) {
        throw new Error(payload.error || `Request failed (${response.status})`);
      }
      return payload as BridgeResponse;
    },
    [token],
  );

  const acceptSnapshot = useCallback((data: BridgeResponse, preferredId?: string) => {
    setSnapshot({
      aircos: data.aircos,
      authRequired: data.authRequired,
      authManagedByEnv: data.authManagedByEnv,
    });
    setNeedsToken(false);
    if (data.discovered) setDiscovered(data.discovered);
    const saved =
      preferredId ||
      selectedIdRef.current ||
      window.localStorage.getItem(SELECTED_KEY) ||
      "";
    const nextId = data.aircos.some((airco) => airco.id === saved)
      ? saved
      : data.aircos[0]?.id || "";
    setSelectedId(nextId);
    selectedIdRef.current = nextId;
    if (nextId) window.localStorage.setItem(SELECTED_KEY, nextId);
    else window.localStorage.removeItem(SELECTED_KEY);
  }, []);

  // Cheap list refresh. Carries no device traffic, so it can be infrequent.
  useEffect(() => {
    // Wait for the client-side token store. Without this gate, a hard reload
    // can issue one request with the server snapshot's empty token before
    // useSyncExternalStore publishes the saved browser token.
    if (!hydrated) return;
    let active = true;
    const load = () =>
      request("/api/aircos")
        .then((data) => active && acceptSnapshot(data))
        .catch((cause) => {
          if (!active) return;
          if (cause instanceof UnauthorizedError) {
            setNeedsToken(true);
            // Only complain if a token was actually tried; arriving with none
            // is the ordinary first-run path, not a failure.
            setError(token ? cause.message : "");
          } else {
            setError(messageOf(cause, "Request failed"));
          }
        })
        .finally(() => active && setLoaded(true));
    void load();
    const timer = window.setInterval(load, LIST_INTERVAL_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [acceptSnapshot, hydrated, request, token]);

  const probe = useCallback(
    async (background: boolean) => {
      const id = selectedIdRef.current;
      if (!id) return;
      try {
        acceptSnapshot(
          await request("/api/probe", "POST", { aircoId: id, background }),
        );
      } catch (cause) {
        if (!background) setError(messageOf(cause, "Could not read status"));
      }
    },
    [acceptSnapshot, request],
  );

  // Ask the unit itself for its state: on open, on switching units, on a
  // regular tick, and whenever the phone comes back to the app.
  useEffect(() => {
    if (needsToken || !selectedId) return;
    let active = true;
    const tick = () => {
      // Repeat polls only while the app is on screen — no point waking the
      // unit for a tab sitting in the background.
      if (!active || document.visibilityState !== "visible") return;
      void probe(true);
    };
    // The first read always runs: the unit we just mounted or switched to has
    // no state to show yet, and waiting on visibility would strand the display.
    void probe(true);
    const timer = window.setInterval(tick, PROBE_INTERVAL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [needsToken, probe, selectedId]);

  useEffect(() => {
    const timers = expiryTimers.current;
    return () => {
      if (temperatureTimer.current) window.clearTimeout(temperatureTimer.current);
      if (settleTimer.current) window.clearTimeout(settleTimer.current);
      if (revealTimer.current) window.clearTimeout(revealTimer.current);
      for (const timer of timers.values()) window.clearTimeout(timer);
      timers.clear();
    };
  }, []);

  const selected = useMemo(
    () =>
      snapshot?.aircos.find((airco) => airco.id === selectedId) ||
      snapshot?.aircos[0] ||
      null,
    [selectedId, snapshot],
  );
  const serverState = selected?.lastState ?? null;

  /** Server state with the user's not-yet-confirmed intent laid over it. */
  const view = useMemo(() => {
    const merged: Record<string, unknown> = { ...(serverState ?? {}) };
    for (const [action, value] of Object.entries(pending) as Array<
      [ControlAction, unknown]
    >) {
      const key = STATE_KEY[action];
      // Once the unit reports the value itself, the command has landed and the
      // optimistic copy is redundant.
      if (serverState?.[key] === value) continue;
      merged[key] = value;
    }
    return merged as AircoState;
  }, [pending, serverState]);

  const online = selected?.reachable === true;
  const unchecked = selected?.reachable === null || selected?.reachable === undefined;
  const stateKnown = serverState !== null || Object.keys(pending).length > 0;
  const canControl = Boolean(selected);
  const targetTemperature =
    typeof view.targetTemperature === "number" ? view.targetTemperature : undefined;

  const send = useCallback(
    async (action: ControlAction, value: unknown) => {
      const id = selectedIdRef.current;
      if (!id) return;
      markPending(action, value);
      // Every command except an explicit power-off also wakes the unit, so the
      // display should say so rather than waiting for the next probe to reveal it.
      if (action !== "power") markPending("power", true);
      setInflight((count) => count + 1);
      setError("");
      try {
        acceptSnapshot(
          await request("/api/control", "POST", { aircoId: id, action, value }),
        );
        if (settleTimer.current) window.clearTimeout(settleTimer.current);
        settleTimer.current = window.setTimeout(() => void probe(true), SETTLE_PROBE_MS);
      } catch (cause) {
        // Roll the optimistic values back so the display never lies about the unit.
        dropPending(action);
        if (action !== "power") dropPending("power");
        setError(messageOf(cause, "Control failed"));
      } finally {
        setInflight((count) => Math.max(0, count - 1));
      }
    },
    [acceptSnapshot, dropPending, markPending, probe, request],
  );

  /**
   * Temperature taps move the display immediately and collapse into a single
   * command once tapping stops, instead of one round trip per degree.
   */
  function nudgeTemperature(delta: number) {
    const base = temperatureRef.current ?? targetTemperature;
    if (base === undefined) return;
    const next = Math.min(MAX_TEMPERATURE, Math.max(MIN_TEMPERATURE, base + delta));
    if (next === base) return;
    temperatureRef.current = next;
    markPending("temperature", next);
    if (temperatureTimer.current) window.clearTimeout(temperatureTimer.current);
    temperatureTimer.current = window.setTimeout(() => {
      temperatureRef.current = null;
      void send("temperature", next);
    }, TEMPERATURE_COMMIT_MS);
  }

  function selectAirco(id: string) {
    setSelectedId(id);
    selectedIdRef.current = id;
    clearAllPending();
    setError("");
    window.localStorage.setItem(SELECTED_KEY, id);
  }

  /** Refresh, and hold the timing visible briefly so the tap has an answer. */
  function refreshNow() {
    setShowTime(true);
    if (revealTimer.current) window.clearTimeout(revealTimer.current);
    revealTimer.current = window.setTimeout(() => setShowTime(false), 4000);
    void runAction("probe");
  }

  async function runAction(action: "discover" | "probe") {
    if (action === "probe" && !selected) return;
    setBusy(action);
    setError("");
    try {
      if (action === "probe") await probe(false);
      else acceptSnapshot(await request("/api/discover", "POST"));
    } catch (cause) {
      setError(messageOf(cause, "Request failed"));
    } finally {
      setBusy(null);
    }
  }

  async function downloadDiagnostics() {
    if (!selected) return;
    setBusy("diagnostics");
    setError("");
    try {
      const response = await fetch(
        `/api/diagnostics?aircoId=${encodeURIComponent(selected.id)}`,
        { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
      );
      if (response.status === 401) throw new UnauthorizedError();
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Could not create diagnostics");
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `${PROJECT.slug}-diagnostics.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(messageOf(cause, "Could not create diagnostics"));
    } finally {
      setBusy(null);
    }
  }

  function saveToken(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    storeToken(draftToken.trim());
  }

  function openAdd() {
    setEditing(null);
    setForm(blankAirco());
    setAddressCheck(null);
    setError("");
  }

  function openEdit(airco: AircoSnapshot) {
    setEditing(airco);
    setForm({
      displayName: airco.displayName,
      location: airco.location,
      host: airco.host,
      port: airco.port,
      mac: airco.mac,
      deviceName: airco.deviceName,
      model: airco.model,
      protocol: airco.protocol,
    });
    setAddressCheck(null);
    setError("");
  }

  function applyDiscoveredDevice(device: DeviceInfo) {
    setForm((current) => ({
      ...current,
      host: device.host,
      port: device.port,
      mac: device.mac,
      deviceName: device.name,
      model: device.model,
      protocol: device.protocol,
    }));
  }

  /**
   * Scanning only covers the bridge's own network segment. Checking a typed
   * address works anywhere the bridge can route to, including over a VPN, and
   * fills in the module details a scan would have provided. The result is shown
   * inside the dialog because the page's error banner sits behind it.
   */
  async function checkAddress() {
    setBusy("identify");
    setAddressCheck(null);
    try {
      const { device } = await request("/api/identify", "POST", {
        host: form.host,
        port: form.port,
      });
      if (!device) throw new Error("The bridge returned no module details.");
      setForm((current) => ({
        ...current,
        // The typed port is kept: discovery replies do not carry one.
        host: device.host,
        mac: device.mac,
        deviceName: device.name,
        model: device.model,
        protocol: device.protocol,
      }));
      setAddressCheck({
        found: true,
        message: `Found ${device.name || "a compatible module"} at ${device.host}.`,
      });
    } catch (cause) {
      setAddressCheck({ found: false, message: messageOf(cause, "Could not check this address") });
    } finally {
      setBusy(null);
    }
  }

  async function saveAirco(event: React.FormEvent) {
    event.preventDefault();
    setBusy("save");
    setError("");
    try {
      const path = editing
        ? `/api/aircos/${encodeURIComponent(editing.id)}`
        : "/api/aircos";
      const data = await request(path, editing ? "PATCH" : "POST", form);
      acceptSnapshot(data, editing?.id || data.addedId);
      setEditing(undefined);
    } catch (cause) {
      setError(messageOf(cause, "Could not save airco"));
    } finally {
      setBusy(null);
    }
  }

  async function deleteAirco() {
    if (
      !editing ||
      !window.confirm(`Remove ${editing.displayName}? This only removes it from Sky Control.`)
    ) {
      return;
    }
    setBusy("delete");
    setError("");
    try {
      acceptSnapshot(
        await request(`/api/aircos/${encodeURIComponent(editing.id)}`, "DELETE"),
      );
      setEditing(undefined);
    } catch (cause) {
      setError(messageOf(cause, "Could not remove airco"));
    } finally {
      setBusy(null);
    }
  }

  function openSettings() {
    setTokenWanted(Boolean(snapshot?.authRequired));
    setTokenDraft("");
    setTokenCopyMessage("");
    setError("");
    setSettingsOpen(true);
  }

  async function generateToken() {
    // getRandomValues works in insecure contexts too, which matters because
    // this is normally reached over plain http on the LAN.
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const next = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    setTokenDraft(next);
    const copied = await copyText(next);
    setTokenCopyMessage(
      copied
        ? "Generated token copied to the clipboard."
        : "Generated token is ready. Select it and copy it before leaving Settings.",
    );
  }

  async function copyToken() {
    const copied = await copyText(tokenDraft.trim());
    setTokenCopyMessage(
      copied
        ? "Token copied to the clipboard."
        : "Could not copy automatically. Select the token and copy it manually.",
    );
  }

  async function saveAccess(event: React.FormEvent) {
    event.preventDefault();
    const wantsToken = tokenWanted;
    const typed = tokenDraft.trim();
    if (wantsToken && !typed && !snapshot?.authRequired) {
      setError("Enter a token, or generate one.");
      return;
    }
    setBusy("settings");
    setError("");
    try {
      if (wantsToken && !typed) {
        // Token already set and left blank: nothing to change.
        setSettingsOpen(false);
        return;
      }
      const next = wantsToken ? typed : null;
      const data = await request("/api/settings", "PUT", { token: next });
      // Store locally before anything else goes out, or we lock ourselves out
      // of the very API we just secured.
      storeToken(next ?? "");
      acceptSnapshot(data);
      setSettingsOpen(false);
      setTokenDraft("");
      setTokenCopyMessage("");
    } catch (cause) {
      setError(messageOf(cause, "Could not save settings"));
    } finally {
      setBusy(null);
    }
  }

  if (!hydrated || !loaded) {
    return (
      <main className="boot" aria-busy="true">
        <p className="visually-hidden" role="status">Loading {PROJECT.name}…</p>
      </main>
    );
  }

  if (needsToken) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <div className="brand-mark">
            <BrandMark size={26} />
          </div>
          <p className="eyebrow">Private controller</p>
          <h1>{PROJECT.name}</h1>
          <p className="muted">
            Enter the access token from this Mac to open the controller.
          </p>
          <form onSubmit={saveToken}>
            <label htmlFor="token">Access token</label>
            <input
              id="token"
              type="password"
              value={draftToken}
              onChange={(event) => setDraftToken(event.target.value)}
              autoComplete="current-password"
              placeholder="Paste token"
              required
            />
            <button className="primary-button" type="submit">
              Connect
            </button>
          </form>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </section>
      </main>
    );
  }

  const multipleUnits = (snapshot?.aircos.length ?? 0) > 1;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-dot">
            <BrandMark size={16} />
          </span>
          <span>{PROJECT.name}</span>
          {inflight > 0 && (
            <span className="sync" role="status" aria-label="Syncing">
              <Icon name="sync" size={14} />
            </span>
          )}
        </div>
        <button className="icon-button" onClick={openAdd} aria-label="Add airco">
          <Icon name="plus" />
        </button>
      </header>

      {multipleUnits && (
        <section className="unit-switcher" aria-label="Configured air conditioners">
          {snapshot?.aircos.map((airco) => (
            <button
              key={airco.id}
              className={`unit-tab ${airco.id === selected?.id ? "active" : ""}`}
              aria-pressed={airco.id === selected?.id}
              onClick={() => selectAirco(airco.id)}
            >
              <span
                className={`mini-dot ${
                  airco.reachable === true
                    ? "online"
                    : airco.reachable === false
                      ? "offline"
                      : ""
                }`}
              />
              <span className="unit-tab-text">
                <strong>{airco.displayName}</strong>
                <small>{airco.location}</small>
              </span>
            </button>
          ))}
        </section>
      )}

      {error && (
        <div className="banner error" role="alert">
          <p>{error}</p>
          <button onClick={() => setError("")} aria-label="Dismiss">
            <Icon name="close" size={15} />
          </button>
        </div>
      )}
      {selected?.reachable === false && (
        <div className="banner warning" role="status">
          <p>
            <strong>Unit offline.</strong> Check that it is powered and on the same
            local network; controls will report an error until it reconnects.
          </p>
        </div>
      )}

      {!selected ? (
        <section className="empty-card">
          <div className="brand-mark">
            <BrandMark />
          </div>
          <h2>No aircos configured</h2>
          <p className="muted">
            Add the first unit by entering its network address, or scan your local
            network for it.
          </p>
          <button className="primary-button" onClick={openAdd}>
            <Icon name="plus" /> Add airco
          </button>
        </section>
      ) : (
        <>
          <section className="climate-card">
            <h2 className="climate-title">
              <span>{selected.displayName}</span>
              <small>{selected.location}</small>
            </h2>

            <div className="dial">
              <button
                className="step"
                aria-label="Decrease temperature"
                disabled={
                  !canControl ||
                  targetTemperature === undefined ||
                  targetTemperature <= MIN_TEMPERATURE
                }
                onClick={() => nudgeTemperature(-1)}
              >
                <Icon name="minus" size={22} />
              </button>

              <div className="reading">
                <div className={`reading-value ${targetTemperature === undefined ? "blank" : ""}`}>
                  <strong>{targetTemperature ?? "--"}</strong>
                  {targetTemperature !== undefined && <sup>°</sup>}
                </div>
                <p className="reading-caption">
                  {view.power === false
                    ? "Off"
                    : stateKnown
                      ? `${labelFor(MODES, view.mode) ?? "Unknown mode"} · target`
                      : "Waiting for the unit"}
                </p>
              </div>

              <button
                className="step"
                aria-label="Increase temperature"
                disabled={
                  !canControl ||
                  targetTemperature === undefined ||
                  targetTemperature >= MAX_TEMPERATURE
                }
                onClick={() => nudgeTemperature(1)}
              >
                <Icon name="plus" size={22} />
              </button>
            </div>

            <div className="climate-foot">
              {/* Status and room reading share one control, and that control is
                  the refresh: tapping what looks stale is the natural gesture. */}
              <button
                className={`live ${
                  online ? "online" : selected.reachable === false ? "offline" : ""
                } ${showTime ? "revealed" : ""}`}
                disabled={busy !== null}
                onClick={refreshNow}
                aria-label={`Refresh status. Last seen ${timeLabel(selected.lastSeen)}`}
                title={`Last seen ${timeLabel(selected.lastSeen)} — tap to refresh`}
              >
                <span className="live-room">
                  Room{" "}
                  <strong>
                    {view.indoorTemperature === undefined
                      ? "—"
                      : /* Always one decimal: the reading has half-degree
                           resolution, and a fixed width stops it twitching. */
                        `${view.indoorTemperature.toFixed(1)}°`}
                  </strong>
                </span>
                {/* The dot alone carries the state; the timing only appears
                    when asked for, on hover, focus or tap. */}
                <span className="live-when">
                  {busy === "probe" || unchecked
                    ? "Checking…"
                    : online
                      ? relativeLabel(selected.lastSeen)
                      : "Offline"}
                </span>
                <span className="status-dot" />
              </button>
              <button
                className={`power-button ${view.power ? "active" : ""}`}
                disabled={!canControl}
                aria-pressed={Boolean(view.power)}
                aria-label={view.power ? "Turn off" : "Turn on"}
                onClick={() => void send("power", !view.power)}
              >
                <Icon name="power" size={22} />
                <span>{view.power ? "On" : "Off"}</span>
              </button>
            </div>
          </section>

          <section className="controls-card">
            <SegmentedRow
              label="Mode"
              options={MODES}
              value={view.mode}
              disabled={!canControl}
              onSelect={(value) => void send("mode", value)}
            />
            <SegmentedRow
              label="Fan speed"
              options={FANS}
              value={view.fan}
              disabled={!canControl}
              scroll
              onSelect={(value) => void send("fan", value)}
            />
            <SegmentedRow
              label="Swing"
              options={SWINGS}
              value={view.swing}
              disabled={!canControl}
              onSelect={(value) => void send("swing", value)}
            />
            <div className="toggle-row">
              <ToggleTile
                icon="quiet"
                label="Quiet"
                on={view.quiet}
                disabled={!canControl}
                onToggle={() => void send("quiet", !view.quiet)}
              />
              <ToggleTile
                icon="moon"
                label="Sleep"
                on={view.sleep}
                disabled={!canControl}
                onToggle={() => void send("sleep", !view.sleep)}
              />
              <ToggleTile
                icon="leaf"
                label="Eco"
                on={view.eco}
                disabled={!canControl}
                onToggle={() => void send("eco", !view.eco)}
              />
              <ToggleTile
                icon="health"
                label="Health"
                on={view.health}
                disabled={!canControl}
                onToggle={() => void send("health", !view.health)}
              />
              <ToggleTile
                icon="bulb"
                label="Display light"
                on={view.light}
                disabled={!canControl}
                onToggle={() => void send("light", !view.light)}
              />
            </div>
          </section>

          <details className="drawer">
            <summary>
              <span>Connection</span>
              <small>
                {selected.host}:{selected.port}
              </small>
              <Icon name="chevron" size={16} />
            </summary>
            <div className="drawer-body">
              <dl className="details">
                <div>
                  <dt>Wi-Fi module (broadcast name)</dt>
                  <dd className="mono">{selected.deviceName || "Unknown"}</dd>
                </div>
                <div>
                  <dt>Network address</dt>
                  <dd className="mono">
                    {selected.host}:{selected.port}
                  </dd>
                </div>
                <div>
                  <dt>MAC address</dt>
                  <dd className="mono">{selected.mac || "Unknown"}</dd>
                </div>
                <div>
                  <dt>Last seen</dt>
                  <dd>{timeLabel(selected.lastSeen)}</dd>
                </div>
              </dl>
              <button className="secondary-button wide" onClick={() => openEdit(selected)}>
                <Icon name="settings" size={17} /> Configure this airco
              </button>
            </div>
          </details>

          <details className="drawer">
            <summary>
              <span>Activity</span>
              <small>{selected.logs.length} events</small>
              <Icon name="chevron" size={16} />
            </summary>
            <div className="drawer-body">
              <ul className="log-list">
                {selected.logs.map((entry, index) => (
                  <li key={`${entry.at}-${index}`}>
                    <span className={`log-dot ${entry.level}`} />
                    <div>
                      <p>{entry.message}</p>
                      <time>{timeLabel(entry.at)}</time>
                    </div>
                  </li>
                ))}
              </ul>
              <button
                className="secondary-button wide"
                disabled={busy !== null}
                onClick={() => void downloadDiagnostics()}
              >
                <Icon name="sync" size={16} />
                {busy === "diagnostics" ? "Preparing…" : "Download safe diagnostics"}
              </button>
            </div>
          </details>
        </>
      )}

      <footer>
        <button onClick={openSettings}>
          <Icon name="settings" size={14} /> Settings
        </button>
      </footer>

      {settingsOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSettingsOpen(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setSettingsOpen(false);
          }}
        >
          <section
            className="config-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
          >
            <div className="section-title">
              <div>
                <p className="eyebrow">{PROJECT.name}</p>
                <h2 id="settings-title">Settings</h2>
              </div>
              <button
                className="icon-button"
                autoFocus
                onClick={() => setSettingsOpen(false)}
                aria-label="Close"
              >
                <Icon name="close" />
              </button>
            </div>
            <form className="config-form" onSubmit={saveAccess}>
              <div className="setting-row">
                <div>
                  <strong>Require an access token</strong>
                  <small>
                    While off, anyone who can reach this machine on the network can
                    control your aircos.
                  </small>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={tokenWanted}
                  aria-label="Require an access token"
                  className={`switch ${tokenWanted ? "on" : ""}`}
                  disabled={snapshot?.authManagedByEnv}
                  onClick={() => setTokenWanted(!tokenWanted)}
                >
                  <span />
                </button>
              </div>

              {snapshot?.authManagedByEnv ? (
                <p className="muted small">
                  The token is pinned by <code>AIRCO_TOKEN</code> in the environment.
                  Remove it from <code>.env.local</code> to manage it here.
                </p>
              ) : (
                tokenWanted && (
                  <div className="token-setting">
                    <label htmlFor="settings-token">
                      {snapshot?.authRequired
                        ? "New token (leave blank to keep the current one)"
                        : "Token"}
                    </label>
                    <div className="token-field">
                      <input
                        id="settings-token"
                        type="text"
                        value={tokenDraft}
                        onChange={(event) => {
                          setTokenDraft(event.target.value);
                          setTokenCopyMessage("");
                        }}
                        placeholder={
                          snapshot?.authRequired
                            ? "Unchanged"
                            : `At least ${MIN_TOKEN_LENGTH} characters`
                        }
                        aria-describedby="settings-token-status"
                        autoCapitalize="none"
                        spellCheck={false}
                      />
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => void generateToken()}
                      >
                        Generate
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={!tokenDraft.trim()}
                        onClick={() => void copyToken()}
                      >
                        Copy
                      </button>
                    </div>
                    <p
                      id="settings-token-status"
                      className="token-copy-status"
                      role="status"
                      aria-live="polite"
                    >
                      {tokenCopyMessage}
                    </p>
                  </div>
                )
              )}

              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              <div className="modal-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setSettingsOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="primary-button"
                  disabled={busy !== null || snapshot?.authManagedByEnv}
                >
                  {busy === "settings" ? "Saving…" : "Save"}
                </button>
              </div>
              <p className="project-notice">{PROJECT_DISCLAIMER}</p>
            </form>
          </section>
        </div>
      )}

      {editing !== undefined && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setEditing(undefined);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setEditing(undefined);
          }}
        >
          <section
            className="config-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="config-title"
          >
            <div className="section-title">
              <div>
                <p className="eyebrow">Configuration</p>
                <h2 id="config-title">
                  {editing ? `Edit ${editing.displayName}` : "Add airco"}
                </h2>
              </div>
              <button
                className="icon-button"
                autoFocus
                onClick={() => setEditing(undefined)}
                aria-label="Close"
              >
                <Icon name="close" />
              </button>
            </div>
            <form className="config-form" onSubmit={saveAirco}>
              <label>
                Airco name
                <input
                  value={form.displayName}
                  onChange={(event) =>
                    setForm({ ...form, displayName: event.target.value })
                  }
                  placeholder="Living room airco"
                  required
                />
              </label>
              <label>
                Location
                <input
                  value={form.location}
                  onChange={(event) => setForm({ ...form, location: event.target.value })}
                  placeholder="Living room"
                  required
                />
              </label>
              <div className="field-row">
                <label>
                  IP address or hostname
                  <input
                    value={form.host}
                    onChange={(event) => {
                      // Module details found for a new unit belong to the address they
                      // came from. A saved unit keeps them: its MAC is what recognises
                      // the same unit after its address changes.
                      setForm({
                        ...form,
                        host: event.target.value,
                        ...(editing
                          ? {}
                          : {
                              mac: undefined,
                              deviceName: undefined,
                              model: undefined,
                              protocol: undefined,
                            }),
                      });
                      setAddressCheck(null);
                    }}
                    placeholder="ac.local"
                    required
                  />
                </label>
                <label className="port-field">
                  Port
                  <input
                    type="number"
                    min="1"
                    max="65535"
                    value={form.port}
                    onChange={(event) =>
                      setForm({ ...form, port: Number(event.target.value) })
                    }
                    required
                  />
                </label>
              </div>
              <div className="config-scan">
                <div>
                  <strong>Check this address</strong>
                  <small>
                    Ask the unit to identify itself. Also works over a VPN, where scanning
                    can&apos;t reach.
                  </small>
                </div>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy !== null || !form.host.trim()}
                  onClick={checkAddress}
                >
                  {busy === "identify" ? "Checking…" : "Check"}
                </button>
              </div>
              {addressCheck && (
                <p
                  className={`address-check ${addressCheck.found ? "found" : "missing"}`}
                  role={addressCheck.found ? "status" : "alert"}
                >
                  {addressCheck.message}
                </p>
              )}
              {(form.deviceName || form.mac) && (
                <div className="hardware-summary">
                  <span>Wi-Fi module</span>
                  <strong className="mono">{form.deviceName || "Unknown"}</strong>
                  <small className="mono">{form.mac || "MAC unknown"}</small>
                </div>
              )}
              <div className="config-scan">
                <div>
                  <strong>Find an airco automatically</strong>
                  <small>Search this Wi-Fi network for compatible modules.</small>
                </div>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy !== null}
                  onClick={() => runAction("discover")}
                >
                  <Icon name="scan" size={17} />
                  {busy === "discover" ? "Scanning…" : "Scan"}
                </button>
              </div>
              {discovered.length > 0 && (
                <div className="discovered">
                  <p className="form-label">Discovered on this network</p>
                  {discovered.map((device) => (
                    <button
                      type="button"
                      key={`${device.mac}-${device.host}`}
                      onClick={() => applyDiscoveredDevice(device)}
                    >
                      <span>
                        <strong>{device.name || "Airco module"}</strong>
                        <small className="mono">
                          {device.host}:{device.port}
                        </small>
                      </span>
                      <span className="use">Use</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="modal-actions">
                {editing && (
                  <button
                    type="button"
                    className="danger-button"
                    disabled={busy !== null}
                    onClick={deleteAirco}
                  >
                    Remove
                  </button>
                )}
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setEditing(undefined)}
                >
                  Cancel
                </button>
                <button type="submit" className="primary-button" disabled={busy !== null}>
                  {busy === "save" ? "Saving…" : "Save airco"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
