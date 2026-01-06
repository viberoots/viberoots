import "zx/globals";
import * as fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";

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
  const parentSig = await $({ stdio: "pipe" })`/bin/ps -p ${process.pid} -o lstart=`
    .then((r) => String(r.stdout || "").trim())
    .catch(() => "");
  if (!parentSig) return;

  const quotedSig = parentSig.replaceAll("'", `'\"'\"'`);
  const script = path.join(opts.root, "tools", "tests", "lib", "buck-daemon-reaper.ts");

  await $({
    stdio: "ignore",
    cwd: opts.root,
  })`bash --noprofile --norc -c ${`node --experimental-top-level-await --experimental-strip-types --disable-warning=ExperimentalWarning --import ${opts.zxInitPath} ${script} --parent ${process.pid} --parent-sig '${quotedSig}' --state-file ${opts.stateFile} --poll-ms 1000 >/dev/null 2>&1 & disown`}`.nothrow();
}

export async function startBuckWatchdog(opts: {
  root: string;
  zxInitPath: string;
  iso: string;
}): Promise<void> {
  const watchdog = path.join(opts.root, "tools", "dev", "buck-watchdog.ts");
  await $({
    stdio: "ignore",
    cwd: opts.root,
  })`bash --noprofile --norc -c ${`node --experimental-top-level-await --experimental-strip-types --disable-warning=ExperimentalWarning --import ${opts.zxInitPath} ${watchdog} --parent ${process.pid} --iso ${opts.iso} --patterns v- >/dev/null 2>&1 & disown`}`.nothrow();
}
