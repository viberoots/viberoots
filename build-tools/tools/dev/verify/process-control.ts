import "zx/globals";
import { spawn } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { resolveToolPath } from "../../lib/tool-paths";

export async function killBuckIsolation(root: string, iso: string): Promise<void> {
  await $({ stdio: "ignore", cwd: root })`buck2 --isolation-dir ${iso} kill`.nothrow();
}

export async function killProcessGroup(pgid: number): Promise<void> {
  try {
    process.kill(-pgid, "SIGTERM");
  } catch {}
  setTimeout(() => {
    try {
      process.kill(-pgid, "SIGKILL");
    } catch {}
  }, 10_000);
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
  const psPath = await resolveToolPath("ps");
  const parentSig = await $({ stdio: "pipe" })`${psPath} -p ${process.pid} -o lstart=`
    .then((r) => String(r.stdout || "").trim())
    .catch(() => "");
  if (!parentSig) return;

  const script = path.join(
    opts.root,
    "build-tools",
    "tools",
    "tests",
    "lib",
    "buck-daemon-reaper.ts",
  );

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
  const watchdog = path.join(opts.root, "build-tools", "tools", "dev", "buck-watchdog.ts");
  const quote = (value: string) => JSON.stringify(value);
  const logFileArg = opts.logFile ? `--log-file ${quote(opts.logFile)}` : "";
  await $({
    stdio: "ignore",
    cwd: opts.root,
  })`bash --noprofile --norc -c ${`node --experimental-top-level-await --experimental-strip-types --disable-warning=ExperimentalWarning --import ${quote(opts.zxInitPath)} ${quote(watchdog)} --parent ${process.pid} --iso ${quote(opts.iso)} --patterns v-,verify-nested- --sweep-while-parent-alive 0 ${logFileArg} >/dev/null 2>&1 & disown`}`.nothrow();
}
