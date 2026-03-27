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
    const child = spawn("ps", ["-p", String(pid), "-o", "lstart="], {
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
    const child = spawn("ps", ["-A", "-o", "pid=,ppid=,command="], {
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
    const m = ln.match(/^(\d+)\s+(\d+)\s+(.*)$/);
    if (!m) continue;
    out.push({ pid: Number(m[1]), cmd: m[3] || "" });
  }
  return out;
}

async function readForkserverProcesses(): Promise<
  Array<{ pid: number; ppid: number; cmd: string; stateDir: string }>
> {
  const lines = await psLines(2000);
  const out: Array<{ pid: number; ppid: number; cmd: string; stateDir: string }> = [];
  for (const ln of lines) {
    if (!ln.includes("(buck2-forkserver)")) continue;
    const m = ln.match(/^(\d+)\s+(\d+)\s+(.*)$/);
    if (!m) continue;
    const pid = Number(m[1]);
    const ppid = Number(m[2]);
    const cmd = m[3] || "";
    const sm = cmd.match(/--state-dir\s+([^\s]+)/);
    const stateDir = sm && sm[1] ? String(sm[1]).trim() : "";
    out.push({ pid, ppid, cmd, stateDir });
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

  // If buck2 kill didn't terminate the daemon, SIGKILL the matching buck2d.
  // Guard against PID reuse by verifying the command line includes the expected isolation dir.
  if (Number.isFinite(buck2dPid) && buck2dPid > 1 && isPidAlive(buck2dPid)) {
    const cmd = await new Promise<string>((resolve) => {
      const child = spawn("ps", ["-p", String(buck2dPid), "-o", "command="], {
        stdio: ["ignore", "pipe", "ignore"],
      });
      let buf = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (d) => (buf += d));
      child.on("error", () => resolve(""));
      child.on("close", () => resolve(String(buf || "").trim()));
      const t = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {}
        resolve("");
      }, 1500);
      child.on("close", () => clearTimeout(t));
    });
    if (cmd.includes("buck2d[") && cmd.includes(`--isolation-dir ${iso} `)) {
      try {
        process.kill(buck2dPid, "SIGKILL");
      } catch {}
    }
  }
}

async function reapBuckDaemonsForTempRepo(tmpRepoRoot: string): Promise<void> {
  // Primary path: do not rely on buck2d cwd (can drift). Instead, map from the forkserver's
  // --state-dir, which is anchored under the repo's buck-out/<isolation>/forkserver directory.
  const reapDeadlineMs = 60_000;
  const reapStart = Date.now();

  const forks = await readForkserverProcesses();
  for (const f of forks) {
    if (Date.now() - reapStart > reapDeadlineMs) return;
    if (!f.stateDir) continue;
    const sd = path.resolve(f.stateDir);
    const root0 = path.resolve(tmpRepoRoot);
    const roots = [root0];
    if (root0.startsWith("/var/")) roots.push(path.resolve("/private" + root0));
    if (root0.startsWith("/tmp/")) roots.push(path.resolve("/private" + root0));
    let matchedRoot = "";
    for (const r of roots) {
      if (sd === r || sd.startsWith(r + path.sep)) {
        matchedRoot = r;
        break;
      }
    }
    if (!matchedRoot) continue;
    // Graceful shutdown: infer isolation dir from forkserver --state-dir path:
    // <repo>/buck-out/<iso>/forkserver
    let iso = "";
    try {
      const rel = path.relative(matchedRoot, sd);
      const parts = rel.split(path.sep).filter(Boolean);
      const idx = parts.indexOf("buck-out");
      if (idx >= 0 && idx + 1 < parts.length) iso = parts[idx + 1] || "";
    } catch {}
    if (iso) await killBuckIsoInRepo(tmpRepoRoot, iso, f.ppid);
    if (Number.isFinite(f.pid) && f.pid > 1 && isPidAlive(f.pid)) {
      try {
        process.kill(f.pid, "SIGKILL");
      } catch {}
    }
    // Safety: if buck2 kill didn't manage to stop the daemon but we can prove the PPID is the
    // matching buck2d for this forkserver+iso, SIGKILL it. Guard against PID reuse by verifying
    // command line contains both buck2d and the expected isolation dir.
    if (iso && Number.isFinite(f.ppid) && f.ppid > 1 && isPidAlive(f.ppid)) {
      const parentCmd = await new Promise<string>((resolve) => {
        const child = spawn("ps", ["-p", String(f.ppid), "-o", "command="], {
          stdio: ["ignore", "pipe", "ignore"],
        });
        let buf = "";
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (d) => (buf += d));
        child.on("error", () => resolve(""));
        child.on("close", () => resolve(String(buf || "").trim()));
        const t = setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {}
          resolve("");
        }, 1500);
        child.on("close", () => clearTimeout(t));
      });
      if (parentCmd.includes("buck2d[") && parentCmd.includes(`--isolation-dir ${iso} `)) {
        try {
          process.kill(f.ppid, "SIGKILL");
        } catch {}
      }
    }
  }

  // Secondary path: sometimes the forkserver exits but buck2d remains idle.
  // If we have a temp repo root, kill any remaining buck2d tagged with this repo basename.
  try {
    const base = path.basename(path.resolve(tmpRepoRoot));
    if (base) {
      const res = await new Promise<string>((resolve) => {
        const child = spawn("ps", ["-A", "-o", "pid=,command="], {
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
          resolve(buf);
        }, 2000);
        child.on("close", () => clearTimeout(t));
      });
      const lines = String(res || "")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      for (const l of lines) {
        const m = l.match(/^(\d+)\s+(.*)$/);
        if (!m) continue;
        const pid = Number(m[1]);
        const cmd = m[2] || "";
        if (!Number.isFinite(pid) || pid <= 1) continue;
        if (!cmd.includes(`buck2d[${base}]`)) continue;
        try {
          process.kill(pid, "SIGKILL");
        } catch {}
      }
    }
  } catch {}
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
      // If the parent is already gone, still perform a one-time reap based on the temp roots
      // we've recorded. This avoids leaking forkservers when the parent dies before we can
      // read its lstart signature.
      if (!isPidAlive(parentPid)) {
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
          await reapBuckDaemonsForTempRepo(abs);
        }
      }
      // Primary path: do not wait and do not reap if the observed pid is not the expected parent.
      return;
    }
    // Parent PID reuse guard: re-check infrequently to avoid spawning ps in a tight loop.
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
      await reapBuckDaemonsForTempRepo(abs);
    }
  } finally {
    try {
      clearTimeout(hardExit);
    } catch {}
  }
}

main().catch(() => process.exit(0));
