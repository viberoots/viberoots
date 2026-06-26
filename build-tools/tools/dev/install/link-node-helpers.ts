import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { activeNixGcPids } from "../../lib/nix-gc-lock";
import { type ManagedCommandActivity, runManagedCommand } from "../../lib/managed-command";
import { mkdirWithMacosMetadataExclusion } from "../../lib/macos-metadata";
import { processTableLines } from "../../lib/process-inspection";
import { pathExists } from "../../lib/repo";

export async function withHeartbeat<T>(
  label: string,
  promise: Promise<T>,
  opts?: { activity?: ManagedCommandActivity; noOutputWarnSec?: number },
): Promise<T> {
  const started = Date.now();
  const noOutputWarnSec = Math.max(30, Number(opts?.noOutputWarnSec || 90));
  const thresholds = [15, 30, 60, 120, 240, 480, 900];
  let lastBytes = 0;
  let lastChunks = 0;
  let lastNoOutputBucket = -1;
  const isAlive = (pid: number): boolean => {
    if (!pid || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  const describeChild = (pid: number): string => {
    if (!pid || pid <= 0) return "pid=unknown alive=false state=unknown";
    const alive = isAlive(pid);
    return `pid=${pid} alive=${alive} state=${alive ? "running" : "exited"}`;
  };
  const timer = setInterval(() => {
    const elapsed = Math.floor((Date.now() - started) / 1000);
    const activity = opts?.activity;
    if (!activity) {
      console.error(`[link-node] phase=${label} elapsed=${elapsed}s`);
      return;
    }
    const now = Date.now();
    const lastAt = activity.lastOutputAtMs || activity.startedAtMs || started;
    const silentForSec = Math.max(0, Math.floor((now - lastAt) / 1000));
    const bytes = activity.stdoutBytes + activity.stderrBytes;
    const childPid = Number(activity.childPid || 0);
    const chunks = Number(activity.outputChunks || 0);
    if (bytes > lastBytes || chunks > lastChunks) {
      lastBytes = bytes;
      lastChunks = chunks;
      const last = activity.lastEventSnippet || "<activity>";
      console.error(
        `[link-node] progress phase=${label} elapsed=${elapsed}s ${describeChild(childPid)} bytes=${bytes} last_event_ago=${silentForSec}s last_event="${last}"`,
      );
      return;
    }
    let bucket = 0;
    for (const t of thresholds) {
      if (silentForSec >= t) bucket = t;
    }
    if (bucket <= lastNoOutputBucket) return;
    lastNoOutputBucket = bucket;
    void (async () => {
      const gcPids = await activeNixGcPids();
      const gc = gcPids.length > 0 ? gcPids.join(",") : "none";
      const stall = silentForSec >= noOutputWarnSec ? " likely_waiting=true" : "";
      console.error(
        `[link-node] waiting phase=${label} elapsed=${elapsed}s ${describeChild(childPid)} bytes=${bytes} no_output_for=${silentForSec}s nix_gc=${gc}${stall}`,
      );
    })();
  }, 15000);
  try {
    return await promise;
  } finally {
    clearInterval(timer);
  }
}

export async function recoverOutPathFromExistingSymlink(
  nm: string,
  lockAbs: string,
): Promise<{ outPath: string; lockHash: string } | null> {
  try {
    const [st, lockBuf] = await Promise.all([fsp.lstat(nm), fsp.readFile(lockAbs)]);
    if (!st.isSymbolicLink()) return null;
    const raw = await fsp.readlink(nm);
    const target = path.isAbsolute(raw) ? raw : path.resolve(path.dirname(nm), raw);
    const outPath = path.dirname(target);
    const lockHash = crypto.createHash("sha256").update(lockBuf).digest("hex");
    const outBase = path.basename(outPath);
    if (!target.endsWith("/node_modules")) return null;
    if (!outPath.startsWith("/nix/store/")) return null;
    if (!outBase.includes(`-lock-${lockHash}`)) return null;
    if (!(await pathExists(path.join(outPath, "node_modules")))) return null;
    return { outPath, lockHash };
  } catch {
    return null;
  }
}

export async function ensureNodeModulesGcRoot(
  root: string,
  key: string,
  outPath: string,
): Promise<void> {
  try {
    const workspaceRoot = String(process.env.WORKSPACE_ROOT || "").trim();
    if (
      String(process.env.VBR_RUN_IN_TEMP_REPO || "").trim() === "1" &&
      workspaceRoot &&
      path.resolve(workspaceRoot) !== path.resolve(root)
    ) {
      console.error("[link-node] skipping parent gc root pin for temp-repo importer", key);
      return;
    }
    if (!(await pathExists(outPath))) {
      console.error("[link-node] warning: skipping gc root pin; outPath does not exist:", outPath);
      return;
    }
    const gcDir = path.join(root, ".nix-gcroots");
    await mkdirWithMacosMetadataExclusion(gcDir);
    const gcRoot = path.join(gcDir, `node-modules.${key}`);
    const deriver = await runManagedCommand({
      command: "nix-store",
      args: ["--query", "--deriver", outPath],
      cwd: root,
      env: process.env,
      timeoutMs: 30_000,
    });
    if (!deriver.ok) {
      const output = (String(deriver.stdout || "") + String(deriver.stderr || "")).trim();
      if (output) {
        console.error("[link-node] warning: unable to query deriver for gc root pin:", output);
      }
      return;
    }
    const drvPath = String(deriver.stdout || "")
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .pop();
    if (!drvPath || drvPath === "unknown-deriver") return;
    // Substituted store paths may have a deriver path string whose .drv is not present locally.
    // In that case, gc-root pinning via --realise is not possible and should be a quiet no-op.
    if (!(await pathExists(drvPath))) return;
    const pinned = await runManagedCommand({
      command: "nix-store",
      args: ["--realise", "--add-root", gcRoot, "--indirect", drvPath],
      cwd: root,
      env: process.env,
      timeoutMs: 120_000,
    });
    if (!pinned.ok) {
      const output = (String(pinned.stdout || "") + String(pinned.stderr || "")).trim();
      if (output) {
        console.error("[link-node] warning: failed to pin node_modules gc root:", output);
      }
    }
  } catch (e) {
    console.error("[link-node] warning: failed to pin node_modules gc root:", e);
  }
}

type CompetingBuild = { pid: number; etimeSec: number; command: string };

function parseEtimeToSec(raw: string): number {
  const s = String(raw || "").trim();
  if (!s) return 0;
  let days = 0;
  let rest = s;
  const dash = s.indexOf("-");
  if (dash >= 0) {
    days = Number(s.slice(0, dash)) || 0;
    rest = s.slice(dash + 1);
  }
  const parts = rest.split(":").map((x) => Number(x || "0"));
  if (parts.some((x) => !Number.isFinite(x) || x < 0)) return 0;
  let h = 0;
  let m = 0;
  let sec = 0;
  if (parts.length === 3) [h, m, sec] = parts;
  else if (parts.length === 2) [m, sec] = parts;
  else if (parts.length === 1) [sec] = parts;
  return days * 86400 + h * 3600 + m * 60 + sec;
}

function scopeHintsForFlakeRef(flakeRefBase: string): string[] {
  const raw = String(flakeRefBase || "").trim();
  if (!raw) return [];
  if (raw.startsWith("path:")) {
    const p = raw.slice("path:".length).trim();
    if (!p) return [raw];
    return [raw, p];
  }
  return [raw];
}

function commandMatchesScope(cmd: string, flakeRefBase: string): boolean {
  const hints = scopeHintsForFlakeRef(flakeRefBase);
  if (hints.length === 0) return true;
  return hints.some((h) => cmd.includes(`${h}#`) || cmd.includes(h));
}

async function findCompetingNodeModulesBuilds(
  attr: string,
  flakeRefBase: string,
): Promise<CompetingBuild[]> {
  const lines = await processTableLines({
    psArgs: ["-axo", "pid=,etime=,command="],
    timeoutMs: 1500,
    pgrepPattern: "nix build .*#node-modules",
    pgrepToLine: (pid, cmd) => `${pid} 00:00 ${cmd}`,
  });
  const self = Number(process.pid || 0);
  const needle = `#node-modules.${attr}`;
  const res: CompetingBuild[] = [];
  for (const line of lines) {
    const s = line.trim();
    if (!s) continue;
    const m = s.match(/^(\d+)\s+(\S+)\s+(.+)$/);
    if (!m) continue;
    const pid = Number(m[1] || "0");
    const etimeSec = parseEtimeToSec(m[2] || "");
    const cmd = String(m[3] || "");
    if (!Number.isFinite(pid) || pid <= 0 || pid === self) continue;
    if (!cmd.includes("nix build")) continue;
    if (!cmd.includes(needle)) continue;
    if (!commandMatchesScope(cmd, flakeRefBase)) continue;
    res.push({ pid, etimeSec, command: cmd });
  }
  return res;
}

export async function failOnCompetingBuilds(attr: string, flakeRefBase: string): Promise<void> {
  const conflicts = await findCompetingNodeModulesBuilds(attr, flakeRefBase);
  if (conflicts.length > 0) {
    const sample = conflicts
      .slice(0, 3)
      .map((x) => `${x.pid}@${x.etimeSec}s`)
      .join(", ");
    throw new Error(
      `[link-node] conflicting active nix build(s) for node-modules.${attr} in scope '${flakeRefBase}': ${sample}. Resolve competing process(es) or retry after they finish.`,
    );
  }
}
