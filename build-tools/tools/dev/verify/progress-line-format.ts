import { formatProgressBar } from "../../lib/progress-bar";

type PassStatus = "pending" | "running" | "done" | "failed";

export type VerifyProgressPassState = {
  name: string;
  completed: number;
  failed: number;
  total: number;
  elapsedMs: number;
  status: PassStatus;
};

function color(code: string, value: string, enabled: boolean): string {
  return enabled ? `\u001b[${code}m${value}\u001b[0m` : value;
}

function progressColorCode(state: VerifyProgressPassState): string {
  if (state.status === "failed" || state.failed > 0) return "31";
  if (state.status === "done") return "32";
  return "33";
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  if (minutes > 0) return `${minutes}:${String(seconds).padStart(2, "0")}`;
  return `${seconds}s`;
}

function projectedDurationMs(state: VerifyProgressPassState): number | undefined {
  if (state.total <= 0 || state.completed <= 0) return undefined;
  return Math.max(state.elapsedMs, (state.elapsedMs * state.total) / state.completed);
}

function normalizedProgress(state: VerifyProgressPassState) {
  const total = Math.max(0, state.total);
  const displayTotal = total > 0 ? total : Math.max(0, state.completed);
  const completed = Math.max(0, Math.min(displayTotal, state.completed));
  const projectedMs = projectedDurationMs({ ...state, completed });
  const ratio =
    projectedMs === undefined || projectedMs <= 0
      ? displayTotal > 0
        ? completed / displayTotal
        : undefined
      : state.elapsedMs / projectedMs;
  return { completed, displayTotal, projectedMs, ratio };
}

export function formatVerifyProgressLine(
  state: VerifyProgressPassState,
  opts: { color?: boolean; nameWidth?: number } = {},
): string {
  const { completed, displayTotal, projectedMs, ratio } = normalizedProgress(state);
  const colors = opts.color === true;
  const mark = color("36", "test", colors);
  const valueColor = progressColorCode(state);
  const name = state.name.padEnd(opts.nameWidth ?? state.name.length);
  const failed = state.failed > 0 ? ` fail ${state.failed}` : "";
  const elapsed = formatDuration(state.elapsedMs);
  const time =
    state.status === "done" || state.status === "failed"
      ? elapsed
      : projectedMs === undefined
        ? elapsed
        : `${elapsed} / ~${formatDuration(projectedMs)}`;
  const detail = `${name} ${formatProgressBar(ratio, 24)} ${completed}/${displayTotal}${failed} ${state.status} ${time}`;
  return `  ${mark.padEnd(colors ? 12 : 6)} ${color(valueColor, detail, colors)}`;
}

export function formatVerifyProgressLines(
  states: VerifyProgressPassState[],
  opts: { color?: boolean } = {},
): string[] {
  const nameWidth = Math.max(1, ...states.map((state) => state.name.length));
  return states.map((state) => formatVerifyProgressLine(state, { ...opts, nameWidth }));
}
