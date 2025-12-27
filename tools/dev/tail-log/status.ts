import path from "node:path";
import process from "node:process";
import { runNodeWithZx } from "../../lib/node-run.ts";
import type { TailLogArgs } from "./args.ts";
import { repoRoot, zxInitPath } from "./paths.ts";
import { resolveLatest, resolvePid, pidAlive } from "./resolve.ts";
import type { Resolution } from "./resolve.ts";

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

async function runVerifyLogStatusOnce(
  logPath: string,
  pid: number,
  json: boolean,
): Promise<string> {
  const args = ["--log", logPath, "--pid", String(pid)];
  if (json) args.push("--json");
  const out = await runNodeWithZx({
    script: path.join(repoRoot, "tools", "dev", "verify-log-status.ts"),
    args,
    zxInitPath,
    stdio: "pipe",
    env: { ...process.env, DIRENV_LOG_FORMAT: "" },
  });
  return (out.stdout || "") + (out.stderr || "");
}

async function resolveForArgs(args: TailLogArgs): Promise<Resolution> {
  return args.selection.kind === "latest"
    ? await resolveLatest()
    : await resolvePid(args.selection.pid);
}

export async function runStatusOnce(args: TailLogArgs): Promise<void> {
  const res = await resolveForArgs(args);
  if (!res.logPath) {
    process.stderr.write(`error: ${res.error}\n`);
    process.exit(2);
    return;
  }
  try {
    const out = await runVerifyLogStatusOnce(res.logPath, res.pid || 0, args.json);
    process.stdout.write(args.json ? String(out).trimEnd() + "\n" : out);
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
          const s = await runVerifyLogStatusOnce(res.logPath, pid, true);
          process.stdout.write(String(s).trimEnd() + "\n");
        } catch {
          process.stdout.write(emptyNdjson(pid, "log file missing") + "\n");
        }
      } else {
        let out = "";
        try {
          out = await runVerifyLogStatusOnce(res.logPath, pid, false);
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
      const alive = await pidAlive(args.selection.pid);
      if (!alive) return;
    }
    await new Promise((r) => setTimeout(r, intervalSec * 1000));
  }
}
