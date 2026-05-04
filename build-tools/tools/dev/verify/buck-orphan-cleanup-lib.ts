import { spawn } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { resolveToolPathSync } from "../../lib/tool-paths";

export type ForkserverProc = {
  pid: number;
  ppid: number;
  etime: string;
  cmd: string;
  stateDir: string;
};

export function parsePsLine(
  line: string,
): { pid: number; ppid: number; etime: string; cmd: string } | null {
  const m = line.match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
  if (!m) return null;
  const pid = Number(m[1]);
  const ppid = Number(m[2]);
  if (!Number.isFinite(pid) || !Number.isFinite(ppid)) return null;
  return { pid, ppid, etime: m[3] || "", cmd: m[4] || "" };
}

export async function psLines(timeoutMs: number): Promise<string[]> {
  const psPath = resolveToolPathSync("ps");
  return await new Promise<string[]>((resolve) => {
    const child = spawn(psPath, ["-A", "-o", "pid=,ppid=,etime=,command="], {
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

export function tryRepoRootFromStateDir(
  stateDir: string,
): { repoRoot: string; iso: string } | null {
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

export function isTempRepoRoot(repoRoot: string): boolean {
  const r = path.resolve(repoRoot);
  return (
    r.includes(`${path.sep}buck-out${path.sep}tmp${path.sep}tmpdir${path.sep}`) ||
    r.startsWith("/tmp/bnx-") ||
    r.startsWith("/private/tmp/bnx-") ||
    r.startsWith("/tmp/bucknix-") ||
    r.startsWith("/private/tmp/bucknix-")
  );
}

export function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function ownerPidFromEphemeralIsolation(iso: string): number | null {
  const s = String(iso || "").trim();
  const match = s.match(/^v-(\d+)-\d+$/) || s.match(/^verify-nested-(\d+)-[a-f0-9]{12}$/);
  if (!match?.[1]) return null;
  const pid = Number(match[1]);
  return Number.isFinite(pid) && pid > 1 ? pid : null;
}

export function liveOwnerPidFromEphemeralIsolation(iso: string): number | null {
  const ownerPid = ownerPidFromEphemeralIsolation(iso);
  if (!ownerPid || !isPidAlive(ownerPid)) return null;
  return ownerPid;
}

export async function buck2Kill(repoRoot: string, iso: string, timeoutMs: number): Promise<void> {
  const buck2Path = resolveToolPathSync("buck2");
  await new Promise<void>((resolve) => {
    const child = spawn(buck2Path, ["--isolation-dir", iso, "kill"], {
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

export async function pathExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function listIsolationDirs(repoRoot: string): Promise<string[]> {
  const dirs: string[] = [];
  try {
    const buckOut = path.join(repoRoot, "buck-out");
    const entries = await fsp.readdir(buckOut, { withFileTypes: true });
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const name = ent.name;
      if (!name || name === "tmp") continue;
      dirs.push(name);
    }
  } catch {}
  if (!dirs.includes("v2")) dirs.unshift("v2");
  return Array.from(new Set(dirs)).filter(Boolean);
}
