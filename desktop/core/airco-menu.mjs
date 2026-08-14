export const AIRCO_MODES = [
  ["auto", "Auto"],
  ["cool", "Cool"],
  ["dry", "Dry"],
  ["fan", "Fan"],
  ["heat", "Heat"],
];

export const AIRCO_TEMPERATURES = Array.from({ length: 15 }, (_, index) => index + 16);

function titleMode(mode) {
  return AIRCO_MODES.find(([value]) => value === mode)?.[1] || "Unknown mode";
}

function temperature(value) {
  return Number.isFinite(value) ? `${value}°C` : null;
}

export function recordAircoActionResult(notices, aircoId, result) {
  if (result?.confirmed === false) notices.set(aircoId, "Sent — not confirmed");
  else notices.delete(aircoId);
  return result;
}

export function formatAircoStatus(airco) {
  if (!airco?.lastState) {
    if (airco?.reachable === false) return "Offline · Refresh to retry";
    if (airco?.reachable === true) return "Online · No status received";
    return "Status not read yet";
  }

  const state = airco.lastState;
  const parts = [
    typeof state.power === "boolean" ? (state.power ? "On" : "Off") : "Power unknown",
  ];
  if (state.mode) parts.push(titleMode(state.mode));
  const room = temperature(state.indoorTemperature);
  const target = temperature(state.targetTemperature);
  if (room) parts.push(`Room ${room}`);
  if (target) parts.push(`Target ${target}`);
  return parts.join(" · ");
}

export function buildAircoMenuItems({
  snapshot,
  loading = false,
  loadError = false,
  busyIds = new Set(),
  notices = new Map(),
  onRefreshList,
  onProbe,
  onControl,
}) {
  const items = [{ label: "Air Conditioners", enabled: false }];

  if (!snapshot) {
    items.push({
      label: loading ? "Loading aircos…" : loadError ? "Aircos unavailable" : "No aircos loaded",
      enabled: false,
    });
    items.push({ label: "Retry Menu Status", enabled: !loading, click: onRefreshList });
    return items;
  }

  if (!snapshot.aircos.length) {
    items.push({ label: "No aircos configured", enabled: false });
    items.push({ label: "Refresh Menu Status", enabled: !loading, click: onRefreshList });
    return items;
  }

  for (const airco of snapshot.aircos) {
    const state = airco.lastState;
    const busy = busyIds.has(airco.id);
    const hasPower = typeof state?.power === "boolean";
    const currentTarget = Number.isFinite(state?.targetTemperature)
      ? state.targetTemperature
      : null;
    const notice = notices.get(airco.id);
    items.push({
      label: airco.displayName,
      submenu: [
        {
          label: busy
            ? "Updating…"
            : [notice, formatAircoStatus(airco)].filter(Boolean).join(" · "),
          enabled: false,
        },
        {
          label: "Refresh Device Status",
          enabled: !busy,
          click: () => onProbe(airco.id),
        },
        { type: "separator" },
        {
          label: hasPower ? "Power" : "Power (refresh status first)",
          type: "checkbox",
          checked: state?.power === true,
          enabled: !busy && hasPower,
          click: () => onControl(airco.id, "power", !state?.power),
        },
        {
          label: `Mode${state?.mode ? ` — ${titleMode(state.mode)}` : ""}`,
          enabled: !busy,
          submenu: AIRCO_MODES.map(([value, label]) => ({
            label,
            type: "radio",
            checked: state?.mode === value,
            click: () => onControl(airco.id, "mode", value),
          })),
        },
        {
          label: `Target Temperature${currentTarget === null ? "" : ` — ${currentTarget}°C`}`,
          enabled: !busy,
          submenu: AIRCO_TEMPERATURES.map((value) => ({
            label: `${value}°C`,
            type: "radio",
            checked: currentTarget === value,
            click: () => onControl(airco.id, "temperature", value),
          })),
        },
      ],
    });
  }

  return items;
}
