import * as fsp from "node:fs/promises";
import path from "node:path";
import { mkdirWithMacosMetadataExclusion } from "../../lib/macos-metadata";
import { createCommandUi, isVbrVerbose } from "../../lib/command-ui";
import { processStartSignature } from "../../lib/process-inspection";
import { resolveToolPathSync } from "../../lib/tool-paths";
import { buildToolPath, nodeBin, zxNodeBase } from "./paths";

async function getDiskStats(root: string): Promise<{ freePct: number; freeBytes: number }> {
  try {
    const { stdout } = await $({ stdio: "pipe", cwd: root })`df -Pk . | tail -n1`;
    const line = String(stdout || "").trim();
    const toks = line.split(/\s+/);
    const availKB = Number(toks[3] || "0");
    const usedPctStr = String(toks[4] || "0%").replace("%", "");
    const usedPct = Number.isFinite(Number(usedPctStr)) ? Number(usedPctStr) : 0;
    const freePct = Math.max(0, 100 - usedPct);
    return { freePct, freeBytes: Math.max(0, availKB) * 1024 };
  } catch {
    return { freePct: 100, freeBytes: Number.MAX_SAFE_INTEGER };
  }
}

function fmtBytes(n: number): string {
  const GiB = 1024 * 1024 * 1024;
  const MiB = 1024 * 1024;
  if (n >= GiB) return `${(n / GiB).toFixed(1)}GiB`;
  if (n >= MiB) return `${(n / MiB).toFixed(1)}MiB`;
  return `${n}B`;
}

async function olderThanMinutes(p: string, min: number): Promise<boolean> {
  try {
    const st = await fsp.stat(p);
    return Date.now() - st.mtimeMs >= min * 60 * 1000;
  } catch {
    return true;
  }
}

async function touch(p: string): Promise<void> {
  try {
    await mkdirWithMacosMetadataExclusion(path.dirname(p)).catch(() => {});
    await fsp.writeFile(p, `${Date.now()}`, "utf8");
  } catch {}
}

async function readText(p: string): Promise<string> {
  try {
    return String(await fsp.readFile(p, "utf8")).trim();
  } catch {
    return "";
  }
}

async function lockDirIsLive(lockDir: string): Promise<boolean> {
  const pid = Number(await readText(path.join(lockDir, "pid")));
  if (!Number.isFinite(pid) || pid <= 1) return false;
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  const expectedSig = await readText(path.join(lockDir, "lstart"));
  if (!expectedSig) return true;
  const actualSig = await processStartSignature(pid);
  return !actualSig || actualSig === expectedSig;
}

async function verifyLockIsLive(root: string): Promise<boolean> {
  const envLockDir = String(process.env.VBR_VERIFY_LOCK_DIR || "").trim();
  if (envLockDir && (await lockDirIsLive(envLockDir))) return true;
  const lockDir = path.join(root, ".viberoots", "workspace", "buck", "verify-lock");
  return await lockDirIsLive(lockDir);
}

function optimiseMode(): "auto" | "always" | "off" {
  const mode = (process.env.VBR_OPTIMISE_MODE || "auto").trim();
  if (mode === "always" || mode === "off") return mode;
  return "auto";
}

function optimiseCooldownMinutes(): number {
  const raw = Number((process.env.VBR_OPTIMISE_COOLDOWN_MINUTES || "120").trim());
  return Number.isFinite(raw) && raw >= 0 ? raw : 120;
}

function cleanTempOutsCooldownMinutes(): number {
  const raw = Number((process.env.VBR_CLEAN_TEMP_OUTS_COOLDOWN_MINUTES || "5").trim());
  return Number.isFinite(raw) && raw >= 0 ? raw : 5;
}

