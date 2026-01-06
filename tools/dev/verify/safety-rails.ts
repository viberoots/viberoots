import "zx/globals";
import * as fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";

function parseNum(s: string | undefined): number | null {
  const n = Number(String(s || "").trim());
  if (!Number.isFinite(n)) return null;
  return n;
}

function defaultOrNonNegative(envVal: number | null, def: number): number {
  if (envVal == null) return def;
  if (!Number.isFinite(envVal)) return def;
  return Math.max(0, envVal);
}

async function freeGiBForPath(p: string): Promise<number | null> {
  try {
    const { stdout } = await $({ stdio: "pipe" })`df -Pk ${p} | tail -n1`;
    const line = String(stdout || "").trim();
    const toks = line.split(/\s+/);
    const availKB = Number(toks[3] || "0");
    return Math.max(0, Math.floor(availKB / 1024 / 1024));
  } catch {
    return null;
  }
}

async function appendLine(p: string, line: string): Promise<void> {
  await fsp.appendFile(p, line.endsWith("\n") ? line : line + "\n", "utf8").catch(() => {});
}

async function writeSnapshot(dir: string, reason: string): Promise<void> {
  const out = path.join(dir, "trigger-snapshot.txt");
  const hdr = `[verify] safety-rails trigger: ${reason}\n`;
  await appendLine(out, hdr);
  try {
    const res = await $({ stdio: "pipe", reject: false })`df -Pk . /nix/store`;
    await appendLine(out, String(res.stdout || ""));
  } catch {}
}

export async function startVerifySafetyRails(opts: {
  root: string;
  analysisDir: string;
  processGroupIdToKill: number;
}): Promise<{ stop: () => void }> {
  const lowSpace = defaultOrNonNegative(parseNum(process.env.VERIFY_LOW_SPACE_GB), 5);
  const dropBudget = defaultOrNonNegative(parseNum(process.env.VERIFY_NIX_DROP_BUDGET_GB), 20);
  const intervalSec = parseNum(process.env.VERIFY_SAFETY_RAILS_POLL_SECS) ?? 5;

  const base = await freeGiBForPath("/nix/store");
  if (base == null) {
    return { stop: () => {} };
  }

  await fsp.mkdir(opts.analysisDir, { recursive: true }).catch(() => {});
  const telemetry = path.join(opts.analysisDir, "nix-store-telemetry.log");
  await appendLine(telemetry, `[verify] safety-rails baseline /nix/store free ~${base}GiB`);

  if ((process.env.VERIFY_ANALYSIS_STORE_TOTALS || "").trim() === "1") {
    const res = await $({
      stdio: "pipe",
      cwd: opts.root,
      reject: false,
    })`timeout -k 5s 20s nix store info`;
    const txt = String(res.stdout || "").trim();
    if (txt) await appendLine(telemetry, `[verify] nix store info:\n${txt}`);
  }

  let stopped = false;
  let pollInFlight = false;
  const timer = setInterval(() => {
    void (async () => {
      if (pollInFlight) return;
      pollInFlight = true;
      if (stopped) return;
      try {
        if (stopped) return;
        const cur = await freeGiBForPath("/nix/store");
        if (cur == null) return;
        await appendLine(telemetry, `${Date.now()} freeGiB=${cur}`);

        if (lowSpace > 0 && cur < lowSpace) {
          stopped = true;
          await writeSnapshot(
            opts.analysisDir,
            `/nix/store free dropped below VERIFY_LOW_SPACE_GB (${cur} < ${lowSpace})`,
          );
          try {
            process.kill(-opts.processGroupIdToKill, "SIGTERM");
          } catch {}
          setTimeout(() => {
            try {
              process.kill(-opts.processGroupIdToKill, "SIGKILL");
            } catch {}
          }, 10_000);
          return;
        }

        const drop = base - cur;
        if (dropBudget > 0 && drop > dropBudget) {
          stopped = true;
          await writeSnapshot(
            opts.analysisDir,
            `/nix/store free drop exceeded budget VERIFY_NIX_DROP_BUDGET_GB (drop=${drop}GiB > ${dropBudget}GiB)`,
          );
          try {
            process.kill(-opts.processGroupIdToKill, "SIGTERM");
          } catch {}
          setTimeout(() => {
            try {
              process.kill(-opts.processGroupIdToKill, "SIGKILL");
            } catch {}
          }, 10_000);
        }
      } finally {
        pollInFlight = false;
      }
    })();
  }, intervalSec * 1000);
  timer.unref?.();

  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}
