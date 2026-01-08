import "./worker-init";
import path from "node:path";
import process from "node:process";
import {
  buck2dProcsForRepo,
  buckIsolationDirsForRepo,
  forkserversUnderRepo,
  pidCmdline,
} from "./buck-procs";

async function assertNoBuckForkserversUnderRepo(repoRoot: string, $: any): Promise<void> {
  const offenders = await forkserversUnderRepo(repoRoot, $);
  if (offenders.length > 0) {
    throw new Error(
      `buck cleanup: leaked buck2-forkserver under temp repo root:\n${offenders
        .slice(0, 20)
        .map((o) => `${o.pid} ${o.ppid} ${o.cmd}`)
        .join("\n")}`,
    );
  }
}

function isoFromForkserverStateDir(repoRoot: string, forkserverCmd: string): string {
  const sm = String(forkserverCmd || "").match(/--state-dir\s+([^\s]+)/);
  const stateDirRaw = sm && sm[1] ? String(sm[1]).trim() : "";
  if (!stateDirRaw) return "";
  const root0 = path.resolve(repoRoot);
  const roots = [root0];
  if (root0.startsWith("/var/")) roots.push(path.resolve("/private" + root0));
  if (root0.startsWith("/tmp/")) roots.push(path.resolve("/private" + root0));
  const stateDir = path.resolve(stateDirRaw);
  let matched = "";
  for (const r of roots) {
    if (stateDir === r || stateDir.startsWith(r + path.sep)) {
      matched = r;
      break;
    }
  }
  if (!matched) return "";
  try {
    const rel = path.relative(matched, stateDir);
    const parts = rel.split(path.sep).filter(Boolean);
    const idx = parts.indexOf("buck-out");
    if (idx >= 0 && idx + 1 < parts.length) return parts[idx + 1] || "";
  } catch {}
  return "";
}

async function killBuckForkserversUnderRepo(repoRoot: string, $: any): Promise<void> {
  const offenders = await forkserversUnderRepo(repoRoot, $);
  for (const o of offenders) {
    const iso = isoFromForkserverStateDir(repoRoot, o.cmd);
    if (iso && o.ppid > 1) {
      const parentCmd = await pidCmdline(o.ppid, $);
      if (parentCmd.includes("buck2d[") && parentCmd.includes(`--isolation-dir ${iso} `)) {
        try {
          process.kill(o.ppid, "SIGKILL");
        } catch {}
      }
    }
    try {
      if (o.pid > 1) process.kill(o.pid, "SIGKILL");
    } catch {}
  }
}

export async function killBuckDaemonsForRepo(repoRoot: string, $: any): Promise<void> {
  const isoDirs = await buckIsolationDirsForRepo(repoRoot);
  const want = new Set(isoDirs.filter(Boolean));
  if (want.size > 0) {
    const procs = await buck2dProcsForRepo(repoRoot, $);
    for (const p of procs) {
      if (!p.iso || !want.has(p.iso)) continue;
      try {
        process.kill(p.pid, "SIGTERM");
      } catch {}
    }
    await new Promise((r) => setTimeout(r, 250));
    for (const p of procs) {
      if (!p.iso || !want.has(p.iso)) continue;
      try {
        process.kill(p.pid, "SIGKILL");
      } catch {}
    }
  }
  await killBuckForkserversUnderRepo(repoRoot, $);
  await assertNoBuckForkserversUnderRepo(repoRoot, $);
}
