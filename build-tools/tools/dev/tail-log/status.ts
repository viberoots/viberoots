import fsp from "node:fs/promises";
import process from "node:process";
import {
  computeVerifyStatusFromLogText,
  formatVerifyStatusJsonLine,
  formatVerifyStatusText,
} from "../../lib/verify-log-status.ts";
import type { TailLogArgs } from "./args.ts";
import type { Resolution } from "./resolve.ts";
import { pidAliveWithSignature, pidStartSignature, resolveLatest, resolvePid } from "./resolve.ts";
import { clearScreen, getExtraStatusLines, trimToTerminal } from "./status-helpers.ts";

function emptyNdjson(pid: number, error: string): string {
  return JSON.stringify({
    pid,
    pass: 0,
    fail: 0,
    fatal: 0,
    skip: 0,
    build_failure: 0,
    remaining: null,
    failed: [],
    done: false,
    elapsed: null,
    log: null,
    source: "derived",
    error,
  });
}

async function computeStatusFromLogPath(logPath: string, pid: number) {
  const text = await fsp.readFile(logPath, "utf8");
  return computeVerifyStatusFromLogText({ logPath, pid: pid || undefined, text });
}

async function resolveForArgs(args: TailLogArgs): Promise<Resolution> {
  if (args.selection.kind === "latest") return await resolveLatest();
  return await resolvePid(args.selection.pid);
}

export async function runStatusOnce(args: TailLogArgs): Promise<void> {
  process.stdout.on("error", (e: any) => {
    // When consumers pipe `s --json` into tools like `head`, stdout can be closed early.
    // Treat broken pipes as a clean exit.
    if (e?.code === "EPIPE") process.exit(0);
  });
  const res = await resolveForArgs(args);
  if (!res.logPath) {
    process.stderr.write(`error: ${res.error}\n`);
    process.exit(2);
    return;
  }
  try {
    const st = await computeStatusFromLogPath(res.logPath, res.pid || 0);
    const out = args.json
      ? formatVerifyStatusJsonLine(st)
      : formatVerifyStatusText(st, {
          isTty: Boolean(process.stdout.isTTY) || (process.env.FORCE_COLOR || "") === "1",
        });
    const formatted = String(out).trimEnd();
    const lines = args.json ? [formatted] : trimToTerminal(formatted, process.stdout.columns);
    process.stdout.write(lines.join("\n") + "\n");
    process.exit(0);
  } catch (e: any) {
    process.stderr.write(String(e?.stderr || e?.message || e) + "\n");
    process.exit(2);
  }
}