export async function runHousekeeping(opts: {
  cleanTempOuts?: () => Promise<boolean>;
  diskStats?: () => Promise<{ freePct: number; freeBytes: number }>;
  isCI: boolean;
  root: string;
}): Promise<void> {
  try {
    const hkEnabled = (process.env.VBR_HOUSEKEEPING || "1").trim() !== "0";
    const gcMode = (process.env.VBR_GC_MODE || "auto").trim(); // auto | warn | off
    if (opts.isCI || !hkEnabled) return;
    const verbose = isVbrVerbose();
    const ui = createCommandUi({ verbose });

    const nodeBase = zxNodeBase(opts.root);
    const node = nodeBin();
    const timeoutPath = resolveToolPathSync("timeout");
    if (verbose) console.log("[housekeeping] starting post-build housekeeping...");

    const hkDir = path.join(opts.root, "buck-out", ".housekeeping");
    await mkdirWithMacosMetadataExclusion(hkDir).catch(() => {});
    const cleanStamp = path.join(hkDir, ".clean-temp-outs-stamp");
    const optStamp = path.join(hkDir, ".optimize-stamp");
    const gcStamp = path.join(hkDir, ".gc-stamp");
    const gcLevelFile = path.join(hkDir, ".gc-level");

    if (await olderThanMinutes(cleanStamp, cleanTempOutsCooldownMinutes())) {
      const cleaned = opts.cleanTempOuts
        ? await opts.cleanTempOuts()
        : await (async () => {
            const cleanMinutes = 30;
            const cleanRes = await $({
              stdio: "ignore",
              cwd: opts.root,
            })`bash --noprofile --norc -c ${`${node} ${nodeBase} ${buildToolPath(
              opts.root,
              "tools/dev/clean-temp-outs.ts",
            )} --minutes ${String(cleanMinutes)}`}`.nothrow();
            return cleanRes.exitCode === 0;
          })();
      if (cleaned) {
        await touch(cleanStamp);
        if (verbose)
          console.log("[housekeeping] cleaned temp outputs (buck-impure-*, dangling result)");
      }
    } else {
      if (verbose) console.log("[housekeeping] temp cleanup: skipped (cooldown)");
    }

    const diskStats = opts.diskStats || (() => getDiskStats(opts.root));
    const { freePct: beforePct, freeBytes: beforeBytes } = await diskStats();
    const underPressure = beforePct < 12 || beforeBytes < 8 * 1024 * 1024 * 1024;
    const liveVerifyLock = await verifyLockIsLive(opts.root);
    if (verbose || underPressure) {
      const detail = `free=${beforePct.toFixed(0)}% (${fmtBytes(beforeBytes)})`;
      if (verbose) console.log(`[housekeeping] disk status: ${detail}`);
      else ui.warn(`low disk space: ${detail}`);
    }

    const optMode = optimiseMode();
    const shouldOptimise = optMode === "always" || (optMode === "auto" && underPressure);
    if (optMode === "off") {
      if (verbose) console.log("[housekeeping] optimise: skipped (off)");
    } else if (!shouldOptimise) {
      if (verbose) console.log("[housekeeping] optimise: skipped (sufficient free space)");
    } else if (liveVerifyLock) {
      if (verbose) console.log("[housekeeping] optimise: skipped (verify running)");
      else ui.warn("low disk space: skipping nix store optimise while verify is running");
    } else if (await olderThanMinutes(optStamp, optimiseCooldownMinutes())) {
      if (verbose) console.log("[housekeeping] optimise: running (<=60s)...");
      else ui.step("housekeeping", "optimising nix store");
      await $({
        stdio: "ignore",
        cwd: opts.root,
      })`bash --noprofile --norc -c 'set -euo pipefail; TOUT=60; TIMEOUT_PATH="$1"; set +e; "$TIMEOUT_PATH" -k 5s "$TOUT"s nix store optimise >/dev/null 2>&1; exit 0' -- ${timeoutPath}`.nothrow();
      await touch(optStamp);
    } else {
      if (verbose) console.log("[housekeeping] optimise: skipped (cooldown)");
    }

    if (gcMode === "auto" && underPressure && liveVerifyLock) {
      if (verbose) console.log("[housekeeping] GC: skipped (verify running)");
      else ui.warn("low disk space: skipping nix GC while verify is running");
    } else if (gcMode === "auto" && underPressure && (await olderThanMinutes(gcStamp, 10))) {
      let level = 1;
      try {
        const txt = await fsp.readFile(gcLevelFile, "utf8");
        const n = Number(String(txt || "").trim());
        if (Number.isFinite(n) && n >= 1 && n <= 3) level = n;
      } catch {}
      const cap = level === 1 ? "1G" : level === 2 ? "2G" : "4G";
      if (verbose) console.log(`[housekeeping] GC: running --max-freed ${cap} (<=45s)...`);
      else ui.step("housekeeping", `running nix GC ${cap}`);
      await $({
        stdio: "ignore",
        cwd: opts.root,
      })`bash --noprofile --norc -c 'set -euo pipefail; TOUT=45; TIMEOUT_PATH="$1"; CAP="$2"; set +e; "$TIMEOUT_PATH" -k 5s "$TOUT"s nix-store --gc --max-freed "$CAP" >/dev/null 2>&1; exit 0' -- ${timeoutPath} ${cap}`.nothrow();
      await touch(gcStamp);

      const { freePct: afterPct, freeBytes: afterBytes } = await diskStats();
      const stillLow = afterPct < 12 || afterBytes < 8 * 1024 * 1024 * 1024;
      const nextLevel = stillLow ? Math.min(3, level + 1) : 1;
      try {
        await fsp.writeFile(gcLevelFile, String(nextLevel), "utf8");
      } catch {}
      if (verbose) {
        console.log(
          `[housekeeping] GC: done; free=${afterPct.toFixed(0)}% (${fmtBytes(afterBytes)})`,
        );
      } else {
        ui.ok("housekeeping", `free=${afterPct.toFixed(0)}% (${fmtBytes(afterBytes)})`);
      }
    } else if (gcMode === "warn" && underPressure) {
      console.warn(
        "[housekeeping] low disk free detected; consider: nix-store --gc --max-freed 1G",
      );
    } else if (gcMode === "auto" && !underPressure) {
      if (verbose) console.log("[housekeeping] GC: skipped (sufficient free space)");
    }

    if (verbose) console.log("[housekeeping] finished.");
  } catch {}
}
