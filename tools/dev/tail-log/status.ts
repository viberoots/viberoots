import process from "node:process";
import fsp from "node:fs/promises";
import type { TailLogArgs } from "./args.ts";
import { resolveLatest, resolvePid, pidAliveWithSignature, pidStartSignature } from "./resolve.ts";
import type { Resolution } from "./resolve.ts";
import { computeVerifyStatusFromLogText } from "../../lib/verify-log-status.ts";

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

function formatStatusJsonLine(st: ReturnType<typeof computeVerifyStatusFromLogText>): string {
  // Stable JSON keys for scripting.
  const out = {
    pid: st.pid,
    pass: st.pass,
    fail: st.fail,
    fatal: st.fatal,
    skip: st.skip,
    build_failure: st.buildFailure,
    remaining: st.remaining ?? null,
    failed: st.failed,
    done: st.done,
    elapsed: st.elapsed ?? null,
    log: st.logPath,
    source: st.source,
  };
  return JSON.stringify(out);
}

function formatStatusText(st: ReturnType<typeof computeVerifyStatusFromLogText>): string {
  const elapsed = st.elapsed ? st.elapsed : "?";
  const remaining = st.remaining !== undefined ? String(st.remaining) : "?";
  const anyFailures = st.fail > 0 || st.fatal > 0 || st.buildFailure > 0;
  const testsLabel = st.done ? "Tests finished:" : "Tests so far:";
  const header = `Time elapsed: ${elapsed}\n${testsLabel}   Pass ${st.pass}. Fail ${st.fail}. Fatal ${st.fatal}. Skip ${st.skip}. Build failure ${st.buildFailure}\nTests remaining: ${remaining}\nLog: ${st.logPath}`;
  if (!anyFailures || st.failed.length === 0) return header;
  const cap = 10;
  const shown = st.failed.slice(0, cap);
  const lines = [
    header,
    "",
    `Failing tests (${st.failed.length}):`,
    ...shown.map((t) => `  - ${t}`),
  ];
  if (st.failed.length > cap) lines.push(`  ... and ${st.failed.length - cap} more`);
  return lines.join("\n");
}

async function resolveForArgs(args: TailLogArgs): Promise<Resolution> {
  if (args.selection.kind === "latest") return await resolveLatest();
  return await resolvePid(args.selection.pid);
}

export async function runStatusOnce(args: TailLogArgs): Promise<void> {
  const res = await resolveForArgs(args);
  if (!res.logPath) {
    process.stderr.write(`error: ${res.error}\n`);
    process.exit(2);
    return;
  }
  try {
    const st = await computeStatusFromLogPath(res.logPath, res.pid || 0);
    const out = args.json ? formatStatusJsonLine(st) : formatStatusText(st);
    process.stdout.write(String(out).trimEnd() + "\n");
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

  const pidSig = args.selection.kind === "pid" ? await pidStartSignature(args.selection.pid) : "";

  let prevLines = 0;
  if (isTty && !json) process.stdout.write("\u001b[?25l");
  const restore = () => {
    if (isTty && !json) process.stdout.write("\u001b[?25h\n");
  };
  process.on("SIGINT", () => {
    restore();
    process.exit(130);
  });
  process.on("exit", restore);

  while (true) {
    const res = await resolveForArgs(args);
    const pid = res.pid || 0;

    if (res.logPath) {
      if (json) {
        try {
          const st = await computeStatusFromLogPath(res.logPath, pid);
          process.stdout.write(formatStatusJsonLine(st) + "\n");
        } catch {
          process.stdout.write(emptyNdjson(pid, "log file missing") + "\n");
        }
      } else {
        let out = "";
        try {
          const st = await computeStatusFromLogPath(res.logPath, pid);
          out = formatStatusText(st);
        } catch {
          out =
            "Time elapsed: ?\nTests so far:   Pass 0. Fail 0. Fatal 0. Skip 0. Build failure 0\nLog: (missing)\n(error: log file missing; waiting...)";
        }
        out = String(out).trimEnd();
        if (isTty) {
          if (prevLines > 0) process.stdout.write(`\u001b[${prevLines}A`);
          process.stdout.write("\u001b[J");
        }
        process.stdout.write(out + "\n");
        prevLines = Math.max(1, out.split("\n").length);
      }
    } else {
      if (json) {
        process.stdout.write(emptyNdjson(pid, res.error) + "\n");
      } else {
        const out = `Time elapsed: ?\nTests so far:   Pass 0. Fail 0. Fatal 0. Skip 0. Build failure 0\nLog: (missing)\n(error: ${res.error}; waiting...)`;
        if (isTty) {
          if (prevLines > 0) process.stdout.write(`\u001b[${prevLines}A`);
          process.stdout.write("\u001b[J");
        }
        process.stdout.write(out + "\n");
        prevLines = Math.max(1, out.split("\n").length);
      }
    }

    if (args.selection.kind === "pid") {
      if (!pidSig) return;
      const alive = await pidAliveWithSignature(args.selection.pid, pidSig);
      if (!alive) return;
    }
    await new Promise((r) => setTimeout(r, intervalSec * 1000));
  }
}
