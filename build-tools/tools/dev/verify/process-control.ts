import { spawn } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { buckProcessTableLines } from "../../lib/process-inspection";
import { processStartSignature } from "../../lib/process-inspection";
import { buildToolPath } from "../dev-build/paths";

export function buckIsolationProcessPidsFromLines(opts: {
  root: string;
  iso: string;
  lines: string[];
}): number[] {
  const root = path.resolve(opts.root);
  const stateDir = path.join(root, "buck-out", opts.iso, "forkserver");
  const pids = new Set<number>();
  const daemonByPid = new Map<number, string>();
  for (const line of opts.lines) {
    const parsed = line.match(/^(\d+)\s+(\d+)\s+\S+\s+(.*)$/);
    if (!parsed) continue;
    const pid = Number(parsed[1]);
    const cmd = parsed[3] || "";
    if (
      Number.isFinite(pid) &&
      cmd.includes("buck2d[") &&
      cmd.includes(` --isolation-dir ${opts.iso}`)
    ) {
      daemonByPid.set(pid, cmd);
    }
  }
  for (const line of opts.lines) {
    const parsed = line.match(/^(\d+)\s+(\d+)\s+\S+\s+(.*)$/);
    if (!parsed) continue;
    const pid = Number(parsed[1]);
    const ppid = Number(parsed[2]);
    const cmd = parsed[3] || "";
    if (!Number.isFinite(pid) || !Number.isFinite(ppid)) continue;
    if (!cmd.includes("(buck2-forkserver)") || !cmd.includes(`--state-dir ${stateDir}`)) {
      continue;
    }
    pids.add(pid);
    if (daemonByPid.has(ppid)) pids.add(ppid);
  }
  return [...pids].sort((a, b) => a - b);
}

async function forceKillBuckIsolationProcesses(root: string, iso: string): Promise<void> {
  const lines = await buckProcessTableLines(2000).catch(() => []);
  for (const pid of buckIsolationProcessPidsFromLines({ root, iso, lines })) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
}

export async function killBuckIsolation(root: string, iso: string): Promise<void> {
  await new Promise<void>((resolve) => {
    const child = spawn("buck2", ["--isolation-dir", iso, "kill"], {
      cwd: root,
      stdio: "ignore",
    });
    child.on("error", () => resolve());
    child.on("close", () => resolve());
  });
  await forceKillBuckIsolationProcesses(root, iso);
}

export async function killProcessGroup(pgid: number): Promise<void> {
  const alive = () => {
    try {
      process.kill(-pgid, 0);
      return true;
    } catch {
      return false;
    }
  };
  const sleep = async (ms: number) => await new Promise((resolve) => setTimeout(resolve, ms));

  try {
    process.kill(-pgid, "SIGTERM");
  } catch {}
  const termDeadline = Date.now() + 10_000;
  while (alive() && Date.now() < termDeadline) {
    await sleep(250);
  }
  if (!alive()) return;
  try {
    process.kill(-pgid, "SIGKILL");
  } catch {}
  const killDeadline = Date.now() + 2_000;
  while (alive() && Date.now() < killDeadline) {
    await sleep(100);
  }
  if (alive()) {
    try {
      process.kill(-pgid, "SIGKILL");
    } catch {}
  }
}

export async function writeVerifyIsoMarker(lockDir: string | null, iso: string): Promise<void> {
  if (!lockDir) return;
  await fsp.writeFile(path.join(lockDir, "iso"), iso, "utf8").catch(() => {});
}

export async function appendVerifyLogLine(logFile: string | null, line: string): Promise<void> {
  if (!logFile) return;
  await fsp.appendFile(logFile, line.endsWith("\n") ? line : line + "\n", "utf8").catch(() => {});
}

export async function startBuckDaemonReaper(opts: {
  root: string;
  zxInitPath: string;
  iso: string;
  stateFile: string;
}): Promise<void> {
  const parentSig = await processStartSignature(process.pid);
  if (!parentSig) return;

  const script = buildToolPath(opts.root, "tools/tests/lib/buck-daemon-reaper.ts");

  const child = spawn(
    process.execPath,
    [
      "--experimental-top-level-await",
      "--experimental-strip-types",
      "--disable-warning=ExperimentalWarning",
      "--import",
      opts.zxInitPath,
      script,
      "--parent",
      String(process.pid),
      "--parent-sig",
      parentSig,
      "--state-file",
      opts.stateFile,
      "--poll-ms",
      "1000",
    ],
    {
      cwd: opts.root,
      stdio: "ignore",
      detached: true,
    },
  );
  child.unref();
}

export async function startBuckWatchdog(opts: {
  root: string;
  zxInitPath: string;
  iso: string;
  logFile?: string | null;
}): Promise<void> {
  const watchdog = buildToolPath(opts.root, "tools/dev/buck-watchdog.ts");
  const quote = (value: string) => JSON.stringify(value);
  const logFileArg = opts.logFile ? `--log-file ${quote(opts.logFile)}` : "";
  await $({
    stdio: "ignore",
    cwd: opts.root,
  })`bash --noprofile --norc -c ${`node --experimental-top-level-await --experimental-strip-types --disable-warning=ExperimentalWarning --import ${quote(opts.zxInitPath)} ${quote(watchdog)} --parent ${process.pid} --iso ${quote(opts.iso)} --patterns v-,verify-nested- --sweep-while-parent-alive 0 ${logFileArg} >/dev/null 2>&1 & disown`}`.nothrow();
}
