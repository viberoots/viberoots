import { spawn } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";

type ForkserverProc = {
  pid: number;
  ppid: number;
  etime: string;
  cmd: string;
  stateDir: string;
};

function parsePsLine(
  line: string,
): { pid: number; ppid: number; etime: string; cmd: string } | null {
  // Format: PID PPID ELAPSED COMMAND
  const m = line.match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
  if (!m) return null;
  const pid = Number(m[1]);
  const ppid = Number(m[2]);
  if (!Number.isFinite(pid) || !Number.isFinite(ppid)) return null;
  return { pid, ppid, etime: m[3] || "", cmd: m[4] || "" };
}

async function psLines(timeoutMs: number): Promise<string[]> {
  return await new Promise<string[]>((resolve) => {
    const child = spawn("/bin/ps", ["-A", "-o", "pid=,ppid=,etime=,command="], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    let buf = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d) => (buf += d));
    child.on("error", () => resolve([]));
    child.on("close", () => {
      resolve(
        String(buf || "")
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean),
      );
    });
    const t = setTimeout(
      () => {
        try {
          child.kill("SIGKILL");
        } catch {}
        resolve([]);
      },
      Math.max(250, timeoutMs),
    );
    child.on("close", () => clearTimeout(t));
  });
}

function tryRepoRootFromStateDir(stateDir: string): { repoRoot: string; iso: string } | null {
  const sd = String(stateDir || "").trim();
  if (!sd) return null;
  const parts = sd.split(path.sep).filter(Boolean);
  const idx = parts.indexOf("buck-out");
  if (idx < 0 || idx + 1 >= parts.length) return null;
  const repoRoot = path.sep + parts.slice(0, idx).join(path.sep);
  const iso = parts[idx + 1] || "";
  if (!repoRoot || !iso) return null;
  return { repoRoot, iso };
}

function isTempRepoRoot(repoRoot: string): boolean {
  const r = path.resolve(repoRoot);
  return (
    r.includes(`${path.sep}buck-out${path.sep}tmp${path.sep}tmpdir${path.sep}`) ||
    r.startsWith("/tmp/bnx-") ||
    r.startsWith("/private/tmp/bnx-") ||
    r.startsWith("/tmp/bucknix-") ||
    r.startsWith("/private/tmp/bucknix-")
  );
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

async function buck2Kill(repoRoot: string, iso: string, timeoutMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    const child = spawn("buck2", ["--isolation-dir", iso, "kill"], {
      cwd: repoRoot,
      stdio: ["ignore", "ignore", "ignore"],
    });
    child.on("error", () => resolve());
    child.on("close", () => resolve());
    const t = setTimeout(
      () => {
        try {
          child.kill("SIGKILL");
        } catch {}
        resolve();
      },
      Math.max(250, timeoutMs),
    );
    child.on("close", () => clearTimeout(t));
  });
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function cleanupOrphanBuckDaemons(opts: {
  log?: (line: string) => Promise<void>;
  maxKills?: number;
}): Promise<{ scanned: number; candidates: number; killed: number }> {
  const maxKills = Math.max(0, opts.maxKills ?? 50);
  const lines = await psLines(2000);
  const forks: ForkserverProc[] = [];
  for (const ln of lines) {
    if (!ln.includes("(buck2-forkserver)") || !ln.includes("--state-dir")) continue;
    const base = parsePsLine(ln);
    if (!base) continue;
    const sm = base.cmd.match(/--state-dir\s+([^\s]+)/);
    const stateDir = sm && sm[1] ? String(sm[1]).trim() : "";
    if (!stateDir) continue;
    forks.push({ ...base, stateDir });
  }

  let killed = 0;
  let candidates = 0;
  for (const f of forks) {
    const mapped = tryRepoRootFromStateDir(f.stateDir);
    if (!mapped) continue;
    const { repoRoot, iso } = mapped;
    if (!isTempRepoRoot(repoRoot)) continue;
    const orphan = f.ppid <= 1 || !isPidAlive(f.ppid);
    if (!orphan) continue;
    candidates++;
    if (killed >= maxKills) continue;

    const repoOk = await pathExists(repoRoot);
    // Safety: never kill processes that might belong to another *active* run.
    // Only clean up when the temp repo root has already been deleted from disk.
    // (If the repo still exists, we cannot prove the daemon is unused.)
    if (repoOk) continue;

    // Ensure processes are gone when the repo directory no longer exists.
    if (isPidAlive(f.pid)) {
      try {
        process.kill(f.pid, "SIGKILL");
      } catch {}
    }
    if (f.ppid > 1 && isPidAlive(f.ppid)) {
      try {
        process.kill(f.ppid, "SIGKILL");
      } catch {}
    }
    killed++;
    if (opts.log) {
      await opts.log(
        `[verify] buck2 orphan cleanup: killed forkserver pid=${f.pid} ppid=${f.ppid} etime=${f.etime} repo=${repoRoot} iso=${iso}`,
      );
    }
  }
  return { scanned: forks.length, candidates, killed };
}
