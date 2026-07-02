type ProgressStream = {
  isTTY?: boolean;
  write(chunk: string): unknown;
};

type PassStatus = "pending" | "running" | "done" | "failed";

export type VerifyProgressPassState = {
  name: string;
  completed: number;
  failed: number;
  total: number;
  elapsedMs: number;
  status: PassStatus;
};

const FALSE_VALUES = new Set(["0", "false", "no", "off", "none"]);

function useColor(stream: ProgressStream, env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(stream.isTTY) && String(env.NO_COLOR || "").trim() === "";
}

function color(code: string, value: string, enabled: boolean): string {
  return enabled ? `\u001b[${code}m${value}\u001b[0m` : value;
}

function progressColorCode(state: VerifyProgressPassState): string {
  if (state.status === "failed" || state.failed > 0) return "31";
  if (state.status === "done") return "32";
  if (state.status === "running") return "33";
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

function progressBar(ratio: number | undefined): string {
  const width = 24;
  if (ratio === undefined || !Number.isFinite(ratio)) return `[${"░".repeat(width)}]`;
  const clamped = Math.max(0, Math.min(1, ratio));
  const filled = Math.round(clamped * width);
  return `[${"█".repeat(filled)}${"░".repeat(width - filled)}]`;
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
  const detail = `${name} ${progressBar(ratio)} ${completed}/${displayTotal}${failed} ${state.status} ${time}`;
  return `  ${mark.padEnd(colors ? 12 : 6)} ${color(valueColor, detail, colors)}`;
}

export function formatVerifyProgressLines(
  states: VerifyProgressPassState[],
  opts: { color?: boolean } = {},
): string[] {
  const nameWidth = Math.max(1, ...states.map((state) => state.name.length));
  return states.map((state) => formatVerifyProgressLine(state, { ...opts, nameWidth }));
}

export function createVerifyProgressReporter(opts: {
  enabled: boolean;
  passes: Array<{ name: string; total: number }>;
  stream?: ProgressStream;
  now?: () => number;
}): {
  start: () => void;
  update: (passName: string, state: Partial<Omit<VerifyProgressPassState, "name">>) => void;
  stop: (opts?: { clear?: boolean }) => void;
} {
  const stream = opts.stream || process.stdout;
  const hasPasses = opts.passes.length > 0;
  const now = opts.now || (() => Date.now());
  const isTty = Boolean(stream.isTTY);
  const shouldColor = useColor(stream);
  const startedAtByPass = new Map<string, number>();
  const elapsedByCompletedPass = new Map<string, number>();
  const states = new Map<string, Omit<VerifyProgressPassState, "name" | "elapsedMs">>();
  for (const pass of opts.passes) {
    states.set(pass.name, {
      completed: 0,
      failed: 0,
      total: pass.total,
      status: "pending",
    });
  }
  let timer: NodeJS.Timeout | null = null;
  let renderedLines = 0;
  let lastNonTtyWriteMs = 0;
  let lastRendered = "";

  const snapshot = (): VerifyProgressPassState[] =>
    opts.passes.map((pass) => {
      const state = states.get(pass.name)!;
      const startMs = startedAtByPass.get(pass.name);
      const completedElapsedMs = elapsedByCompletedPass.get(pass.name);
      return {
        name: pass.name,
        ...state,
        elapsedMs: completedElapsedMs ?? (startMs === undefined ? 0 : now() - startMs),
      };
    });

  const write = (force = false) => {
    if (!opts.enabled || !hasPasses) return;
    const lines = formatVerifyProgressLines(snapshot(), { color: shouldColor });
    const rendered = lines.join("\n");
    if (!force && rendered === lastRendered) return;
    lastRendered = rendered;
    if (isTty) {
      if (renderedLines > 0) stream.write(`\r\u001b[${renderedLines}A`);
      stream.write("\r\u001b[J");
      stream.write(`${rendered}\n`);
      renderedLines = lines.length;
      return;
    }
    const ts = now();
    if (!force && ts - lastNonTtyWriteMs < 30_000) return;
    stream.write(`${rendered}\n`);
    lastNonTtyWriteMs = ts;
  };

  return {
    start: () => {
      if (!opts.enabled || !hasPasses || timer) return;
      write(true);
      timer = setInterval(() => write(), isTty ? 1000 : 30_000);
      timer.unref?.();
    },
    update: (passName, next) => {
      const current = states.get(passName);
      if (!current) return;
      if (next.status === "running" && !startedAtByPass.has(passName)) {
        startedAtByPass.set(passName, now());
      }
      if (
        (next.status === "done" || next.status === "failed") &&
        !elapsedByCompletedPass.has(passName)
      ) {
        const startMs = startedAtByPass.get(passName);
        elapsedByCompletedPass.set(passName, startMs === undefined ? 0 : now() - startMs);
      }
      const merged = { ...current, ...next };
      if (merged.status === "done" && merged.total > 0) {
        merged.completed = merged.total;
      }
      states.set(passName, merged);
      write();
    },
    stop: (stopOpts) => {
      if (timer) clearInterval(timer);
      timer = null;
      if (!opts.enabled) return;
      if (isTty && stopOpts?.clear !== false && renderedLines > 0) {
        stream.write(`\r\u001b[${renderedLines}A`);
        stream.write("\r\u001b[J");
      } else if (isTty && renderedLines > 0) {
        stream.write("\n");
      }
    },
  };
}

export function verifyProgressEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !FALSE_VALUES.has(
    String(env.VBR_VERIFY_PROGRESS || "")
      .trim()
      .toLowerCase(),
  );
}