export async function renderStatusWatchLoop(args: TailLogArgs): Promise<void> {
  const isTty = Boolean(process.stdout.isTTY);
  const json = args.json;
  const intervalSec = args.watchIntervalSec;
  const showExtras = (process.env.TAIL_LOG_EXTRA_STATUS || "") === "1";

  process.stdout.on("error", (e: any) => {
    // Watch mode writes repeatedly; piping to `head` will close stdout quickly.
    if (e?.code === "EPIPE") process.exit(0);
  });

  const pidSig = args.selection.kind === "pid" ? await pidStartSignature(args.selection.pid) : "";

  let prevLines = 0;
  let prevCols = process.stdout.columns;
  let prevRows = process.stdout.rows;
  let needsClear = false;
  let wake: (() => void) | null = null;
  let wakeTimer: NodeJS.Timeout | null = null;
  let inFlight = false;
  let rerender = false;
  let stopped = false;
  const requestRefresh = () => {
    needsClear = true;
    if (wakeTimer) {
      clearTimeout(wakeTimer);
      wakeTimer = null;
    }
    if (wake) {
      const fn = wake;
      wake = null;
      fn();
    }
  };
  const onResize = () => {
    if (stopped) return;
    requestRefresh();
    void renderOnce().then((done) => {
      if (done) stopped = true;
    });
  };

  if (isTty && !json) process.stdout.write("\u001b[?25l");
  const restore = () => {
    if (isTty && !json) process.stdout.write("\u001b[?25h\n");
  };
  process.on("SIGINT", () => {
    restore();
    process.exit(130);
  });
  process.on("exit", () => {
    if (isTty && !json) process.stdout.off("resize", onResize);
    restore();
  });
  if (isTty && !json) process.stdout.on("resize", onResize);

  const renderOnce = async (): Promise<boolean> => {
    if (stopped) return true;
    if (inFlight) {
      rerender = true;
      return false;
    }
    inFlight = true;
    let done = false;
    try {
      const res = await resolveForArgs(args);
      const pid = res.pid || 0;
      if (isTty && !json) {
        const curCols = process.stdout.columns;
        const curRows = process.stdout.rows;
        if (curCols !== prevCols || curRows !== prevRows) {
          prevCols = curCols;
          prevRows = curRows;
          needsClear = true;
        }
      }
      const extraLines = showExtras && !json ? getExtraStatusLines(isTty) : "";

      if (res.logPath) {
        if (json) {
          try {
            const st = await computeStatusFromLogPath(res.logPath, pid);
            process.stdout.write(formatVerifyStatusJsonLine(st) + "\n");
          } catch {
            process.stdout.write(emptyNdjson(pid, "log file missing") + "\n");
          }
        } else {
          let out = "";
          try {
            const st = await computeStatusFromLogPath(res.logPath, pid);
            out = formatVerifyStatusText(st, {
              isTty: isTty || (process.env.FORCE_COLOR || "") === "1",
            });
          } catch {
            out =
              "Time elapsed: ?\nTests so far:   Pass 0. Fail 0. Fatal 0. Skip 0. Build failure 0\nLog: (missing)\n(error: log file missing; waiting...)";
          }
          out = String(out).trimEnd();
          if (extraLines) out = `${extraLines}\n${out}`;
          if (isTty) {
            if (needsClear) {
              process.stdout.write(clearScreen());
              prevLines = 0;
            }
            if (prevLines > 0) process.stdout.write(`\u001b[${prevLines}A`);
            process.stdout.write("\u001b[J");
          }
          const lines = trimToTerminal(out, process.stdout.columns);
          process.stdout.write(lines.join("\n") + "\n");
          prevLines = Math.max(1, lines.length);
          needsClear = false;
        }
      } else {
        if (json) {
          process.stdout.write(emptyNdjson(pid, res.error) + "\n");
        } else {
          let out = `Time elapsed: ?\nTests so far:   Pass 0. Fail 0. Fatal 0. Skip 0. Build failure 0\nLog: (missing)\n(error: ${res.error}; waiting...)`;
          if (extraLines) out = `${extraLines}\n${out}`;
          if (isTty) {
            if (needsClear) {
              process.stdout.write(clearScreen());
              prevLines = 0;
            }
            if (prevLines > 0) process.stdout.write(`\u001b[${prevLines}A`);
            process.stdout.write("\u001b[J");
          }
          const lines = trimToTerminal(out, process.stdout.columns);
          process.stdout.write(lines.join("\n") + "\n");
          prevLines = Math.max(1, lines.length);
          needsClear = false;
        }
      }

      if (args.selection.kind === "pid") {
        if (!pidSig) {
          done = true;
        } else {
          const alive = await pidAliveWithSignature(args.selection.pid, pidSig);
          if (!alive) done = true;
        }
      }
    } finally {
      inFlight = false;
      if (done) stopped = true;
      if (rerender && !stopped) {
        rerender = false;
        void renderOnce().then((ended) => {
          if (ended) stopped = true;
        });
      }
    }
    return done;
  };

  while (true) {
    const done = await renderOnce();
    if (done) return;
    await new Promise<void>((r) => {
      wake = r;
      wakeTimer = setTimeout(() => {
        if (wake === r) wake = null;
        wakeTimer = null;
        r();
      }, intervalSec * 1000);
    });
  }
}
