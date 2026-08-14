import type { ControlRequest } from "./protocol";

const BOOLEAN_ACTIONS = new Set(["power", "quiet", "sleep", "health", "eco", "light"]);
const MODES = new Set(["auto", "cool", "dry", "fan", "heat"]);
const FANS = new Set([
  "auto",
  "gear-1",
  "gear-2",
  "gear-3",
  "gear-4",
  "gear-5",
  "variable",
]);
const SWINGS = new Set(["off", "vertical", "horizontal", "both"]);

type Candidate = { aircoId?: unknown; action?: unknown; value?: unknown };

export type ControlEnvelope = { aircoId: string; control: ControlRequest };

export function parseControlEnvelope(value: unknown): ControlEnvelope | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Candidate;
  if (typeof candidate.aircoId !== "string" || !candidate.aircoId) return null;
  if (typeof candidate.action !== "string") return null;

  const { action } = candidate;
  if (BOOLEAN_ACTIONS.has(action) && typeof candidate.value === "boolean") {
    return {
      aircoId: candidate.aircoId,
      control: { action, value: candidate.value } as ControlRequest,
    };
  }
  if (
    action === "temperature" &&
    typeof candidate.value === "number" &&
    Number.isFinite(candidate.value) &&
    candidate.value >= 16 &&
    candidate.value <= 30
  ) {
    return { aircoId: candidate.aircoId, control: { action, value: candidate.value } };
  }
  if (action === "mode" && typeof candidate.value === "string" && MODES.has(candidate.value)) {
    return {
      aircoId: candidate.aircoId,
      control: { action, value: candidate.value } as ControlRequest,
    };
  }
  if (action === "fan" && typeof candidate.value === "string" && FANS.has(candidate.value)) {
    return {
      aircoId: candidate.aircoId,
      control: { action, value: candidate.value } as ControlRequest,
    };
  }
  if (action === "swing" && typeof candidate.value === "string" && SWINGS.has(candidate.value)) {
    return {
      aircoId: candidate.aircoId,
      control: { action, value: candidate.value } as ControlRequest,
    };
  }
  return null;
}
