#!/usr/bin/env zx-wrapper
import { spawn } from "node:child_process";
import path from "node:path";
import { cwdIsInsideTempRepo } from "./buck-daemon-reaper-utils.ts";

type Args = {
  parent?: string;
  parentSig?: string;
  tmp?: string;
  stateFile?: string;
  pollMs?: string;
};

function parseArg(name: string, def: string = ""): string {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1] || def;
  return def;
}

function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function processStartSignature(pid: number, timeoutMs: number): Promise<string> {
  if (!Number.isFinite(pid) || pid <= 1) return "";
  return await new Promise<string>((resolve) => {
    const child = spawn("/bin/ps", ["-p", String(pid), "-o", "lstart="], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    let buf = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d) => (buf += d));
    child.on("error", () => resolve(""));
    child.on("close", () => resolve(String(buf || "").trim()));
    const t = setTimeout(
      () => {
        try {
          child.kill("SIGKILL");
        } catch {}
        resolve("");
      },
      Math.max(100, timeoutMs),
    );
    child.on("close", () => clearTimeout(t));
  });
}

async function tempRepoStillExists(tmpRepoRoot: string): Promise<boolean> {
  try {
    await (await import("node:fs/promises")).access(tmpRepoRoot);
    return true;
  } catch {
    return false;
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function psLines(timeoutMs: number): Promise<string[]> {
  const stdout = await new Promise<string>((resolve) => {
    const child = spawn("/bin/ps", ["-A", "-o", "pid=,command="], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    let buf = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d) => (buf += d));
    child.on("error", () => resolve(""));
    child.on("close", () => resolve(buf));
    const t = setTimeout(
      () => {
        try {
          child.kill("SIGKILL");
        } catch {}
        resolve("");
      },
      Math.max(100, timeoutMs),
    );
    child.on("close", () => clearTimeout(t));
  });
  return String(stdout || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

async function readBuck2dProcesses(): Promise<Array<{ pid: number; cmd: string }>> {
  const lines = await psLines(2000);

  const out: Array<{ pid: number; cmd: string }> = [];
  for (const ln of lines) {
    if (!ln.includes("buck2d[")) continue;
    const m = ln.match(/^(\d+)\s+(.*)$/);
    if (!m) continue;
    out.push({ pid: Number(m[1]), cmd: m[2] || "" });
  }
  return out;
}

async function cwdForPid(pid: number): Promise<string> {
  // Use lsof to read cwd, which is reliable on macOS for same-user processes, but can hang.
  // If it hangs, return "" and skip this PID (better to miss one sweep than leak reaper processes).
  const out = await new Promise<string>((resolve) => {
    const child = spawn("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    let buf = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d) => (buf += d));
    child.on("error", () => resolve(""));
    child.on("close", () => resolve(buf));
    const t = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {}
      resolve("");
    }, 2000);
    child.on("close", () => clearTimeout(t));
  });
  // Format includes lines like:
  // p<PID>\nfcwd\nn<path>\n
  const m = String(out || "").match(/\n(?:n)([^\n]+)\n/);
  return m && m[1] ? String(m[1]).trim() : "";
}

function isolationDirFromCmd(cmd: string): string {
  const m = String(cmd || "").match(/--isolation-dir\s+([^\s]+)/);
  return m && m[1] ? String(m[1]).trim() : "";
}

async function killBuckIsoInRepo(
  tmpRepoRoot: string,
  iso: string,
  buck2dPid: number,
): Promise<void> {
  if (!tmpRepoRoot || !iso) return;
  await new Promise<void>((resolve) => {
    const child = spawn("buck2", ["--isolation-dir", iso, "kill"], {
      cwd: tmpRepoRoot,
      stdio: ["ignore", "ignore", "ignore"],
    });
    child.on("error", () => resolve());
    child.on("close", () => resolve());
    const t = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {}
      resolve();
    }, 10_000);
    child.on("close", () => clearTimeout(t));
  });

  if (Number.isFinite(buck2dPid) && isPidAlive(buck2dPid)) {
    try {
      process.kill(buck2dPid, "SIGKILL");
    } catch {}
  }
}

