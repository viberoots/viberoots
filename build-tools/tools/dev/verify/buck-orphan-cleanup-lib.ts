import { spawn } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { buckProcessTableLines } from "../../lib/process-inspection";
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
  return await buckProcessTableLines(timeoutMs);
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

export function macosPathVariants(p: string): string[] {
  const r = path.resolve(p);
  const out = [r];
  if (r.startsWith("/private/tmp/") || r.startsWith("/private/var/")) {
    out.push(path.resolve(r.slice("/private".length)));
  } else if (r.startsWith("/tmp/") || r.startsWith("/var/")) {
    out.push(path.resolve(`/private${r}`));
  }
  return Array.from(new Set(out));
}

export function pathsEquivalent(a: string, b: string): boolean {
  const bVariants = new Set(macosPathVariants(b));
  return macosPathVariants(a).some((variant) => bVariants.has(variant));
}

export function pathStartsWithRootVariant(child: string, root: string): boolean {
  const childVariants = macosPathVariants(child);
  const rootVariants = macosPathVariants(root);
  for (const c of childVariants) {
    for (const r of rootVariants) {
      if (c === r || c.startsWith(r + path.sep)) return true;
    }
  }
  return false;
}

export function isTempRepoRoot(repoRoot: string): boolean {
  const r = path.resolve(repoRoot);
  return (
    r.includes(`${path.sep}buck-out${path.sep}tmp${path.sep}tmpdir${path.sep}`) ||
    r.startsWith("/tmp/vbr-") ||
    r.startsWith("/private/tmp/vbr-") ||
    r.startsWith("/tmp/viberoots-") ||
    r.startsWith("/private/tmp/viberoots-")
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

export function parentIsMatchingBuckDaemon(lines: string[], pid: number, iso: string): boolean {
  if (!Number.isFinite(pid) || pid <= 1) return false;
  const prefix = `${pid} `;
  const daemonNeedle = ` --isolation-dir ${iso}`;
  return lines.some(
    (line) => line.startsWith(prefix) && line.includes("buck2d[") && line.includes(daemonNeedle),
  );
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
    // lint: allow-hardcoded-buck-isolation: verify orphan cleanup kills the registered candidate
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

export async function existingPathVariant(p: string): Promise<string | null> {
  for (const variant of macosPathVariants(p)) {
    if (await pathExists(variant)) return variant;
  }
  return null;
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
