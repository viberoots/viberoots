import "zx/globals";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";

async function pidStartSignature(pid: number): Promise<string> {
  try {
    const { stdout } = await $({ stdio: "pipe" })`/bin/ps -p ${pid} -o lstart=`;
    return String(stdout || "").trim();
  } catch {
    return "";
  }
}

async function pidAliveWithSignature(pid: number, sig: string): Promise<boolean> {
  if (!pid || !sig) return false;
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  const cur = await pidStartSignature(pid);
  return Boolean(cur) && cur === sig;
}

async function mkdirIfMissing(p: string): Promise<void> {
  await fsp.mkdir(p, { recursive: true }).catch(() => {});
}

async function readText(p: string): Promise<string> {
  try {
    return String(await fsp.readFile(p, "utf8")).trim();
  } catch {
    return "";
  }
}

async function writeText(p: string, text: string): Promise<void> {
  await fsp.writeFile(p, text, "utf8").catch(() => {});
}

async function mkUniqueLogFile(logDir: string): Promise<string> {
  await mkdirIfMissing(logDir);
  const tag = new Date().toISOString().replace(/[:.]/g, "-");
  const base = path.join(
    logDir,
    `verify-${tag}-${process.pid}-${Math.random().toString(16).slice(2)}`,
  );
  const logPath = `${base}.log`;
  await fsp.writeFile(logPath, "", "utf8").catch(() => {});
  return logPath;
}

export async function acquireVerifyLock(opts: {
  root: string;
  allowConcurrent: boolean;
}): Promise<{ lockDir: string | null; logFile: string | null }> {
  const isCI = process.env.CI === "true";
  if (isCI || opts.allowConcurrent) return { lockDir: null, logFile: null };

  const lockDir = path.join(opts.root, "buck-out", "tmp", "verify-lock");
  await mkdirIfMissing(path.join(opts.root, "buck-out", "tmp"));

  const pidFile = path.join(lockDir, "pid");
  const sigFile = path.join(lockDir, "lstart");
  const logFileRef = path.join(lockDir, "log");

  const tryAcquire = async (): Promise<boolean> => {
    try {
      await fsp.mkdir(lockDir);
      return true;
    } catch {
      return false;
    }
  };

  if (!(await tryAcquire())) {
    const pid = Number(await readText(pidFile));
    const sig = await readText(sigFile);
    if (await pidAliveWithSignature(pid, sig)) {
      const existingLog = await readText(logFileRef);
      const hint =
        existingLog &&
        (await fsp
          .stat(existingLog)
          .then(() => true)
          .catch(() => false))
          ? `hint: tail -f ${existingLog}\n`
          : existingLog
            ? `hint: recorded log path does not exist on disk: ${existingLog}\n`
            : "hint: tail its log (or set VERIFY_ALLOW_CONCURRENT=1 if you really mean it).\n";
      process.stderr.write(
        `error: verify is already running (pid ${pid}); refusing to start a concurrent run.\n${hint}`,
      );
      process.exit(2);
      return { lockDir: null, logFile: null };
    }
    await fsp.rm(lockDir, { recursive: true, force: true }).catch(() => {});
    if (!(await tryAcquire())) {
      process.stderr.write(
        `error: verify lock is held and could not be acquired (path: ${lockDir}).\n`,
      );
      process.exit(2);
      return { lockDir: null, logFile: null };
    }
  }

  const sig = await pidStartSignature(process.pid);
  await writeText(pidFile, String(process.pid));
  await writeText(sigFile, sig);

  const logDir = path.join(opts.root, "buck-out", "tmp", "verify-logs");
  const existing = await readText(logFileRef);
  const logFile = existing || (await mkUniqueLogFile(logDir));
  await writeText(logFileRef, logFile);

  const byPid = path.join(logDir, "by-pid");
  await mkdirIfMissing(byPid);
  await fsp.symlink(logFile, path.join(byPid, `${process.pid}.log`)).catch(async () => {
    await fsp.unlink(path.join(byPid, `${process.pid}.log`)).catch(() => {});
    await fsp.symlink(logFile, path.join(byPid, `${process.pid}.log`)).catch(() => {});
  });
  await fsp.symlink(logFile, path.join(logDir, "latest.log")).catch(async () => {
    await fsp.unlink(path.join(logDir, "latest.log")).catch(() => {});
    await fsp.symlink(logFile, path.join(logDir, "latest.log")).catch(() => {});
  });

  process.env.BNX_VERIFY_LOCK_DIR = lockDir;
  process.env.BNX_VERIFY_LOG_FILE = logFile;

  // IMPORTANT: process.exit() and the 'exit' event do not await async work.
  // Keep this cleanup synchronous so we don't leave behind a stale verify-lock dir.
  const releaseSync = () => {
    try {
      fs.rmSync(lockDir, { recursive: true, force: true });
    } catch {}
  };
  // Only hook 'exit' here. Signal handling is owned by run-verify.ts so it can kill process groups.
  process.once("exit", releaseSync);

  return { lockDir, logFile };
}
