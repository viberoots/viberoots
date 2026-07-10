import { spawn, spawnSync } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { mkdirWithMacosMetadataExclusion } from "../lib/macos-metadata";
import { processTableLines } from "../lib/process-inspection";
import { envWithResolvedNixBin, resolveToolPathSync } from "../lib/tool-paths";

function runnableBuildTimeoutSec(): number {
  const raw = String(process.env.VBR_RUNNABLE_BUILD_TIMEOUT_SEC || "").trim();
  const parsed = Number(raw || "420");
  if (!Number.isFinite(parsed) || parsed <= 0) return 420;
  return Math.floor(parsed);
}

function runnableTimeoutDiagEnabled(): boolean {
  const raw = String(process.env.VBR_RUNNABLE_TIMEOUT_DIAG || "")
    .trim()
    .toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function runnableTimeoutSampleSec(): number {
  const raw = String(process.env.VBR_RUNNABLE_TIMEOUT_SAMPLE_SEC || "").trim();
  const parsed = Number(raw || "3");
  if (!Number.isFinite(parsed) || parsed <= 0) return 3;
  return Math.max(1, Math.min(10, Math.floor(parsed)));
}

async function emitTimeoutDiagnostics(opts: {
  workspaceRoot: string;
  label: string;
  args: string[];
  childPid: number;
}) {
  if (!runnableTimeoutDiagEnabled()) return;
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = path.join(opts.workspaceRoot, "buck-out", "tmp");
  const outPath = path.join(outDir, `run-runnable-timeout-${ts}.log`);
  const safePid = opts.childPid > 0 ? opts.childPid : -1;
  const psLines = (
    await processTableLines({
      psArgs: ["-Ao", "pid,ppid,pgid,stat,etime,time,command"],
      timeoutMs: 2000,
      pgrepPattern: "graph-generator-selected|nix|buck2|node",
      pgrepToLine: (pid, cmd) => `${pid} ? ? ? ? ? ${cmd}`,
    })
  ).filter((line) => line.includes(`${safePid}`) || line.includes("graph-generator-selected"));
  let samplePath = "";
  if (process.platform === "darwin" && safePid > 0) {
    samplePath = path.join(outDir, `run-runnable-timeout-sample-${ts}.txt`);
    spawnSync(
      "sample",
      [String(safePid), String(runnableTimeoutSampleSec()), "1", "-file", samplePath],
      {
        stdio: "ignore",
      },
    );
  }
  const body = [
    `[run-runnable][timeout] label=${opts.label}`,
    `[run-runnable][timeout] command=nix build ${opts.args.join(" ")}`,
    `[run-runnable][timeout] childPid=${safePid}`,
    "[run-runnable][timeout] process-snapshot:",
    ...psLines,
    samplePath ? `[run-runnable][timeout] sample=${samplePath}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  await mkdirWithMacosMetadataExclusion(path.dirname(outDir));
  await mkdirWithMacosMetadataExclusion(outDir);
  await fsp.writeFile(outPath, body + "\n", "utf8");
  console.error(`[run-runnable] timeout diagnostics: ${outPath}`);
}

export async function runNixBuildWithProgress(opts: {
  workspaceRoot: string;
  env?: Record<string, string>;
  args: string[];
  label: string;
}): Promise<string> {
  const timeoutSec = runnableBuildTimeoutSec();
  const env = envWithResolvedNixBin((opts.env as NodeJS.ProcessEnv | undefined) ?? process.env);
  const nixBin = resolveToolPathSync("nix", env);
  const child = spawn(nixBin, ["build", ...opts.args], {
    cwd: opts.workspaceRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  const killGroup = (sig: NodeJS.Signals) => {
    try {
      process.kill(-child.pid!, sig);
    } catch {}
  };
  let settleExit: ((code: number) => void) | null = null;
  let settled = false;
  const settle = (code: number) => {
    if (settled) return;
    settled = true;
    settleExit?.(code);
  };
  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
  const terminateProcessTree = async () => {
    killGroup("SIGINT");
    await sleep(1200);
    if (settled) return;
    killGroup("SIGTERM");
    await sleep(1800);
    if (settled) return;
    killGroup("SIGKILL");
  };
  const onTerm = () => {
    void terminateProcessTree();
  };
  const onInt = () => {
    void terminateProcessTree();
  };
  process.once("SIGTERM", onTerm);
  process.once("SIGINT", onInt);

  let stdout = "";
  let stderr = "";
  let timedOut = false;
  const exitPromise = new Promise<number>((resolve) => {
    settleExit = (code: number) => resolve(code);
  });

  const killer = setTimeout(() => {
    timedOut = true;
    void (async () => {
      await terminateProcessTree();
      settle(124);
    })();
  }, timeoutSec * 1000);

  child.stdout.on("data", (chunk) => {
    stdout += String(chunk || "");
  });
  child.stderr.on("data", (chunk) => {
    const s = String(chunk || "");
    stderr += s;
    try {
      process.stderr.write(s);
    } catch {}
  });
  child.once("close", (code, signal) => {
    if (typeof code === "number") settle(code);
    else settle(signal ? 130 : 1);
  });
  child.once("error", () => settle(1));

  const exit = await exitPromise;
  if (timedOut) {
    await emitTimeoutDiagnostics({
      workspaceRoot: opts.workspaceRoot,
      label: opts.label,
      args: opts.args,
      childPid: child.pid ?? -1,
    });
    clearTimeout(killer);
    process.removeListener("SIGTERM", onTerm);
    process.removeListener("SIGINT", onInt);
    throw new Error(
      `[run-runnable] ${opts.label} timed out after ${timeoutSec}s while running: nix build ${opts.args.join(" ")}`,
    );
  }
  clearTimeout(killer);
  process.removeListener("SIGTERM", onTerm);
  process.removeListener("SIGINT", onInt);
  if (exit !== 0) {
    const errTail = stderr.trim();
    throw new Error(
      `[run-runnable] ${opts.label} failed (exit ${exit}) while running: nix build ${opts.args.join(" ")}${
        errTail ? `\n${errTail}` : ""
      }`,
    );
  }
  return stdout;
}
