import * as fsp from "node:fs/promises";
import path from "node:path";
import { nodeBin, zxNodeBase } from "./paths.ts";

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
    await fsp.mkdir(path.dirname(p), { recursive: true }).catch(() => {});
    await fsp.writeFile(p, `${Date.now()}`, "utf8");
  } catch {}
}

export async function runHousekeeping(opts: { isCI: boolean; root: string }): Promise<void> {
  try {
    const hkEnabled = (process.env.BNX_HOUSEKEEPING || "1").trim() !== "0";
    const gcMode = (process.env.BNX_GC_MODE || "auto").trim(); // auto | warn | off
    if (opts.isCI || !hkEnabled) return;

    const nodeBase = zxNodeBase(opts.root);
    const node = nodeBin();
    console.log("[housekeeping] starting post-build housekeeping...");

    const cleanMinutes = 30;
    const cleanRes = await $({
      stdio: "ignore",
      cwd: opts.root,
    })`bash --noprofile --norc -c ${`${node} ${nodeBase} ${path.join(
      opts.root,
      "build-tools/tools/dev/clean-temp-outs.ts",
    )} --minutes ${String(cleanMinutes)}`}`.nothrow();
    if (cleanRes.exitCode === 0) {
      console.log("[housekeeping] cleaned temp outputs (buck-impure-*, dangling result)");
    }

    const hkDir = path.join(opts.root, "buck-out", ".housekeeping");
    await fsp.mkdir(hkDir, { recursive: true }).catch(() => {});
    const optStamp = path.join(hkDir, ".optimize-stamp");
    const gcStamp = path.join(hkDir, ".gc-stamp");
    const gcLevelFile = path.join(hkDir, ".gc-level");

    const { freePct: beforePct, freeBytes: beforeBytes } = await getDiskStats(opts.root);
    const underPressure = beforePct < 12 || beforeBytes < 8 * 1024 * 1024 * 1024;
    console.log(
      `[housekeeping] disk status: free=${beforePct.toFixed(0)}% (${fmtBytes(beforeBytes)})`,
    );

    if (await olderThanMinutes(optStamp, 120)) {
      console.log("[housekeeping] optimise: running (<=60s)...");
      await $({
        stdio: "ignore",
        cwd: opts.root,
      })`bash --noprofile --norc -c 'set -euo pipefail; TOUT=60; if ! command -v timeout >/dev/null 2>&1; then echo \"housekeeping: error: timeout not found on PATH\" 1>&2; exit 127; fi; set +e; timeout -k 5s ${TOUT}s nix store optimise >/dev/null 2>&1; exit 0'`.nothrow();
      await touch(optStamp);
    } else {
      console.log("[housekeeping] optimise: skipped (cooldown)");
    }

    if (gcMode === "auto" && underPressure && (await olderThanMinutes(gcStamp, 10))) {
      let level = 1;
      try {
        const txt = await fsp.readFile(gcLevelFile, "utf8");
        const n = Number(String(txt || "").trim());
        if (Number.isFinite(n) && n >= 1 && n <= 3) level = n;
      } catch {}
      const cap = level === 1 ? "1G" : level === 2 ? "2G" : "4G";
      console.log(`[housekeeping] GC: running --max-freed ${cap} (<=45s)...`);
      await $({
        stdio: "ignore",
        cwd: opts.root,
      })`bash --noprofile --norc -c 'set -euo pipefail; TOUT=45; if ! command -v timeout >/dev/null 2>&1; then echo \"housekeeping: error: timeout not found on PATH\" 1>&2; exit 127; fi; set +e; timeout -k 5s ${TOUT}s nix-store --gc --max-freed ${cap} >/dev/null 2>&1; exit 0'`.nothrow();
      await touch(gcStamp);

      const { freePct: afterPct, freeBytes: afterBytes } = await getDiskStats(opts.root);
      const stillLow = afterPct < 12 || afterBytes < 8 * 1024 * 1024 * 1024;
      const nextLevel = stillLow ? Math.min(3, level + 1) : 1;
      try {
        await fsp.writeFile(gcLevelFile, String(nextLevel), "utf8");
      } catch {}
      console.log(
        `[housekeeping] GC: done; free=${afterPct.toFixed(0)}% (${fmtBytes(afterBytes)})`,
      );
    } else if (gcMode === "warn" && underPressure) {
      console.warn(
        "[housekeeping] low disk free detected; consider: nix-store --gc --max-freed 1G",
      );
    } else if (gcMode === "auto" && !underPressure) {
      console.log("[housekeeping] GC: skipped (sufficient free space)");
    }

    console.log("[housekeeping] finished.");
  } catch {}
}
