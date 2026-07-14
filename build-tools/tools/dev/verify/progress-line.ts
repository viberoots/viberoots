import {
  formatVerifyProgressLine,
  formatVerifyProgressLines,
  type VerifyProgressPassState,
} from "./progress-line-format";

export {
  formatVerifyProgressLine,
  formatVerifyProgressLines,
  type VerifyProgressPassState,
} from "./progress-line-format";

type ProgressStream = {
  isTTY?: boolean;
  write(chunk: string): unknown;
};

const FALSE_VALUES = new Set(["0", "false", "no", "off", "none"]);

function useColor(stream: ProgressStream, env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(stream.isTTY) && String(env.NO_COLOR || "").trim() === "";
}

function supportsCursorRedraw(
  stream: ProgressStream,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!stream.isTTY) return false;
  if (String(env.TERM || "").trim() === "dumb") return false;
  if (String(env.CI || "").trim()) return false;
  return true;
}

export function createVerifyProgressReporter(opts: {
  enabled: boolean;
  passes: Array<{ name: string; total: number }>;
  stream?: ProgressStream;
  now?: () => number;
  env?: NodeJS.ProcessEnv;
}): {
  start: () => void;
  update: (passName: string, state: Partial<Omit<VerifyProgressPassState, "name">>) => void;
  stop: (opts?: { clear?: boolean }) => void;
} {
  const stream = opts.stream || process.stdout;
  const hasPasses = opts.passes.length > 0;
  const now = opts.now || (() => Date.now());
  const env = opts.env || process.env;
  const useCursorRedraw = supportsCursorRedraw(stream, env);
  const shouldColor = useColor(stream, env);
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
  const lastStaticRenderedByPass = new Map<string, string>();

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
    if (useCursorRedraw) {
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

  const snapshotForPass = (passName: string): VerifyProgressPassState | null => {
    const pass = opts.passes.find((candidate) => candidate.name === passName);
    if (!pass) return null;
    const state = states.get(pass.name);
    if (!state) return null;
    const startMs = startedAtByPass.get(pass.name);
    const completedElapsedMs = elapsedByCompletedPass.get(pass.name);
    return {
      name: pass.name,
      ...state,
      elapsedMs: completedElapsedMs ?? (startMs === undefined ? 0 : now() - startMs),
    };
  };

  const writeStaticPass = (passName: string, force = false) => {
    if (!opts.enabled || !hasPasses) return;
    const state = snapshotForPass(passName);
    if (!state) return;
    const nameWidth = Math.max(1, ...opts.passes.map((pass) => pass.name.length));
    const rendered = formatVerifyProgressLine(state, { color: shouldColor, nameWidth });
    if (!force && rendered === lastStaticRenderedByPass.get(passName)) return;
    const ts = now();
    if (!force && ts - lastNonTtyWriteMs < 30_000) return;
    stream.write(`${rendered}\n`);
    lastStaticRenderedByPass.set(passName, rendered);
    lastNonTtyWriteMs = ts;
  };

  const writeStaticRunningPasses = () => {
    if (!opts.enabled || !hasPasses) return;
    const ts = now();
    if (ts - lastNonTtyWriteMs < 30_000) return;
    for (const pass of opts.passes) {
      const state = states.get(pass.name);
      if (state?.status === "running") writeStaticPass(pass.name, true);
    }
  };

  return {
    start: () => {
      if (!opts.enabled || !hasPasses || timer) return;
      if (useCursorRedraw) write(true);
      timer = setInterval(
        () => (useCursorRedraw ? write() : writeStaticRunningPasses()),
        useCursorRedraw ? 1000 : 30_000,
      );
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
      const terminal = next.status === "done" || next.status === "failed";
      if (useCursorRedraw) write(terminal);
      else writeStaticPass(passName, terminal || next.status === "running");
    },
    stop: (stopOpts) => {
      if (timer) clearInterval(timer);
      timer = null;
      if (!opts.enabled) return;
      if (useCursorRedraw && stopOpts?.clear !== false && renderedLines > 0) {
        stream.write(`\r\u001b[${renderedLines}A`);
        stream.write("\r\u001b[J");
      } else if (useCursorRedraw && renderedLines > 0) {
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