async function reapBuckDaemonsForTempRepo(tmpRepoRoot: string): Promise<void> {
  const reapDeadlineMs = 60_000;
  const reapStart = Date.now();
  const procs = await readBuck2dProcesses();
  for (const p of procs) {
    if (Date.now() - reapStart > reapDeadlineMs) return;
    const iso = isolationDirFromCmd(p.cmd);
    if (!iso) continue;
    const cwd = await cwdForPid(p.pid);
    if (!cwdIsInsideTempRepo(cwd, tmpRepoRoot)) continue;
    await killBuckIsoInRepo(tmpRepoRoot, iso, p.pid);
  }
}

async function main() {
  const argv = (global as any).argv as Args;
  const parentPidRaw = argv?.parent || parseArg("parent", "");
  const parentSigExpected = argv?.parentSig || parseArg("parent-sig", "");
  const tmp = argv?.tmp || parseArg("tmp", "");
  const stateFile = argv?.stateFile || parseArg("state-file", "");
  const pollMsRaw = argv?.pollMs || parseArg("poll-ms", "1000");

  const tmpRepoRoot = tmp ? path.resolve(tmp) : "";
  const parentPid = Number(parentPidRaw);
  const pollMs = Math.max(250, Number(pollMsRaw) || 1000);

  if (!Number.isFinite(parentPid) || parentPid <= 1) return;
  // Primary path: parent identity must include the lstart signature to avoid PID reuse races.
  if (!parentSigExpected) {
    throw new Error("buck-daemon-reaper: --parent-sig is required");
  }
  if (!tmpRepoRoot && !stateFile) return;

  const maxWaitMs = 30 * 60 * 1000; // fail-safe: do not run forever
  const psTimeoutMs = 1000;
  const t0 = Date.now();

  // Hard exit timer so we don't leak a detached helper if any subprocess call hangs.
  const hardExit = setTimeout(() => process.exit(0), maxWaitMs + 5_000);
  try {
    // Wait for parent to exit (covers normal exit and abrupt termination).
    const curSig0 = await processStartSignature(parentPid, psTimeoutMs).catch(() => "");
    if (!curSig0 || curSig0 !== parentSigExpected) {
      // Parent already exited or pid already reused.
      // Primary path: do not wait and do not reap, since the observed pid is not the expected parent.
      return;
    }
    // Parent PID reuse guard: re-check infrequently to avoid spawning /bin/ps in a tight loop.
    let lastSigCheckMs = Date.now();
    while (isPidAlive(parentPid)) {
      if (Date.now() - t0 > maxWaitMs) return;
      if (tmpRepoRoot && !(await tempRepoStillExists(tmpRepoRoot))) return;
      if (Date.now() - lastSigCheckMs > 5 * 60 * 1000) {
        const curSig = await processStartSignature(parentPid, psTimeoutMs).catch(() => "");
        if (curSig && curSig !== parentSigExpected) break; // pid reused
        lastSigCheckMs = Date.now();
      }
      await sleep(pollMs);
    }

    // Parent exited: reap only buck2d daemons whose cwd lives under registered temp repos.
    const tmpRoots: string[] = [];
    if (tmpRepoRoot) tmpRoots.push(tmpRepoRoot);
    if (stateFile) {
      try {
        const txt = await (await import("node:fs/promises")).readFile(stateFile, "utf8");
        for (const ln of String(txt || "").split(/\r?\n/)) {
          const p = ln.trim();
          if (p) tmpRoots.push(p);
        }
      } catch {}
    }
    const seen = new Set<string>();
    for (const r of tmpRoots) {
      const abs = path.resolve(r);
      if (seen.has(abs)) continue;
      seen.add(abs);
      if (!(await tempRepoStillExists(abs))) continue;
      await reapBuckDaemonsForTempRepo(abs);
    }
  } finally {
    try {
      clearTimeout(hardExit);
    } catch {}
  }
}

main().catch(() => process.exit(0));
