import { spawn, type ChildProcess } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { parseVerifyOwnedState } from "../../dev/verify/owned-process-state";
import { resolveToolPathSync } from "../../lib/tool-paths";

export type ProcessFiles = {
  stateFile: string;
  logFile: string;
};

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function waitForPidGone(pid: number, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!pidAlive(pid)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`pid ${pid} still alive after ${timeoutMs}ms`);
}

export async function createProcessFiles(opts: {
  kind: string;
  ownerPid: number;
}): Promise<ProcessFiles> {
  const repoRoot = process.cwd();
  const suffix = `${process.pid}-${Date.now()}`;
  const stateFile = path.join(
    os.tmpdir(),
    `viberoots-buck-reaper-v-${opts.ownerPid}-${suffix}.txt`,
  );
  const logFile = path.join(
    repoRoot,
    "buck-out",
    "tmp",
    "verify-logs",
    `${opts.kind}-${process.pid}.log`,
  );
  await fsp.writeFile(stateFile, "", "utf8");
  await fsp.mkdir(path.dirname(logFile), { recursive: true });
  await fsp.writeFile(logFile, "", "utf8");
  return { stateFile, logFile };
}

export async function cleanupProcessFiles(files: ProcessFiles): Promise<void> {
  await fsp.rm(files.stateFile, { force: true }).catch(() => {});
  await fsp.rm(files.logFile, { force: true }).catch(() => {});
}

export async function waitForVisibleOrphanInPs(
  pid: number,
  files: ProcessFiles,
  timeoutMs: number,
  opts: { requireRegistered: boolean } = { requireRegistered: true },
): Promise<void> {
  const psPath = resolveToolPathSync("ps");
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const stdout = await new Promise<string>((resolve) => {
      let child;
      try {
        child = spawn(psPath, ["eww", "-p", String(pid), "-o", "pid=,ppid=,pgid=,command="], {
          stdio: ["ignore", "pipe", "ignore"],
        });
      } catch {
        resolve("");
        return;
      }
      let buf = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        buf += chunk;
      });
      child.on("error", () => resolve(""));
      child.on("close", () => resolve(String(buf || "")));
    });
    const line = String(stdout || "")
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .find(Boolean);
    if (line && (await isExpectedOrphanLine(line, pid, files, opts.requireRegistered))) return;
    if (!line && opts.requireRegistered) {
      const stateText = await fsp.readFile(files.stateFile, "utf8").catch(() => "");
      if (
        parseVerifyOwnedState(stateText).processes.some(
          (entry) => entry.pid === pid && entry.logFile === files.logFile,
        )
      ) {
        return;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`pid ${pid} did not become a visible orphan within ${timeoutMs}ms`);
}

async function isExpectedOrphanLine(
  line: string,
  pid: number,
  files: ProcessFiles,
  requireRegistered: boolean,
): Promise<boolean> {
  const match = line.match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/);
  if (!match || Number(match[1]) !== pid || Number(match[2]) > 1) return false;
  if (!requireRegistered) return true;
  const stateText = await fsp.readFile(files.stateFile, "utf8").catch(() => "");
  return parseVerifyOwnedState(stateText).processes.some(
    (entry) => entry.pid === pid && entry.logFile === files.logFile,
  );
}

export async function spawnOrphanedVerifyProcess(opts: {
  files: ProcessFiles;
  target: string;
  registered: boolean;
}): Promise<number> {
  const registrationEnv = opts.registered ? ["    VBR_VERIFY_REGISTER_PROCESS: '1',"] : [];
  const registerArgs = opts.registered
    ? "['--experimental-strip-types', '--import', process.argv[1], '-e', 'setInterval(() => {}, 1000)']"
    : "['-e', 'setInterval(() => {}, 1000)']";
  const argOffset = opts.registered ? 1 : 0;
  const launcher = [
    "const { spawn } = require('node:child_process');",
    `const child = spawn(process.execPath, ${registerArgs}, {`,
    "  detached: true,",
    "  stdio: 'ignore',",
    "  env: {",
    "    ...process.env,",
    `    VBR_VERIFY_PROCESS_STATE_FILE: process.argv[${1 + argOffset}],`,
    `    VBR_BUCK_REAPER_STATE_FILE: process.argv[${1 + argOffset}],`,
    `    VBR_VERIFY_LOG_FILE: process.argv[${2 + argOffset}],`,
    ...registrationEnv,
    `    BUCK_TEST_TARGET: '${opts.target}'`,
    "  }",
    "});",
    "console.log(String(child.pid || ''));",
    "child.unref();",
  ].join("\n");
  const zxInit = path.join(process.cwd(), "build-tools", "tools", "dev", "zx-init.mjs");
  const args = opts.registered
    ? ["-e", launcher, zxInit, opts.files.stateFile, opts.files.logFile]
    : ["-e", launcher, opts.files.stateFile, opts.files.logFile];
  const parent = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "ignore"] });
  const stdout = await collectChildStdout(parent);
  const orphanPid = Number(stdout.trim());
  if (!Number.isFinite(orphanPid) || orphanPid <= 1) {
    throw new Error(`expected orphan pid in stdout, got '${stdout}'`);
  }
  await waitForVisibleOrphanInPs(orphanPid, opts.files, 10_000, {
    requireRegistered: opts.registered,
  });
  return orphanPid;
}

export function spawnCurrentVerifyEnvProcess(files: ProcessFiles, target: string): ChildProcess {
  const zxInit = path.join(process.cwd(), "build-tools", "tools", "dev", "zx-init.mjs");
  return spawn(
    process.execPath,
    ["--experimental-strip-types", "--import", zxInit, "-e", "setInterval(() => {}, 1000)"],
    {
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        VBR_VERIFY_PROCESS_STATE_FILE: files.stateFile,
        VBR_BUCK_REAPER_STATE_FILE: files.stateFile,
        VBR_VERIFY_LOG_FILE: files.logFile,
        VBR_VERIFY_REGISTER_PROCESS: "1",
        BUCK_TEST_TARGET: target,
      },
    },
  );
}

async function collectChildStdout(child: ChildProcess): Promise<string> {
  let out = "";
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk) => {
    out += chunk;
  });
  const exit = await new Promise<number>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve(typeof code === "number" ? code : 1));
  });
  if (exit !== 0) throw new Error(`launcher exited with ${exit}`);
  return out;
}
